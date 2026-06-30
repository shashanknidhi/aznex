import { randomUUID } from 'crypto';
import { Database } from 'bun:sqlite';
import { RepoSchema, CreateRepoSchema, type Repo, type CreateRepo } from '@aznex/shared';
import { ensureSchema } from '../db/schema.js';
import { parseJsonObject, stringifyJson } from '../db/serde.js';
import type { IRepoRepository } from './interfaces.js';

interface RepoRow {
  id: string;
  fingerprint: string;
  canonical: string;
  github_repo_id: string;
  github_installation_id: number;
  status: string;
  metadata: string;
  created_at_epoch: number;
  updated_at_epoch: number;
}

function mapRow(row: RepoRow): Repo {
  return RepoSchema.parse({
    id: row.id,
    fingerprint: row.fingerprint,
    canonical: row.canonical,
    github_repo_id: row.github_repo_id,
    github_installation_id: row.github_installation_id,
    status: row.status,
    metadata: parseJsonObject(row.metadata),
    created_at_epoch: row.created_at_epoch,
    updated_at_epoch: row.updated_at_epoch,
  });
}

export class RepoRepository implements IRepoRepository {
  constructor(private db: Database) {
    ensureSchema(this.db);
  }

  create(input: CreateRepo): Repo {
    const data = CreateRepoSchema.parse(input);
    const now = Date.now();
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO repo (id, fingerprint, canonical, github_repo_id, github_installation_id, status, metadata, created_at_epoch, updated_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.fingerprint, data.canonical, data.github_repo_id, data.github_installation_id, data.status, stringifyJson(data.metadata), now, now);
    return this.getById(id)!;
  }

  getById(id: string): Repo | null {
    const row = this.db.prepare('SELECT * FROM repo WHERE id = ?').get(id) as RepoRow | null;
    return row ? mapRow(row) : null;
  }

  getByFingerprint(fingerprint: string): Repo | null {
    const row = this.db.prepare('SELECT * FROM repo WHERE fingerprint = ?').get(fingerprint) as RepoRow | null;
    return row ? mapRow(row) : null;
  }

  update(id: string, input: Partial<CreateRepo>): Repo | null {
    const existing = this.getById(id);
    if (!existing) return null;
    const now = Date.now();
    const next = CreateRepoSchema.parse({ ...existing, ...input });
    this.db.prepare(`
      UPDATE repo SET fingerprint = ?, canonical = ?, github_repo_id = ?, github_installation_id = ?, status = ?, metadata = ?, updated_at_epoch = ?
      WHERE id = ?
    `).run(next.fingerprint, next.canonical, next.github_repo_id, next.github_installation_id, next.status, stringifyJson(next.metadata), now, id);
    return this.getById(id);
  }

  list(limit = 100): Repo[] {
    const rows = this.db.prepare('SELECT * FROM repo ORDER BY created_at_epoch DESC LIMIT ?').all(limit) as RepoRow[];
    return rows.map(mapRow);
  }
}
