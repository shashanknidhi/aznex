import { Database } from 'bun:sqlite';
import {
  MemorySchema, CreateMemorySchema,
  type Memory, type CreateMemory, type FreshnessState, type PromotionState,
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
  freshness_state: string;
  promotion_state: string;
  confirmed_commit: string | null;
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
    freshness_state: row.freshness_state,
    promotion_state: row.promotion_state,
    confirmed_commit: row.confirmed_commit,
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
        freshness_state, promotion_state, confirmed_commit, ai_extracted,
        metadata, created_at_epoch, updated_at_epoch
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'fresh', 'private', ?, ?, ?, ?, ?)
    `).run(
      id, data.repo_fingerprint, data.session_id ?? null, data.author_id, data.agent,
      data.kind, data.type, data.title ?? null, data.content,
      data.narrative ?? null,
      stringifyJson(data.facts), stringifyJson(data.concepts),
      stringifyJson(data.files_read), stringifyJson(data.files_modified),
      data.confirmed_commit ?? null,
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
    // freshness_state and promotion_state are intentionally excluded from this UPDATE —
    // they are managed exclusively via setFreshness() and setPromotion().
    this.db.prepare(`
      UPDATE memory SET
        repo_fingerprint = ?, session_id = ?, author_id = ?, agent = ?, kind = ?, type = ?,
        title = ?, content = ?, narrative = ?, facts = ?, concepts = ?,
        files_read = ?, files_modified = ?, confirmed_commit = ?, ai_extracted = ?,
        metadata = ?, updated_at_epoch = ?
      WHERE id = ?
    `).run(
      next.repo_fingerprint, next.session_id ?? null, next.author_id, next.agent, next.kind, next.type,
      next.title ?? null, next.content, next.narrative ?? null,
      stringifyJson(next.facts), stringifyJson(next.concepts),
      stringifyJson(next.files_read), stringifyJson(next.files_modified),
      next.confirmed_commit ?? null, next.ai_extracted ? 1 : 0,
      stringifyJson(next.metadata), now, id,
    );
    return this.getById(id);
  }

  listByRepo(repoFingerprint: string, limit = 100): Memory[] {
    const rows = this.db.prepare(
      'SELECT * FROM memory WHERE repo_fingerprint = ? ORDER BY created_at_epoch DESC LIMIT ?'
    ).all(repoFingerprint, limit) as MemoryRow[];
    return rows.map(mapRow);
  }

  listBySession(sessionId: string): Memory[] {
    const rows = this.db.prepare(
      'SELECT * FROM memory WHERE session_id = ? ORDER BY created_at_epoch ASC'
    ).all(sessionId) as MemoryRow[];
    return rows.map(mapRow);
  }

  search(repoFingerprint: string, query: string, limit = 20): Memory[] {
    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) return [];
    const rows = this.db.prepare(`
      SELECT memory.*
      FROM memory
      JOIN memory_fts ON memory_fts.memory_id = memory.id
      WHERE memory_fts.repo_fingerprint = ?
        AND memory_fts MATCH ?
      ORDER BY bm25(memory_fts)
      LIMIT ?
    `).all(repoFingerprint, ftsQuery, limit) as MemoryRow[];
    return rows.map(mapRow);
  }

  setFreshness(id: string, state: FreshnessState): void {
    this.db.prepare('UPDATE memory SET freshness_state = ?, updated_at_epoch = ? WHERE id = ?').run(state, Date.now(), id);
  }

  setPromotion(id: string, state: PromotionState): void {
    this.db.prepare('UPDATE memory SET promotion_state = ?, updated_at_epoch = ? WHERE id = ?').run(state, Date.now(), id);
  }
}
