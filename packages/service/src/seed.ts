// Quick CRUD seed — run inside Docker:
//   docker compose -f docker/docker-compose.yml run --rm service bun packages/service/src/seed.ts
import { openDatabase } from './db/connection.js';
import { UserRepository } from './repositories/user.js';
import { GithubInstallationRepository } from './repositories/github-installation.js';
import { RepoRepository } from './repositories/repo.js';
import { RepoMemberRepository } from './repositories/repo-member.js';
import { ApiKeyRepository } from './repositories/api-key.js';
import { SessionRepository } from './repositories/session.js';
import { MemoryRepository } from './repositories/memory.js';
import { MemoryAnchorRepository } from './repositories/memory-anchor.js';
import { AgentEventRepository } from './repositories/agent-event.js';

const db = openDatabase();
console.log('DB path:', process.env['DATABASE_PATH'] ?? process.env['AZNEX_DB_PATH'] ?? 'aznex.db');

const users = new UserRepository(db);
const installations = new GithubInstallationRepository(db);
const repos = new RepoRepository(db);
const members = new RepoMemberRepository(db);
const apiKeys = new ApiKeyRepository(db);
const sessions = new SessionRepository(db);
const memories = new MemoryRepository(db);
const anchors = new MemoryAnchorRepository(db);
const events = new AgentEventRepository(db);

const now = Date.now();

// ── Users ─────────────────────────────────────────────────────────────────
const alice = users.create({ github_id: '1001', github_login: 'alice', display_name: 'Alice', avatar_url: null, metadata: {} });
const bob   = users.create({ github_id: '1002', github_login: 'bob',   display_name: 'Bob',   avatar_url: null, metadata: {} });
console.log('Users:', alice.id, bob.id);

// ── GitHub installation ───────────────────────────────────────────────────
const install = installations.create({ installation_id: 42, account_type: 'org', account_login: 'acme-corp', metadata: {} });
console.log('Installation:', install.id, 'installation_id=', install.installation_id);

// ── Repo ──────────────────────────────────────────────────────────────────
const repo = repos.create({
  fingerprint: 'github.com/acme-corp/widget',
  canonical: 'acme-corp/widget',
  github_repo_id: '9001',
  github_installation_id: 42,
  status: 'active',
  metadata: {},
});
console.log('Repo:', repo.id, repo.fingerprint);

// ── Repo members ──────────────────────────────────────────────────────────
members.upsert({ repo_id: repo.id, user_id: alice.id, github_role: 'admin', synced_at_epoch: now });
members.upsert({ repo_id: repo.id, user_id: bob.id,   github_role: 'write', synced_at_epoch: now });
console.log('Members:', members.listByRepo(repo.id).map(m => m.github_role));

// ── API key ───────────────────────────────────────────────────────────────
const key = apiKeys.create({ user_id: alice.id, name: 'CI key', key_hash: 'sha256-abc', prefix: 'axk_', scopes: ['ingest', 'read'], status: 'active', last_used_at_epoch: null, expires_at_epoch: null, metadata: {} });
console.log('ApiKey:', key.id, 'scopes=', key.scopes);

// ── Session ───────────────────────────────────────────────────────────────
const session = sessions.create({
  id: `sess_${now}`,
  repo_fingerprint: repo.fingerprint,
  repo_canonical: repo.canonical,
  author_id: alice.id,
  agent: 'claude-code',
  platform_source: 'claude-code',
  status: 'active',
  metadata: {},
  started_at_epoch: now,
  ended_at_epoch: null,
});
console.log('Session:', session.id, session.status);

// ── Memory ────────────────────────────────────────────────────────────────
const mem = memories.create({
  id: `mem_${now}`,
  repo_fingerprint: repo.fingerprint,
  session_id: session.id,
  author_id: alice.id,
  agent: 'claude-code',
  kind: 'observation',
  type: 'raw_observation',
  title: 'Auth middleware uses RS256',
  content: 'The authentication middleware validates JWT tokens using RS256 asymmetric keys. The public key is fetched from /auth/jwks on startup.',
  narrative: null,
  facts: ['RS256 is used', 'JWKS endpoint is /auth/jwks'],
  concepts: ['JWT', 'asymmetric keys', 'JWKS'],
  files_read: ['src/auth/middleware.ts'],
  files_modified: [],
  confirmed_commit: null,
  ai_extracted: false,
  metadata: {},
});
console.log('Memory:', mem.id, 'promotion=', mem.promotion_state, 'freshness=', mem.freshness_state);

// ── Memory anchor ─────────────────────────────────────────────────────────
const anchor = anchors.upsert({ memory_id: mem.id, path: 'src/auth/middleware.ts', commit_sha: 'abc123def456' });
console.log('Anchor:', anchor.path, anchor.commit_sha);

// ── Promote + stale ───────────────────────────────────────────────────────
memories.setPromotion(mem.id, 'team_shared');
memories.setFreshness(mem.id, 'stale_suspected');
const updated = memories.getById(mem.id)!;
console.log('After promote/stale:', updated.promotion_state, updated.freshness_state);

// ── FTS5 search ───────────────────────────────────────────────────────────
const results = memories.search(repo.fingerprint, 'JWT RS256');
console.log('FTS5 search "JWT RS256":', results.length, 'result(s), first:', results[0]?.title);

// ── Agent event ───────────────────────────────────────────────────────────
const event = events.create({
  id: `evt_${now}`,
  repo_fingerprint: repo.fingerprint,
  session_id: session.id,
  source_type: 'hook',
  event_type: 'PreToolUse',
  payload: { tool: 'Bash', input: 'git log' },
  idempotency_key: `hook-${now}`,
  occurred_at_epoch: now,
});
console.log('AgentEvent:', event.id, 'idempotency=', event.idempotency_key);
console.log('Lookup by key:', events.getByIdempotencyKey(`hook-${now}`)?.event_type);

console.log('\n✓ All CRUD operations succeeded');
