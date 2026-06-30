import { randomUUID } from 'crypto';
import { Database } from 'bun:sqlite';
import { ApiKeySchema, CreateApiKeySchema, type ApiKey, type CreateApiKey } from '@aznex/shared';
import { ensureSchema } from '../db/schema.js';
import { parseJsonArray, parseJsonObject, stringifyJson } from '../db/serde.js';
import type { IApiKeyRepository } from './interfaces.js';

interface ApiKeyRow {
  id: string;
  user_id: string;
  name: string;
  key_hash: string;
  prefix: string | null;
  scopes: string;
  status: string;
  last_used_at_epoch: number | null;
  expires_at_epoch: number | null;
  metadata: string;
  created_at_epoch: number;
  updated_at_epoch: number;
}

function mapRow(row: ApiKeyRow): ApiKey {
  return ApiKeySchema.parse({
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    key_hash: row.key_hash,
    prefix: row.prefix,
    scopes: parseJsonArray(row.scopes),
    status: row.status,
    last_used_at_epoch: row.last_used_at_epoch,
    expires_at_epoch: row.expires_at_epoch,
    metadata: parseJsonObject(row.metadata),
    created_at_epoch: row.created_at_epoch,
    updated_at_epoch: row.updated_at_epoch,
  });
}

export class ApiKeyRepository implements IApiKeyRepository {
  constructor(private db: Database) {
    ensureSchema(this.db);
  }

  create(input: CreateApiKey): ApiKey {
    const data = CreateApiKeySchema.parse(input);
    const now = Date.now();
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO api_key (id, user_id, name, key_hash, prefix, scopes, status, last_used_at_epoch, expires_at_epoch, metadata, created_at_epoch, updated_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, data.user_id, data.name, data.key_hash, data.prefix ?? null,
      stringifyJson(data.scopes), data.status,
      data.last_used_at_epoch ?? null, data.expires_at_epoch ?? null,
      stringifyJson(data.metadata), now, now,
    );
    return this.getById(id)!;
  }

  getById(id: string): ApiKey | null {
    const row = this.db.prepare('SELECT * FROM api_key WHERE id = ?').get(id) as ApiKeyRow | null;
    return row ? mapRow(row) : null;
  }

  getByHash(hash: string): ApiKey | null {
    const row = this.db.prepare('SELECT * FROM api_key WHERE key_hash = ?').get(hash) as ApiKeyRow | null;
    return row ? mapRow(row) : null;
  }

  listByUser(userId: string): ApiKey[] {
    const rows = this.db.prepare('SELECT * FROM api_key WHERE user_id = ? ORDER BY created_at_epoch DESC').all(userId) as ApiKeyRow[];
    return rows.map(mapRow);
  }

  revoke(id: string): ApiKey | null {
    const now = Date.now();
    this.db.prepare('UPDATE api_key SET status = ?, updated_at_epoch = ? WHERE id = ?').run('revoked', now, id);
    return this.getById(id);
  }

  touchLastUsed(id: string, nowEpoch: number): void {
    this.db.prepare('UPDATE api_key SET last_used_at_epoch = ?, updated_at_epoch = ? WHERE id = ?').run(nowEpoch, nowEpoch, id);
  }
}
