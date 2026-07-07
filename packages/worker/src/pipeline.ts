import { computeRepoFingerprint, type IngestRequest } from "@aznex/shared";
import type { HookPayload } from "./queue.js";
import { compressToolEvent, type RawObservation, type ToolEvent } from "./compress.js";
import { extractMemories, type ExtractionRunner } from "./extract.js";
import { scrubContent } from "./scrub.js";
import { postIngest, type IngestClientOptions } from "./ingest-client.js";
import { loadWorkerConfig } from "./config.js";

// Full write pipeline (#16, #18–#21): PostToolUse events are compressed and
// buffered per session; Stop triggers extract → scrub → POST /v1/ingest.
// Raw tool I/O never leaves this machine — only scrubbed, structured
// memories are POSTed.

interface SessionBuffer {
  cwd: string;
  startedAtEpoch: number;
  observations: RawObservation[];
}

export interface PipelineDeps {
  runner?: ExtractionRunner;
  ingest?: Partial<IngestClientOptions>;
  git?: (cwd: string) => Promise<string | null>; // HEAD sha for anchors
}

async function gitHead(cwd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd, stdout: "pipe", stderr: "ignore" });
    const [code, out] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    return code === 0 ? out.trim() : null;
  } catch {
    return null;
  }
}

const ONBOARDED_TTL_MS = 5 * 60_000;

export function createPipeline(deps: PipelineDeps = {}) {
  const sessions = new Map<string, SessionBuffer>();
  const onboarded = { fingerprints: new Set<string>(), fetchedAtMs: 0, everFetched: false };

  // Gate BEFORE extraction: LLM calls for repos the service will 403 anyway
  // are pure quota burn (hooks are global — every session on the machine
  // fires them). Fails open when the list can't be fetched.
  async function isOnboarded(fingerprint: string, serviceUrl: string, apiKey: string): Promise<boolean> {
    const doFetch = deps.ingest?.fetchImpl ?? fetch;
    if (Date.now() - onboarded.fetchedAtMs > ONBOARDED_TTL_MS) {
      try {
        const res = await doFetch(`${serviceUrl}/api/repos`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (res.ok) {
          const { repos } = (await res.json()) as { repos: { fingerprint: string }[] };
          onboarded.fingerprints = new Set(repos.map((r) => r.fingerprint));
          onboarded.fetchedAtMs = Date.now();
          onboarded.everFetched = true;
        }
      } catch {
        // service unreachable — fall through to fail-open below
      }
    }
    if (!onboarded.everFetched) return true; // never got a list: don't block capture
    return onboarded.fingerprints.has(fingerprint);
  }

  async function finalizeSession(sessionId: string): Promise<void> {
    const buffer = sessions.get(sessionId);
    sessions.delete(sessionId);
    if (!buffer || buffer.observations.length === 0) return;

    const fingerprint = await computeRepoFingerprint(buffer.cwd);
    if (!fingerprint) {
      console.warn(`session ${sessionId}: no resolvable git remote in ${buffer.cwd} — skipping ingest`);
      return;
    }

    const config = loadWorkerConfig();
    const serviceUrl = deps.ingest?.serviceUrl ?? config.serviceUrl;
    const apiKey = deps.ingest?.apiKey ?? config.apiKey;
    if (!serviceUrl || !apiKey) {
      console.warn(`session ${sessionId} (${fingerprint}): service URL / API key not configured — skipping extraction`);
      return;
    }
    if (!(await isOnboarded(fingerprint, serviceUrl, apiKey))) {
      console.log(`session ${sessionId} (${fingerprint}): repo not onboarded — skipping extraction`);
      return;
    }

    const memories = await extractMemories(
      buffer.observations,
      { repoFingerprint: fingerprint, sessionId },
      deps.runner,
    );

    const commitSha = await (deps.git ?? gitHead)(buffer.cwd);
    const ingestMemories: IngestRequest["memories"] = [];
    for (const m of memories) {
      const scrubbed = scrubContent(m.content);
      if (scrubbed === null) {
        console.warn(`memory ${m.id}: failed secret scrub — excluded from payload`);
        continue;
      }
      const anchorPaths = [...new Set([...m.files_modified, ...m.files_read])];
      ingestMemories.push({
        id: m.id,
        type: m.type,
        content: scrubbed,
        anchors: anchorPaths.map((path) => ({ path, commit_sha: commitSha })),
        ai_extracted: true,
        confirmed_commit: null,
      });
    }
    if (ingestMemories.length === 0) return;

    // fingerprint is host/owner/name; canonical display form is owner/name.
    const request: IngestRequest = {
      repo_fingerprint: fingerprint,
      repo_canonical: fingerprint.split("/").slice(1).join("/"),
      session: {
        id: sessionId,
        agent: "claude-code",
        started_at_epoch: buffer.startedAtEpoch,
        ended_at_epoch: Date.now(),
      },
      memories: ingestMemories,
    };
    try {
      const response = await postIngest(request, { ...deps.ingest, serviceUrl, apiKey });
      console.log(`session ${sessionId} (${fingerprint}): ingested ${response.accepted} memories (${response.rejected.length} rejected)`);
    } catch (err) {
      // Named context: an anonymous "payload dropped" cost real debugging time.
      console.warn(`session ${sessionId} (${fingerprint}): ingest failed — ${err instanceof Error ? err.message : err}`);
    }
  }

  return async function processHookPayload(payload: HookPayload): Promise<void> {
    const event = payload["hook_event_name"];
    const sessionId = typeof payload["session_id"] === "string" ? payload["session_id"] : null;
    if (!sessionId) return;

    if (event === "PostToolUse" && typeof payload["tool_name"] === "string") {
      const observation = compressToolEvent(payload as unknown as ToolEvent);
      if (!observation) return;
      const buffer = sessions.get(sessionId) ?? {
        cwd: typeof payload["cwd"] === "string" ? payload["cwd"] : process.cwd(),
        startedAtEpoch: Date.now(),
        observations: [],
      };
      buffer.observations.push(observation);
      sessions.set(sessionId, buffer);
      return;
    }

    if (event === "Stop" || event === "SessionEnd") {
      await finalizeSession(sessionId);
    }
  };
}

export const processHookPayload = createPipeline();
