import { Database } from 'bun:sqlite';
import { RepoMemberSchema, type RepoMember } from '@aznex/shared';
import { ensureSchema } from '../db/schema.js';
import type { IRepoMemberRepository } from './interfaces.js';

interface RepoMemberRow {
  repo_id: string;
  user_id: string;
  github_role: string;
  synced_at_epoch: number;
}

function mapRow(row: RepoMemberRow): RepoMember {
  return RepoMemberSchema.parse({
    repo_id: row.repo_id,
    user_id: row.user_id,
    github_role: row.github_role,
    synced_at_epoch: row.synced_at_epoch,
  });
}

export class RepoMemberRepository implements IRepoMemberRepository {
  constructor(private db: Database) {
    ensureSchema(this.db);
  }

  upsert(input: RepoMember): RepoMember {
    const data = RepoMemberSchema.parse(input);
    this.db.prepare(`
      INSERT INTO repo_member (repo_id, user_id, github_role, synced_at_epoch)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(repo_id, user_id) DO UPDATE SET
        github_role = excluded.github_role,
        synced_at_epoch = excluded.synced_at_epoch
    `).run(data.repo_id, data.user_id, data.github_role, data.synced_at_epoch);
    return this.get(data.repo_id, data.user_id)!;
  }

  get(repoId: string, userId: string): RepoMember | null {
    const row = this.db.prepare('SELECT * FROM repo_member WHERE repo_id = ? AND user_id = ?').get(repoId, userId) as RepoMemberRow | null;
    return row ? mapRow(row) : null;
  }

  listByRepo(repoId: string): RepoMember[] {
    const rows = this.db.prepare('SELECT * FROM repo_member WHERE repo_id = ? ORDER BY synced_at_epoch DESC').all(repoId) as RepoMemberRow[];
    return rows.map(mapRow);
  }

  listByUser(userId: string): RepoMember[] {
    const rows = this.db.prepare('SELECT * FROM repo_member WHERE user_id = ? ORDER BY synced_at_epoch DESC').all(userId) as RepoMemberRow[];
    return rows.map(mapRow);
  }

  delete(repoId: string, userId: string): void {
    this.db.prepare('DELETE FROM repo_member WHERE repo_id = ? AND user_id = ?').run(repoId, userId);
  }
}
