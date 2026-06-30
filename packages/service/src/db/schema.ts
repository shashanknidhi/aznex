import { Database } from 'bun:sqlite';

const initializedDatabases = new WeakSet<Database>();

export function ensureSchema(db: Database): void {
  if (initializedDatabases.has(db)) return;

  db.run(`
    CREATE TABLE IF NOT EXISTS user (
      id TEXT PRIMARY KEY,
      github_id TEXT NOT NULL UNIQUE,
      github_login TEXT NOT NULL,
      display_name TEXT,
      avatar_url TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at_epoch INTEGER NOT NULL,
      updated_at_epoch INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS github_installation (
      id TEXT PRIMARY KEY,
      installation_id INTEGER NOT NULL UNIQUE,
      account_type TEXT NOT NULL CHECK(account_type IN ('org', 'user')),
      account_login TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at_epoch INTEGER NOT NULL,
      updated_at_epoch INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS repo (
      id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL UNIQUE,
      canonical TEXT NOT NULL,
      github_repo_id TEXT NOT NULL UNIQUE,
      github_installation_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at_epoch INTEGER NOT NULL,
      updated_at_epoch INTEGER NOT NULL,
      FOREIGN KEY(github_installation_id) REFERENCES github_installation(installation_id)
    );

    CREATE TABLE IF NOT EXISTS repo_member (
      repo_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      github_role TEXT NOT NULL CHECK(github_role IN ('admin', 'write', 'read')),
      synced_at_epoch INTEGER NOT NULL,
      PRIMARY KEY (repo_id, user_id),
      FOREIGN KEY(repo_id) REFERENCES repo(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS api_key (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      prefix TEXT,
      scopes TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
      last_used_at_epoch INTEGER,
      expires_at_epoch INTEGER,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at_epoch INTEGER NOT NULL,
      updated_at_epoch INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY,
      repo_fingerprint TEXT NOT NULL,
      repo_canonical TEXT NOT NULL,
      author_id TEXT NOT NULL,
      agent TEXT NOT NULL,
      platform_source TEXT NOT NULL DEFAULT 'claude-code',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'failed')),
      metadata TEXT NOT NULL DEFAULT '{}',
      started_at_epoch INTEGER NOT NULL,
      ended_at_epoch INTEGER,
      created_at_epoch INTEGER NOT NULL,
      updated_at_epoch INTEGER NOT NULL,
      FOREIGN KEY(author_id) REFERENCES user(id)
    );

    CREATE TABLE IF NOT EXISTS memory (
      id TEXT PRIMARY KEY,
      repo_fingerprint TEXT NOT NULL,
      session_id TEXT,
      author_id TEXT NOT NULL,
      agent TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('observation', 'summary', 'manual')),
      type TEXT NOT NULL CHECK(type IN ('raw_observation', 'extracted_learning', 'summary', 'negative_result', 'decision')),
      title TEXT,
      content TEXT NOT NULL,
      narrative TEXT,
      facts TEXT NOT NULL DEFAULT '[]',
      concepts TEXT NOT NULL DEFAULT '[]',
      files_read TEXT NOT NULL DEFAULT '[]',
      files_modified TEXT NOT NULL DEFAULT '[]',
      freshness_state TEXT NOT NULL DEFAULT 'fresh' CHECK(freshness_state IN ('fresh', 'stale_suspected')),
      promotion_state TEXT NOT NULL DEFAULT 'private' CHECK(promotion_state IN ('private', 'pending', 'team_shared')),
      confirmed_commit TEXT,
      ai_extracted INTEGER NOT NULL CHECK(ai_extracted IN (0, 1)),
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at_epoch INTEGER NOT NULL,
      updated_at_epoch INTEGER NOT NULL,
      FOREIGN KEY(session_id) REFERENCES session(id) ON DELETE SET NULL,
      FOREIGN KEY(author_id) REFERENCES user(id)
    );

    CREATE TABLE IF NOT EXISTS memory_anchor (
      memory_id TEXT NOT NULL,
      path TEXT NOT NULL,
      commit_sha TEXT,
      PRIMARY KEY (memory_id, path),
      FOREIGN KEY(memory_id) REFERENCES memory(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_event (
      id TEXT PRIMARY KEY,
      repo_fingerprint TEXT NOT NULL,
      session_id TEXT,
      source_type TEXT NOT NULL CHECK(source_type IN ('hook', 'worker', 'provider', 'server', 'api')),
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      idempotency_key TEXT NOT NULL UNIQUE,
      occurred_at_epoch INTEGER NOT NULL,
      created_at_epoch INTEGER NOT NULL,
      FOREIGN KEY(session_id) REFERENCES session(id) ON DELETE SET NULL
    );
  `);

  // ── Indexes ──────────────────────────────────────────────────────────────
  db.run('CREATE INDEX IF NOT EXISTS idx_session_repo ON session(repo_fingerprint, created_at_epoch DESC)');
  db.run('CREATE INDEX IF NOT EXISTS idx_session_author ON session(author_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_session_status ON session(status)');

  db.run('CREATE INDEX IF NOT EXISTS idx_memory_repo_time ON memory(repo_fingerprint, created_at_epoch DESC)');
  db.run('CREATE INDEX IF NOT EXISTS idx_memory_session ON memory(session_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_memory_author ON memory(author_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_memory_promotion ON memory(promotion_state)');
  db.run('CREATE INDEX IF NOT EXISTS idx_memory_freshness ON memory(freshness_state)');
  db.run('CREATE INDEX IF NOT EXISTS idx_memory_type ON memory(kind, type)');

  db.run('CREATE INDEX IF NOT EXISTS idx_memory_anchor_path ON memory_anchor(path)');

  db.run('CREATE INDEX IF NOT EXISTS idx_api_key_user ON api_key(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_api_key_prefix ON api_key(prefix)');
  db.run('CREATE INDEX IF NOT EXISTS idx_repo_member_user ON repo_member(user_id)');

  db.run('CREATE INDEX IF NOT EXISTS idx_agent_event_repo_time ON agent_event(repo_fingerprint, occurred_at_epoch DESC)');
  db.run('CREATE INDEX IF NOT EXISTS idx_agent_event_session ON agent_event(session_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_agent_event_type ON agent_event(event_type)');

  // ── FTS5 virtual table ────────────────────────────────────────────────────
  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      memory_id UNINDEXED,
      repo_fingerprint UNINDEXED,
      content,
      title,
      narrative,
      facts,
      concepts,
      tokenize='porter unicode61'
    )
  `);

  // Rebuild FTS if counts diverge (e.g. after a crash mid-insert).
  const { count: baseCount } = db.prepare('SELECT COUNT(*) AS count FROM memory').get() as { count: number };
  const { count: ftsCount } = db.prepare('SELECT COUNT(*) AS count FROM memory_fts').get() as { count: number };
  if (baseCount !== ftsCount) {
    db.transaction(() => {
      db.run('DELETE FROM memory_fts');
      db.run(`
        INSERT INTO memory_fts (memory_id, repo_fingerprint, content, title, narrative, facts, concepts)
        SELECT id, repo_fingerprint, content, title, narrative, facts, concepts FROM memory
      `);
    })();
  }

  // ── FTS sync triggers ─────────────────────────────────────────────────────
  db.run(`
    CREATE TRIGGER IF NOT EXISTS trg_memory_fts_insert
    AFTER INSERT ON memory
    BEGIN
      INSERT INTO memory_fts (memory_id, repo_fingerprint, content, title, narrative, facts, concepts)
      VALUES (new.id, new.repo_fingerprint, new.content, new.title, new.narrative, new.facts, new.concepts);
    END;

    CREATE TRIGGER IF NOT EXISTS trg_memory_fts_update
    AFTER UPDATE ON memory
    BEGIN
      DELETE FROM memory_fts WHERE memory_id = old.id;
      INSERT INTO memory_fts (memory_id, repo_fingerprint, content, title, narrative, facts, concepts)
      VALUES (new.id, new.repo_fingerprint, new.content, new.title, new.narrative, new.facts, new.concepts);
    END;

    CREATE TRIGGER IF NOT EXISTS trg_memory_fts_delete
    AFTER DELETE ON memory
    BEGIN
      DELETE FROM memory_fts WHERE memory_id = old.id;
    END;
  `);

  // ── Integrity triggers ────────────────────────────────────────────────────
  // Enforce that memory.session_id and agent_event.session_id reference a
  // session with the same repo_fingerprint (SQLite FK can't express this).
  db.run(`
    CREATE TRIGGER IF NOT EXISTS trg_memory_session_repo_insert
    BEFORE INSERT ON memory
    WHEN NEW.session_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM session
        WHERE id = NEW.session_id AND repo_fingerprint = NEW.repo_fingerprint
      )
    BEGIN
      SELECT RAISE(ABORT, 'memory.session_id must belong to the same repo_fingerprint');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_memory_session_repo_update
    BEFORE UPDATE OF repo_fingerprint, session_id ON memory
    WHEN NEW.session_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM session
        WHERE id = NEW.session_id AND repo_fingerprint = NEW.repo_fingerprint
      )
    BEGIN
      SELECT RAISE(ABORT, 'memory.session_id must belong to the same repo_fingerprint');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_agent_event_session_repo_insert
    BEFORE INSERT ON agent_event
    WHEN NEW.session_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM session
        WHERE id = NEW.session_id AND repo_fingerprint = NEW.repo_fingerprint
      )
    BEGIN
      SELECT RAISE(ABORT, 'agent_event.session_id must belong to the same repo_fingerprint');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_agent_event_session_repo_update
    BEFORE UPDATE OF repo_fingerprint, session_id ON agent_event
    WHEN NEW.session_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM session
        WHERE id = NEW.session_id AND repo_fingerprint = NEW.repo_fingerprint
      )
    BEGIN
      SELECT RAISE(ABORT, 'agent_event.session_id must belong to the same repo_fingerprint');
    END;
  `);

  initializedDatabases.add(db);
}
