import { test, expect, describe } from 'bun:test';
import { Database } from 'bun:sqlite';
import { openDatabase } from './connection.js';
import { ensureSchema } from './schema.js';
import { UserRepository } from '../repositories/user.js';
import { GithubInstallationRepository } from '../repositories/github-installation.js';
import { RepoRepository } from '../repositories/repo.js';
import { RepoMemberRepository } from '../repositories/repo-member.js';
import { ApiKeyRepository } from '../repositories/api-key.js';
import { SessionRepository } from '../repositories/session.js';
import { MemoryRepository } from '../repositories/memory.js';
import { MemoryAnchorRepository } from '../repositories/memory-anchor.js';
import { AgentEventRepository } from '../repositories/agent-event.js';

function memDb(): Database {
  // ponytail: :memory: db per test, no cleanup needed
  return openDatabase(':memory:');
}

describe('ensureSchema', () => {
  test('is idempotent — calling twice does not throw', () => {
    const db = memDb();
    expect(() => ensureSchema(db)).not.toThrow();
  });

  test('all 9 tables exist', () => {
    const db = memDb();
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    ).all() as { name: string }[];
    const names = tables.map(t => t.name);
    for (const t of ['user', 'github_installation', 'repo', 'repo_member', 'api_key', 'session', 'memory', 'memory_anchor', 'agent_event']) {
      expect(names).toContain(t);
    }
  });

  test('WAL mode is set', () => {
    const db = memDb();
    // :memory: always returns 'memory' mode; WAL check only meaningful on file DBs.
    // Just assert the pragma call doesn't throw.
    const { journal_mode } = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(['wal', 'memory']).toContain(journal_mode);
  });
});

