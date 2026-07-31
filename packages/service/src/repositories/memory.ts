import { Database } from 'bun:sqlite';
import {
  MemorySchema, CreateMemorySchema,
  type Memory, type CreateMemory, type MemoryType,
} from '@aznex/shared';
import { ensureSchema } from '../db/schema.js';
import { parseJsonArray, parseJsonObject, stringifyJson } from '../db/serde.js';
import type { IMemoryRepository } from './interfaces.js';

interface MemoryRow {
  id: string;
  repo_fingerprint: string;
  session_id: string | null;
  author_id: string;
  agent: string;
  kind: string;
  type: string;
  title: string | null;
  content: string;
  narrative: string | null;
  facts: string;
  concepts: string;
  files_read: string;
  files_modified: string;
  ai_extracted: number;
  metadata: string;
  created_at_epoch: number;
  updated_at_epoch: number;
}

function mapRow(row: MemoryRow): Memory {
  return MemorySchema.parse({
    id: row.id,
    repo_fingerprint: row.repo_fingerprint,
    session_id: row.session_id,
    author_id: row.author_id,
    agent: row.agent,
    kind: row.kind,
    type: row.type,
    title: row.title,
    content: row.content,
    narrative: row.narrative,
    facts: parseJsonArray(row.facts),
    concepts: parseJsonArray(row.concepts),
    files_read: parseJsonArray(row.files_read),
    files_modified: parseJsonArray(row.files_modified),
    ai_extracted: row.ai_extracted === 1,
    metadata: parseJsonObject(row.metadata),
    created_at_epoch: row.created_at_epoch,
    updated_at_epoch: row.updated_at_epoch,
  });
}

function buildFtsQuery(query: string): string {
  return query
    .normalize('NFKC')
    .trim()
    .split(/\s+/)
    .flatMap(token => token.split(/[^\p{L}\p{N}_]+/gu))
    .filter(Boolean)
    .map(token => `"${token}"`)
    .join(' ');
}

// Optional type filter. Qualified as `memory.type` so the same clause works in
// the FTS join, where `memory_fts` is also in scope.
function typeClause(type?: MemoryType): string {
  return type ? ' AND memory.type = ?' : '';
}

function typeArgs(type?: MemoryType): string[] {
  return type ? [type] : [];
}

export class MemoryRepository implements IMemoryRepository {
  constructor(private db: Database) {
    ensureSchema(this.db);
  }

  create(input: CreateMemory): Memory {
    const data = CreateMemorySchema.parse(input);
    const now = Date.now();
    const id = data.id; // client-supplied idempotency key (like session.id)
    this.db.prepare(`
      INSERT INTO memory (
        id, repo_fingerprint, session_id, author_id, agent, kind, type, title, content,
        narrative, facts, concepts, files_read, files_modified,
        ai_extracted, metadata, created_at_epoch, updated_at_epoch
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, data.repo_fingerprint, data.session_id ?? null, data.author_id, data.agent,
      data.kind, data.type, data.title ?? null, data.content,
      data.narrative ?? null,
      stringifyJson(data.facts), stringifyJson(data.concepts),
      stringifyJson(data.files_read), stringifyJson(data.files_modified),
      data.ai_extracted ? 1 : 0,
      stringifyJson(data.metadata), now, now,
    );
    return this.getById(id)!;
  }

  getById(id: string): Memory | null {
    const row = this.db.prepare('SELECT * FROM memory WHERE id = ?').get(id) as MemoryRow | null;
    return row ? mapRow(row) : null;
  }

  update(id: string, input: Partial<CreateMemory>): Memory | null {
    const existing = this.getById(id);
    if (!existing) return null;
    const now = Date.now();
    const next = CreateMemorySchema.parse({ ...existing, ...input });
    this.db.prepare(`
      UPDATE memory SET
        repo_fingerprint = ?, session_id = ?, author_id = ?, agent = ?, kind = ?, type = ?,
        title = ?, content = ?, narrative = ?, facts = ?, concepts = ?,
        files_read = ?, files_modified = ?, ai_extracted = ?,
        metadata = ?, updated_at_epoch = ?
      WHERE id = ?
    `).run(
      next.repo_fingerprint, next.session_id ?? null, next.author_id, next.agent, next.kind, next.type,
      next.title ?? null, next.content, next.narrative ?? null,
      stringifyJson(next.facts), stringifyJson(next.concepts),
      stringifyJson(next.files_read), stringifyJson(next.files_modified),
      next.ai_extracted ? 1 : 0,
      stringifyJson(next.metadata), now, id,
    );
    return this.getById(id);
  }

  listByRepo(repoFingerprint: string, limit = 100, offset = 0, type?: MemoryType): Memory[] {
    const rows = this.db.prepare(
      `SELECT * FROM memory WHERE repo_fingerprint = ?${typeClause(type)}
       ORDER BY created_at_epoch DESC LIMIT ? OFFSET ?`
    ).all(repoFingerprint, ...typeArgs(type), limit, offset) as MemoryRow[];
    return rows.map(mapRow);
  }

  countByRepo(repoFingerprint: string, type?: MemoryType): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) AS n FROM memory WHERE repo_fingerprint = ?${typeClause(type)}`
    ).get(repoFingerprint, ...typeArgs(type)) as { n: number };
    return row.n;
  }

  listBySession(sessionId: string): Memory[] {
    const rows = this.db.prepare(
      'SELECT * FROM memory WHERE session_id = ? ORDER BY created_at_epoch ASC'
    ).all(sessionId) as MemoryRow[];
    return rows.map(mapRow);
  }

  search(repoFingerprint: string, query: string, limit = 20, offset = 0, type?: MemoryType): Memory[] {
    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) return [];
    const rows = this.db.prepare(`
      SELECT memory.*
      FROM memory
      JOIN memory_fts ON memory_fts.memory_id = memory.id
      WHERE memory_fts.repo_fingerprint = ?
        AND memory_fts MATCH ?${typeClause(type)}
      ORDER BY bm25(memory_fts)
      LIMIT ? OFFSET ?
    `).all(repoFingerprint, ftsQuery, ...typeArgs(type), limit, offset) as MemoryRow[];
    return rows.map(mapRow);
  }

  countSearch(repoFingerprint: string, query: string, type?: MemoryType): number {
    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) return 0;
    const row = this.db.prepare(`
      SELECT COUNT(*) AS n
      FROM memory
      JOIN memory_fts ON memory_fts.memory_id = memory.id
      WHERE memory_fts.repo_fingerprint = ?
        AND memory_fts MATCH ?${typeClause(type)}
    `).get(repoFingerprint, ftsQuery, ...typeArgs(type)) as { n: number };
    return row.n;
  }

  delete(id: string): boolean {
    // Anchors cascade via FK; the FTS delete trigger clears the index row.
    return this.db.prepare('DELETE FROM memory WHERE id = ?').run(id).changes > 0;
  }
}
