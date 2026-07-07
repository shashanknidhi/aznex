import { join } from "path";
import { tmpdir } from "os";
import { writeFileSync, existsSync, rmSync } from "fs";
import { execSync } from "child_process";
import { MemorySchema, type Memory } from "@aznex/shared";
import type { RawObservation } from "./compress.js";

// LLM extraction stage (#19). Distills raw_observation records into typed
// memories via the Claude Agent SDK pattern: spawn the local `claude` binary
// (developer's own subscription — no API key), same as the Phase 0 eval.

// Versioned prompt: the Phase-0-validated extraction prompt, pinned.
export const EXTRACTION_PROMPT_VERSION = "extraction-v1";
export const EXTRACTION_PROMPT_PATH = join(import.meta.dir, "prompts", "extraction.md");

export interface ExtractionContext {
  repoFingerprint: string;
  sessionId: string;
}

// Runner is injectable so tests never spawn a real Claude process.
export type ExtractionRunner = (promptPath: string, observationsPath: string) => Promise<string>;

export function findClaude(): string {
  const envPath = process.env["CLAUDE_CODE_PATH"];
  if (envPath) {
    if (!existsSync(envPath)) throw new Error(`CLAUDE_CODE_PATH set but not found: ${envPath}`);
    return envPath;
  }
  try {
    return execSync("which claude", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    throw new Error("claude executable not found. Install Claude Code or set CLAUDE_CODE_PATH.");
  }
}

const defaultRunner: ExtractionRunner = async (promptPath, observationsPath) => {
  const proc = Bun.spawn(
    [
      findClaude(), "-p",
      "--output-format", "json",
      "--allowedTools", "Read",
      "--system-prompt-file", promptPath,
      `Read the session transcript at ${observationsPath} and extract memory records as a JSON array.`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if ((await proc.exited) !== 0) throw new Error(`claude exited ${proc.exitCode}: ${stderr.slice(0, 300)}`);
  const envelope = JSON.parse(stdout) as { result?: string; is_error?: boolean };
  if (envelope.is_error) throw new Error(`claude error: ${envelope.result ?? "(no message)"}`);
  return envelope.result ?? "";
};

/**
 * Runs extraction over compressed observations and returns validated Memory
 * records. Only structured output crosses this boundary — raw tool I/O stays
 * in the observations file, which is deleted afterwards.
 */
export async function extractMemories(
  observations: RawObservation[],
  ctx: ExtractionContext,
  runner: ExtractionRunner = defaultRunner,
): Promise<Memory[]> {
  if (observations.length === 0) return [];

  // The validated prompt reads a JSONL transcript path via the Read tool.
  const observationsPath = join(tmpdir(), `aznex-obs-${ctx.sessionId}-${Date.now()}.jsonl`);
  writeFileSync(observationsPath, observations.map((o) => JSON.stringify(o)).join("\n"), "utf-8");

  try {
    const resultText = await runner(EXTRACTION_PROMPT_PATH, observationsPath);
    const raw = JSON.parse(resultText) as unknown;
    if (!Array.isArray(raw)) throw new Error("extraction output is not a JSON array");

    const now = Date.now();
    return raw.map((record) =>
      MemorySchema.parse({
        ...(record as object),
        id: crypto.randomUUID(),
        repo_fingerprint: ctx.repoFingerprint,
        session_id: ctx.sessionId,
        author_id: "worker", // service attributes the real author from the API key
        agent: "claude-code",
        kind: "observation",
        ai_extracted: true,
        confirmed_commit: null,
        // Provenance: which prompt/model produced this record.
        metadata: { prompt_version: EXTRACTION_PROMPT_VERSION, model: process.env["AZNEX_EXTRACT_MODEL"] ?? "claude-default" },
        created_at_epoch: now,
        updated_at_epoch: now,
      }),
    );
  } finally {
    rmSync(observationsPath, { force: true }); // raw tool I/O never lingers
  }
}