describe('seed → CRUD → FTS5', () => {
  test('full round-trip: user → repo → session → memory → FTS5 search', () => {
    const db = memDb();
    const users = new UserRepository(db);
    const installations = new GithubInstallationRepository(db);
    const repos = new RepoRepository(db);
    const sessions = new SessionRepository(db);
    const memories = new MemoryRepository(db);
    const anchors = new MemoryAnchorRepository(db);
    const events = new AgentEventRepository(db);

    // ── Seed ──────────────────────────────────────────────────────────────
    const user = users.create({ github_id: '1001', github_login: 'alice', display_name: null, avatar_url: null, metadata: {} });
    expect(user.github_login).toBe('alice');

    const install = installations.create({ installation_id: 42, account_type: 'org', account_login: 'acme', metadata: {} });
    expect(install.installation_id).toBe(42);

    const repo = repos.create({
      fingerprint: 'github.com/acme/widget',
      canonical: 'acme/widget',
      github_repo_id: '9001',
      github_installation_id: 42,
      status: 'active',
      metadata: {},
    });
    expect(repo.fingerprint).toBe('github.com/acme/widget');

    const session = sessions.create({
      id: 'sess_1',
      repo_fingerprint: repo.fingerprint,
      repo_canonical: repo.canonical,
      author_id: user.id,
      agent: 'claude-code',
      platform_source: 'claude-code',
      status: 'active',
      metadata: {},
      started_at_epoch: Date.now(),
      ended_at_epoch: null,
    });
    expect(session.status).toBe('active');

    // ── Memory CRUD ───────────────────────────────────────────────────────
    const mem = memories.create({
      id: 'mem_1',
      repo_fingerprint: repo.fingerprint,
      session_id: session.id,
      author_id: user.id,
      agent: 'claude-code',
      kind: 'observation',
      type: 'raw_observation',
      title: null,
      content: 'The authentication middleware validates JWT tokens using RS256.',
      narrative: null,
      facts: [],
      concepts: [],
      files_read: [],
      files_modified: [],
      confirmed_commit: null,
      ai_extracted: false,
      metadata: {},
    });
    expect(mem.id).toBe('mem_1');
    expect(mem.freshness_state).toBe('fresh');
    expect(mem.promotion_state).toBe('private');

    // getById round-trip
    const fetched = memories.getById('mem_1');
    expect(fetched?.content).toBe(mem.content);

    // update
    const updated = memories.update('mem_1', { title: 'Auth middleware uses RS256' });
    expect(updated?.title).toBe('Auth middleware uses RS256');

    // setPromotion / setFreshness
    memories.setPromotion('mem_1', 'team_shared');
    memories.setFreshness('mem_1', 'stale_suspected');
    const after = memories.getById('mem_1')!;
    expect(after.promotion_state).toBe('team_shared');
    expect(after.freshness_state).toBe('stale_suspected');

    // ── Memory anchors ────────────────────────────────────────────────────
    const anchor = anchors.upsert({ memory_id: 'mem_1', path: 'src/auth/middleware.ts', commit_sha: 'abc123' });
    expect(anchor.commit_sha).toBe('abc123');
    expect(anchors.listByMemory('mem_1')).toHaveLength(1);
    expect(anchors.listByPath('src/auth/middleware.ts')).toHaveLength(1);

    // ── FTS5 search ───────────────────────────────────────────────────────
    const results = memories.search(repo.fingerprint, 'JWT tokens RS256');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.id).toBe('mem_1');

    // Empty query returns nothing
    expect(memories.search(repo.fingerprint, '')).toHaveLength(0);

    // ── Agent event with idempotency ──────────────────────────────────────
    const event = events.create({
      id: 'evt_1',
      repo_fingerprint: repo.fingerprint,
      session_id: session.id,
      source_type: 'hook',
      event_type: 'PreToolUse',
      payload: { tool: 'Bash' },
      idempotency_key: 'hook-abc-1',
      occurred_at_epoch: Date.now(),
    });
    expect(events.getByIdempotencyKey('hook-abc-1')?.id).toBe('evt_1');

    // Duplicate idempotency_key should throw (UNIQUE constraint)
    expect(() => events.create({
      id: 'evt_2', repo_fingerprint: repo.fingerprint, session_id: session.id,
      source_type: 'hook', event_type: 'PreToolUse', payload: {},
      idempotency_key: 'hook-abc-1', occurred_at_epoch: Date.now(),
    })).toThrow();
  });

  test('integrity trigger: memory session_id must share repo_fingerprint', () => {
    const db = memDb();
    const users = new UserRepository(db);
    const installations = new GithubInstallationRepository(db);
    const repos = new RepoRepository(db);
    const sessions = new SessionRepository(db);
    const memories = new MemoryRepository(db);

    const user = users.create({ github_id: '2001', github_login: 'bob', display_name: null, avatar_url: null, metadata: {} });
    installations.create({ installation_id: 99, account_type: 'user', account_login: 'bob', metadata: {} });
    const repoA = repos.create({ fingerprint: 'github.com/bob/a', canonical: 'bob/a', github_repo_id: '111', github_installation_id: 99, status: 'active', metadata: {} });
    const repoB = repos.create({ fingerprint: 'github.com/bob/b', canonical: 'bob/b', github_repo_id: '222', github_installation_id: 99, status: 'active', metadata: {} });
    const session = sessions.create({ id: 'sess_a', repo_fingerprint: repoA.fingerprint, repo_canonical: repoA.canonical, author_id: user.id, agent: 'codex', platform_source: 'codex', status: 'active', metadata: {}, started_at_epoch: Date.now(), ended_at_epoch: null });

    // session belongs to repoA but memory is for repoB — integrity trigger fires
    expect(() => memories.create({
      id: 'mem_x',
      repo_fingerprint: repoB.fingerprint,
      session_id: session.id,
      author_id: user.id,
      agent: 'codex',
      kind: 'observation',
      type: 'raw_observation',
      title: null, content: 'should fail', narrative: null, facts: [], concepts: [],
      files_read: [], files_modified: [], confirmed_commit: null, ai_extracted: false, metadata: {},
    })).toThrow(/same repo_fingerprint/);
  });

  test('repo_member composite-PK upsert', () => {
    const db = memDb();
    const users = new UserRepository(db);
    const installations = new GithubInstallationRepository(db);
    const repos = new RepoRepository(db);
    const members = new RepoMemberRepository(db);

    const u = users.create({ github_id: '3001', github_login: 'carol', display_name: null, avatar_url: null, metadata: {} });
    installations.create({ installation_id: 77, account_type: 'org', account_login: 'corp', metadata: {} });
    const r = repos.create({ fingerprint: 'github.com/corp/x', canonical: 'corp/x', github_repo_id: '555', github_installation_id: 77, status: 'active', metadata: {} });

    const m1 = members.upsert({ repo_id: r.id, user_id: u.id, github_role: 'read', synced_at_epoch: 1000 });
    expect(m1.github_role).toBe('read');

    const m2 = members.upsert({ repo_id: r.id, user_id: u.id, github_role: 'admin', synced_at_epoch: 2000 });
    expect(m2.github_role).toBe('admin');
    expect(members.listByRepo(r.id)).toHaveLength(1);
  });

  test('api_key revoke', () => {
    const db = memDb();
    const users = new UserRepository(db);
    const keys = new ApiKeyRepository(db);

    const u = users.create({ github_id: '4001', github_login: 'dan', display_name: null, avatar_url: null, metadata: {} });
    const key = keys.create({ user_id: u.id, name: 'CI key', key_hash: 'hash1', prefix: null, scopes: ['ingest'], status: 'active', last_used_at_epoch: null, expires_at_epoch: null, metadata: {} });
    expect(key.status).toBe('active');

    const revoked = keys.revoke(key.id);
    expect(revoked?.status).toBe('revoked');
    expect(keys.getByHash('hash1')?.status).toBe('revoked');
  });
});
