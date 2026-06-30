import { Database } from 'bun:sqlite';
import { SessionSchema, CreateSessionSchema, type Session, type CreateSession } from '@aznex/shared';
import { ensureSchema } from '../db/schema.js';
import { parseJsonObject, stringifyJson } from '../db/serde.js';
import type { ISessionRepository } from './interfaces.js';

interface SessionRow {
  id: string;
  repo_fingerprint: string;
  repo_canonical: string;
  author_id: string;
  agent: string;
  platform_source: string;
  status: string;
  metadata: string;
  started_at_epoch: number;
  ended_at_epoch: number | null;
  created_at_epoch: number;
  updated_at_epoch: number;
}

function mapRow(row: SessionRow): Session {
  return SessionSchema.parse({
    id: row.id,
    repo_fingerprint: row.repo_fingerprint,
    repo_canonical: row.repo_canonical,
    author_id: row.author_id,
    agent: row.agent,
    platform_source: row.platform_source,
    status: row.status,
    metadata: parseJsonObject(row.metadata),
    started_at_epoch: row.started_at_epoch,
    ended_at_epoch: row.ended_at_epoch,
    created_at_epoch: row.created_at_epoch,
    updated_at_epoch: row.updated_at_epoch,
  });
}

export class SessionRepository implements ISessionRepository {
  constructor(private db: Database) {
    ensureSchema(this.db);
  }

  create(input: CreateSession): Session {
    const data = CreateSessionSchema.parse(input);
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO session (id, repo_fingerprint, repo_canonical, author_id, agent, platform_source, status, metadata, started_at_epoch, ended_at_epoch, created_at_epoch, updated_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.id, data.repo_fingerprint, data.repo_canonical, data.author_id,
      data.agent, data.platform_source, data.status, stringifyJson(data.metadata),
      data.started_at_epoch, data.ended_at_epoch ?? null, now, now,
    );
    return this.getById(data.id)!;
  }

  getById(id: string): Session | null {
    const row = this.db.prepare('SELECT * FROM session WHERE id = ?').get(id) as SessionRow | null;
    return row ? mapRow(row) : null;
  }

  listByRepo(repoFingerprint: string, limit = 100): Session[] {
    const rows = this.db.prepare(
      'SELECT * FROM session WHERE repo_fingerprint = ? ORDER BY created_at_epoch DESC LIMIT ?'
    ).all(repoFingerprint, limit) as SessionRow[];
    return rows.map(mapRow);
  }

  update(id: string, input: Partial<CreateSession>): Session | null {
    const existing = this.getById(id);
    if (!existing) return null;
    const now = Date.now();
    const next = CreateSessionSchema.parse({ ...existing, ...input });
    this.db.prepare(`
      UPDATE session SET repo_fingerprint = ?, repo_canonical = ?, author_id = ?, agent = ?, platform_source = ?,
        status = ?, metadata = ?, started_at_epoch = ?, ended_at_epoch = ?, updated_at_epoch = ?
      WHERE id = ?
    `).run(
      next.repo_fingerprint, next.repo_canonical, next.author_id, next.agent, next.platform_source,
      next.status, stringifyJson(next.metadata), next.started_at_epoch, next.ended_at_epoch ?? null, now, id,
    );
    return this.getById(id);
  }
}
