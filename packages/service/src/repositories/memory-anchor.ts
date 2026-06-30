import { Database } from 'bun:sqlite';
import { MemoryAnchorSchema, type MemoryAnchor } from '@aznex/shared';
import { ensureSchema } from '../db/schema.js';
import type { IMemoryAnchorRepository } from './interfaces.js';

interface MemoryAnchorRow {
  memory_id: string;
  path: string;
  commit_sha: string | null;
}

function mapRow(row: MemoryAnchorRow): MemoryAnchor {
  return MemoryAnchorSchema.parse({
    memory_id: row.memory_id,
    path: row.path,
    commit_sha: row.commit_sha,
  });
}

export class MemoryAnchorRepository implements IMemoryAnchorRepository {
  constructor(private db: Database) {
    ensureSchema(this.db);
  }

  upsert(anchor: MemoryAnchor): MemoryAnchor {
    const data = MemoryAnchorSchema.parse(anchor);
    const row = this.db.prepare(`
      INSERT INTO memory_anchor (memory_id, path, commit_sha)
      VALUES (?, ?, ?)
      ON CONFLICT(memory_id, path) DO UPDATE SET commit_sha = excluded.commit_sha
      RETURNING *
    `).get(data.memory_id, data.path, data.commit_sha ?? null) as MemoryAnchorRow;
    return mapRow(row);
  }

  listByMemory(memoryId: string): MemoryAnchor[] {
    const rows = this.db.prepare('SELECT * FROM memory_anchor WHERE memory_id = ?').all(memoryId) as MemoryAnchorRow[];
    return rows.map(mapRow);
  }

  listByPath(path: string): MemoryAnchor[] {
    const rows = this.db.prepare('SELECT * FROM memory_anchor WHERE path = ?').all(path) as MemoryAnchorRow[];
    return rows.map(mapRow);
  }

  delete(memoryId: string, path: string): void {
    this.db.prepare('DELETE FROM memory_anchor WHERE memory_id = ? AND path = ?').run(memoryId, path);
  }
}
