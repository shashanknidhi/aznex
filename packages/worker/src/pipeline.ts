import { computeRepoFingerprint, type IngestRequest } from "@aznex/shared";
import type { HookPayload } from "./queue.js";
import { compressToolEvent, type RawObservation, type ToolEvent } from "./compress.js";
import { extractMemories, type ExtractionRunner } from "./extract.js";
import { scrubContent } from "./scrub.js";
import { postIngest, type IngestClientOptions } from "./ingest-client.js";
import { loadWorkerConfig, resolveApiKey } from "./config.js";

// Full write pipeline (#16, #18–#21): PostToolUse events are compressed and
// buffered per session; Stop triggers extract → scrub → POST /v1/ingest.
// Raw tool I/O never leaves this machine — only scrubbed, structured
// memories are POSTed.

interface SessionBuffer {
  cwd: string;
  agent: string;
  startedAtEpoch: number;
  observations: RawObservation[];
}

export interface PipelineDeps {
  runner?: ExtractionRunner;
  ingest?: Partial<IngestClientOptions>;
  configPath?: string;
}

const ONBOARDED_TTL_MS = 5 * 60_000;

export function createPipeline(deps: PipelineDeps = {}) {
  const sessions = new Map<string, SessionBuffer>();
  // ponytail: unbounded session-id sets — a few hundred bytes per session for
  // a daemon that restarts on login. Prune by age if a long-lived host cares.
  const everBuffered = new Set<string>();
  const sawToolEvent = new Set<string>();
  const warnedEmpty = new Set<string>();
  // Cached per API key: /api/repos answers for the calling identity, so a
  // machine with a work key and a personal key gets two different lists and
  // one shared cache would hide each account's repos from the other.
  const onboardedByKey = new Map<string, { fingerprints: Set<string>; fetchedAtMs: number; everFetched: boolean }>();

  // Gate BEFORE extraction: LLM calls for repos the service will 403 anyway
  // are pure quota burn (hooks are global — every session on the machine
  // fires them). Fails open when the list can't be fetched.
  async function isOnboarded(fingerprint: string, serviceUrl: string, apiKey: string): Promise<boolean> {
    const doFetch = deps.ingest?.fetchImpl ?? fetch;
    let onboarded = onboardedByKey.get(apiKey);
    if (!onboarded) {
      onboarded = { fingerprints: new Set<string>(), fetchedAtMs: 0, everFetched: false };
      onboardedByKey.set(apiKey, onboarded);
    }
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
    // A silent return here made a lost session indistinguishable from one that
    // never happened: every PostToolUse dropped (relay timeout, daemon restart
    // wiping this Map) and the log stayed empty. Say so — but Stop fires every
    // turn, so stay quiet for a session that already ingested (normal
    // prose-only turn) and say it at most once per session.
    if (!buffer) {
      if (!everBuffered.has(sessionId) && !warnedEmpty.has(sessionId)) {
        warnedEmpty.add(sessionId);
        console.log(
          sawToolEvent.has(sessionId)
            ? `session ${sessionId}: every tool event was filtered as noise — nothing to ingest`
            : `session ${sessionId}: nothing buffered — no PostToolUse event arrived (check ~/.aznex/logs/hook.log)`,
        );
      }
      return;
    }

    const fingerprint = await computeRepoFingerprint(buffer.cwd);
    if (!fingerprint) {
      console.warn(`session ${sessionId}: no resolvable git remote in ${buffer.cwd} — skipping ingest`);
      return;
    }

    const config = loadWorkerConfig(deps.configPath);
    const serviceUrl = deps.ingest?.serviceUrl ?? config.serviceUrl;
    const apiKey = deps.ingest?.apiKey ?? resolveApiKey(config, fingerprint);
    if (!serviceUrl || !apiKey) {
      console.warn(`session ${sessionId} (${fingerprint}): service URL / API key not configured — skipping extraction`);
      return;
    }
    if (!(await isOnboarded(fingerprint, serviceUrl, apiKey))) {
      console.log(`session ${sessionId} (${fingerprint}): repo not onboarded — skipping extraction`);
      return;
    }

    // One session the model answered badly is a dropped session, not a worker
    // fault: let it escape and the queue logs "pipeline error (payload
    // dropped)" with a stack trace, which reads like the daemon is broken.
    let memories;
    try {
      memories = await extractMemories(
        buffer.observations,
        { repoFingerprint: fingerprint, sessionId, agent: buffer.agent },
        deps.runner,
      );
    } catch (err) {
      console.warn(
        `session ${sessionId} (${fingerprint}): extraction failed — ${err instanceof Error ? err.message : err}`,
      );
      return;
    }

    const ingestMemories: IngestRequest["memories"] = [];
    for (const m of memories) {
      // Every free-text field is persisted and searchable, so every one is
      // scrubbed. content is required; the rest drop out if they scrub to
      // nothing rather than taking the whole memory down with them.
      const scrubbed = scrubContent(m.content);
      if (scrubbed === null) {
        console.warn(`memory ${m.id}: failed secret scrub — excluded from payload`);
        continue;
      }
      ingestMemories.push({
        id: m.id,
        type: m.type,
        title: m.title === null ? null : scrubContent(m.title),
        content: scrubbed,
        narrative: m.narrative === null ? null : scrubContent(m.narrative),
        facts: m.facts.map(scrubContent).filter((f): f is string => f !== null),
        concepts: m.concepts,
        files_read: m.files_read,
        files_modified: m.files_modified,
        metadata: m.metadata,
        ai_extracted: true,
      });
    }
    if (ingestMemories.length === 0) return;

    // fingerprint is host/owner/name; canonical display form is owner/name.
    const request: IngestRequest = {
      repo_fingerprint: fingerprint,
      repo_canonical: fingerprint.split("/").slice(1).join("/"),
      session: {
        id: sessionId,
        agent: buffer.agent,
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
      // Recorded before the filter: "every event was noise" and "no event ever
      // arrived" are different failures and want different log lines.
      sawToolEvent.add(sessionId);
      const observation = compressToolEvent(payload as unknown as ToolEvent);
      if (!observation) return;
      const buffer = sessions.get(sessionId) ?? {
        cwd: typeof payload["cwd"] === "string" ? payload["cwd"] : process.cwd(),
        // Stamped by the hook relay (?agent=…); Claude Code's hooks predate the
        // param, so an unlabelled session is still claude-code.
        agent: typeof payload["agent"] === "string" ? payload["agent"] : "claude-code",
        startedAtEpoch: Date.now(),
        observations: [],
      };
      buffer.observations.push(observation);
      sessions.set(sessionId, buffer);
      everBuffered.add(sessionId);
      return;
    }

    if (event === "Stop" || event === "SessionEnd") {
      await finalizeSession(sessionId);
    }
  };
}

export const processHookPayload = createPipeline();
