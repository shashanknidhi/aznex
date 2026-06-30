import { randomUUID } from 'crypto';
import { Database } from 'bun:sqlite';
import {
  GithubInstallationSchema, CreateGithubInstallationSchema,
  type GithubInstallation, type CreateGithubInstallation,
} from '@aznex/shared';
import { ensureSchema } from '../db/schema.js';
import { parseJsonObject, stringifyJson } from '../db/serde.js';
import type { IGithubInstallationRepository } from './interfaces.js';

interface GithubInstallationRow {
  id: string;
  installation_id: number;
  account_type: string;
  account_login: string;
  metadata: string;
  created_at_epoch: number;
  updated_at_epoch: number;
}

function mapRow(row: GithubInstallationRow): GithubInstallation {
  return GithubInstallationSchema.parse({
    id: row.id,
    installation_id: row.installation_id,
    account_type: row.account_type,
    account_login: row.account_login,
    metadata: parseJsonObject(row.metadata),
    created_at_epoch: row.created_at_epoch,
    updated_at_epoch: row.updated_at_epoch,
  });
}

export class GithubInstallationRepository implements IGithubInstallationRepository {
  constructor(private db: Database) {
    ensureSchema(this.db);
  }

  create(input: CreateGithubInstallation): GithubInstallation {
    const data = CreateGithubInstallationSchema.parse(input);
    const now = Date.now();
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO github_installation (id, installation_id, account_type, account_login, metadata, created_at_epoch, updated_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.installation_id, data.account_type, data.account_login, stringifyJson(data.metadata), now, now);
    return this.getById(id)!;
  }

  getById(id: string): GithubInstallation | null {
    const row = this.db.prepare('SELECT * FROM github_installation WHERE id = ?').get(id) as GithubInstallationRow | null;
    return row ? mapRow(row) : null;
  }

  getByInstallationId(installationId: number): GithubInstallation | null {
    const row = this.db.prepare('SELECT * FROM github_installation WHERE installation_id = ?').get(installationId) as GithubInstallationRow | null;
    return row ? mapRow(row) : null;
  }

  update(id: string, input: Partial<CreateGithubInstallation>): GithubInstallation | null {
    const existing = this.getById(id);
    if (!existing) return null;
    const now = Date.now();
    const next = CreateGithubInstallationSchema.parse({ ...existing, ...input });
    this.db.prepare(`
      UPDATE github_installation SET installation_id = ?, account_type = ?, account_login = ?, metadata = ?, updated_at_epoch = ?
      WHERE id = ?
    `).run(next.installation_id, next.account_type, next.account_login, stringifyJson(next.metadata), now, id);
    return this.getById(id);
  }
}
