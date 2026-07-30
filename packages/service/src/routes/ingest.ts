import type { Hono } from "hono";
import { IngestRequestSchema, scanSecrets, type IngestMemory } from "@aznex/shared";
import type { AppEnv } from "../app.js";
import { loadConfig } from "../config.js";
import { apiKeyAuth } from "../middleware/auth.js";
import { authorizeRepo, isDenial } from "../auth/authorize.js";
import { SessionRepository } from "../repositories/session.js";
import { MemoryRepository } from "../repositories/memory.js";
import { MemoryAnchorRepository } from "../repositories/memory-anchor.js";

// The write path. Worker POSTs a session + memories; we authenticate, verify the
// caller's access to the repo, re-scan every memory for secrets (authoritative
// server-side pass), and persist the clean ones. Idempotent on session.id + memory.id.
export function registerIngestRoutes(app: Hono<AppEnv>): void {
  app.post("/ingest", apiKeyAuth(), async (c) => {
    const parsed = IngestRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    const req = parsed.data;

    const user = c.get("user");
    const db = c.get("db");

    // Repo must be onboarded, its org active, and the caller both an org member
    // and a GitHub collaborator on it.
    const auth = await authorizeRepo({ db, user, fingerprint: req.repo_fingerprint, config: loadConfig() });
    if (isDenial(auth)) return c.json({ error: auth }, 403);
    const { repo } = auth;

    // Persist the session idempotently before its memories.
    const sessions = new SessionRepository(db);
    if (!sessions.getById(req.session.id)) {
      sessions.create({
        id: req.session.id,
        repo_fingerprint: repo.fingerprint,
        repo_canonical: repo.canonical,
        author_id: user.id,
        agent: req.session.agent,
        platform_source: req.session.agent,
        status: "active",
        metadata: {},
        started_at_epoch: req.session.started_at_epoch ?? Date.now(),
        ended_at_epoch: req.session.ended_at_epoch ?? null,
      });
    }

    const memories = new MemoryRepository(db);
    const anchors = new MemoryAnchorRepository(db);
    const rejected: { id: string; reason: string }[] = [];
    let accepted = 0;

    for (const m of req.memories) {
      // Every text field is persisted, so every text field is scanned.
      const scan = scanSecrets(memoryText(m));
      if (!scan.clean) {
        const types = [...new Set(scan.violations.map((v) => v.type))].join(", ");
        rejected.push({ id: m.id, reason: `secret detected: ${types}` });
        continue; // reject per-memory, not the whole batch
      }
      // Idempotent: a memory already stored (same id) is a no-op re-send.
      const alreadyStored = Boolean(memories.getById(m.id));
      if (!alreadyStored) {
        memories.create(toCreateMemory(m, req, user.id));
        // Anchors are the files this memory is about — derived here so the wire
        // payload carries each path once.
        for (const path of new Set([...m.files_modified, ...m.files_read])) {
          anchors.upsert({ memory_id: m.id, path });
        }
      }
      accepted++;
    }

    return c.json({ accepted, rejected }, 202);
  });
}

// Every field the extractor produced, since every one of them is searchable:
// memory_fts indexes content, title, narrative, facts and concepts.
function toCreateMemory(
  m: IngestMemory,
  req: { repo_fingerprint: string; session: { id: string; agent: string } },
  authorId: string,
) {
  return {
    id: m.id,
    repo_fingerprint: req.repo_fingerprint,
    session_id: req.session.id,
    author_id: authorId,
    agent: req.session.agent,
    kind: m.type === "summary" ? ("summary" as const) : ("observation" as const),
    type: m.type,
    title: m.title,
    content: m.content,
    narrative: m.narrative,
    facts: m.facts,
    concepts: m.concepts,
    files_read: m.files_read,
    files_modified: m.files_modified,
    ai_extracted: m.ai_extracted,
    metadata: m.metadata, // provenance: extraction prompt version + model
  };
}

/** Every free-text field that reaches the database, for the secret scan. */
function memoryText(m: IngestMemory): string {
  return [m.title, m.content, m.narrative, ...m.facts, ...m.concepts]
    .filter((s): s is string => typeof s === "string")
    .join("\n");
}
