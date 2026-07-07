import type { Hono } from "hono";
import { IngestRequestSchema, scanSecrets, type IngestMemory } from "@aznex/shared";
import type { AppEnv } from "../app.js";
import { loadConfig } from "../config.js";
import { apiKeyAuth } from "../middleware/auth.js";
import { verifyRepoAccess } from "../auth/repo-access.js";
import { RepoRepository } from "../repositories/repo.js";
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

    // Repo must be known to the service (onboarded) and the caller must have access.
    const repo = new RepoRepository(db).getActiveByFingerprint(req.repo_fingerprint);
    if (!repo) return c.json({ error: "unknown_repo" }, 403);
    const access = await verifyRepoAccess({ user, repo, config: loadConfig() });
    if (!access.allowed) return c.json({ error: "forbidden" }, 403);

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
      const scan = scanSecrets(m.content);
      if (!scan.clean) {
        const types = [...new Set(scan.violations.map((v) => v.type))].join(", ");
        rejected.push({ id: m.id, reason: `secret detected: ${types}` });
        continue; // reject per-memory, not the whole batch
      }
      // Idempotent: a memory already stored (same id) is a no-op re-send.
      if (!memories.getById(m.id)) {
        memories.create(toCreateMemory(m, req, user.id));
        for (const a of m.anchors) {
          anchors.upsert({ memory_id: m.id, path: a.path, commit_sha: a.commit_sha ?? null });
        }
      }
      accepted++;
    }

    return c.json({ accepted, rejected }, 202);
  });
}

// The wire payload (IngestMemory) is thin; the memory table is rich. Fill the
// non-extracted fields with defaults — the worker only sends the essentials.
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
    title: null,
    content: m.content,
    narrative: null,
    facts: [],
    concepts: [],
    files_read: [],
    files_modified: [],
    confirmed_commit: m.confirmed_commit ?? null,
    ai_extracted: m.ai_extracted,
    metadata: {},
  };
}
