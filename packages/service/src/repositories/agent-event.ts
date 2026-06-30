import { Database } from 'bun:sqlite';
import { AgentEventSchema, CreateAgentEventSchema, type AgentEvent, type CreateAgentEvent } from '@aznex/shared';
import { ensureSchema } from '../db/schema.js';
import { parseJsonUnknown, stringifyJson } from '../db/serde.js';
import type { IAgentEventRepository } from './interfaces.js';

interface AgentEventRow {
  id: string;
  repo_fingerprint: string;
  session_id: string | null;
  source_type: string;
  event_type: string;
  payload: string;
  idempotency_key: string;
  occurred_at_epoch: number;
  created_at_epoch: number;
}

function mapRow(row: AgentEventRow): AgentEvent {
  return AgentEventSchema.parse({
    id: row.id,
    repo_fingerprint: row.repo_fingerprint,
    session_id: row.session_id,
    source_type: row.source_type,
    event_type: row.event_type,
    payload: parseJsonUnknown(row.payload),
    idempotency_key: row.idempotency_key,
    occurred_at_epoch: row.occurred_at_epoch,
    created_at_epoch: row.created_at_epoch,
  });
}

export class AgentEventRepository implements IAgentEventRepository {
  constructor(private db: Database) {
    ensureSchema(this.db);
  }

  create(input: CreateAgentEvent): AgentEvent {
    const data = CreateAgentEventSchema.parse(input);
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO agent_event (id, repo_fingerprint, session_id, source_type, event_type, payload, idempotency_key, occurred_at_epoch, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.id, data.repo_fingerprint, data.session_id ?? null,
      data.source_type, data.event_type, stringifyJson(data.payload),
      data.idempotency_key, data.occurred_at_epoch, now,
    );
    return this.getById(data.id)!;
  }

  getById(id: string): AgentEvent | null {
    const row = this.db.prepare('SELECT * FROM agent_event WHERE id = ?').get(id) as AgentEventRow | null;
    return row ? mapRow(row) : null;
  }

  getByIdempotencyKey(key: string): AgentEvent | null {
    const row = this.db.prepare('SELECT * FROM agent_event WHERE idempotency_key = ?').get(key) as AgentEventRow | null;
    return row ? mapRow(row) : null;
  }

  listByRepo(repoFingerprint: string, limit = 100): AgentEvent[] {
    const rows = this.db.prepare(
      'SELECT * FROM agent_event WHERE repo_fingerprint = ? ORDER BY occurred_at_epoch DESC LIMIT ?'
    ).all(repoFingerprint, limit) as AgentEventRow[];
    return rows.map(mapRow);
  }

  listBySession(sessionId: string): AgentEvent[] {
    const rows = this.db.prepare(
      'SELECT * FROM agent_event WHERE session_id = ? ORDER BY occurred_at_epoch ASC'
    ).all(sessionId) as AgentEventRow[];
    return rows.map(mapRow);
  }
}
