import { randomUUID } from 'crypto';
import { Database } from 'bun:sqlite';
import { UserSchema, CreateUserSchema, type User, type CreateUser } from '@aznex/shared';
import { ensureSchema } from '../db/schema.js';
import { parseJsonObject, stringifyJson } from '../db/serde.js';
import type { IUserRepository } from './interfaces.js';

interface UserRow {
  id: string;
  github_id: string;
  github_login: string;
  display_name: string | null;
  avatar_url: string | null;
  metadata: string;
  created_at_epoch: number;
  updated_at_epoch: number;
}

function mapRow(row: UserRow): User {
  return UserSchema.parse({
    id: row.id,
    github_id: row.github_id,
    github_login: row.github_login,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    metadata: parseJsonObject(row.metadata),
    created_at_epoch: row.created_at_epoch,
    updated_at_epoch: row.updated_at_epoch,
  });
}

export class UserRepository implements IUserRepository {
  constructor(private db: Database) {
    ensureSchema(this.db);
  }

  create(input: CreateUser): User {
    const data = CreateUserSchema.parse(input);
    const now = Date.now();
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO user (id, github_id, github_login, display_name, avatar_url, metadata, created_at_epoch, updated_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.github_id, data.github_login, data.display_name ?? null, data.avatar_url ?? null, stringifyJson(data.metadata), now, now);
    return this.getById(id)!;
  }

  getById(id: string): User | null {
    const row = this.db.prepare('SELECT * FROM user WHERE id = ?').get(id) as UserRow | null;
    return row ? mapRow(row) : null;
  }

  getByGithubId(githubId: string): User | null {
    const row = this.db.prepare('SELECT * FROM user WHERE github_id = ?').get(githubId) as UserRow | null;
    return row ? mapRow(row) : null;
  }

  update(id: string, input: Partial<CreateUser>): User | null {
    const existing = this.getById(id);
    if (!existing) return null;
    const now = Date.now();
    const next = CreateUserSchema.parse({ ...existing, ...input });
    this.db.prepare(`
      UPDATE user SET github_id = ?, github_login = ?, display_name = ?, avatar_url = ?, metadata = ?, updated_at_epoch = ?
      WHERE id = ?
    `).run(next.github_id, next.github_login, next.display_name ?? null, next.avatar_url ?? null, stringifyJson(next.metadata), now, id);
    return this.getById(id);
  }
}
