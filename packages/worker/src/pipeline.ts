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

export function createPipeline(deps: PipelineDeps = {}) {
  const sessions = new Map<string, SessionBuffer>();

  async function finalizeSession(sessionId: string): Promise<void> {
    const buffer = sessions.get(sessionId);
    sessions.delete(sessionId);
    if (!buffer || buffer.observations.length === 0) return;

    const fingerprint = await computeRepoFingerprint(buffer.cwd);
    if (!fingerprint) {
      console.warn(`session ${sessionId}: no resolvable git remote in ${buffer.cwd} — skipping ingest`);
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

    const config = loadWorkerConfig();
    const serviceUrl = deps.ingest?.serviceUrl ?? config.serviceUrl;
    const apiKey = deps.ingest?.apiKey ?? config.apiKey;
    if (!serviceUrl || !apiKey) {
      console.warn("service URL / API key not configured (env or ~/.aznex/config.json) — extracted memories dropped");
      return;
    }

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
    const response = await postIngest(request, { ...deps.ingest, serviceUrl, apiKey });
    console.log(`session ${sessionId}: ingested ${response.accepted} memories (${response.rejected.length} rejected)`);
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
