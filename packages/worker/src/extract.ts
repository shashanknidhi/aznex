import { join } from "path";
import { tmpdir, homedir } from "os";
import { writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { execSync } from "child_process";
import { MemorySchema, type Memory } from "@aznex/shared";
import type { RawObservation } from "./compress.js";
import { loadWorkerConfig } from "./config.js";
import { resolveModel, type Engine } from "./models.js";

// LLM extraction stage (#19). Distills raw_observation records into typed
// memories via the Claude Agent SDK pattern: spawn the local `claude` binary
// (developer's own subscription — no API key), same as the Phase 0 eval.

// Versioned prompt: the Phase-0-validated extraction prompt, pinned.
export const EXTRACTION_PROMPT_VERSION = "extraction-v1";
export const EXTRACTION_PROMPT_PATH = join(import.meta.dir, "prompts", "extraction.md");

export interface ExtractionContext {
  repoFingerprint: string;
  sessionId: string;
  agent?: string;
}

// Runner is injectable so tests never spawn a real Claude process.
export type ExtractionRunner = (promptPath: string, observationsPath: string) => Promise<string>;

// Resolution order — adapted from claude-mem's battle-tested resolver
// (https://github.com/thedotmack/claude-mem, src/shared/find-claude-executable.ts),
// which documents this exact daemon failure mode: "may not be on the worker's
// PATH at all depending on how the daemon was spawned".
//   1. CLAUDE_CODE_PATH env — explicit override, fails LOUD if wrong
//   2. ~/.aznex/config.json path persisted by setup — falls through if stale
//      (Claude Code updates can move the binary; don't brick the pipeline)
//   3. `which claude` — works in shells, usually not under launchd/systemd
//   4. known install locations that daemons' minimal PATH never includes
// ponytail: no capability probing / version ranking (claude-mem does both);
// add if stale-CLI selection ever bites the pilot.
// Known locations list also per claude-mem (native installer + legacy local).
const KNOWN_CLAUDE_LOCATIONS = [
  join(homedir(), ".local", "bin", "claude"), // native installer symlink
  join(homedir(), ".claude", "local", "claude"), // legacy local install
];

export function findClaude(configPath?: string): string {
  const env = process.env["CLAUDE_CODE_PATH"];
  if (env) {
    if (!existsSync(env)) throw new Error(`CLAUDE_CODE_PATH set but not found: ${env}`);
    return env;
  }
  const configured = loadWorkerConfig(configPath).claudePath;
  if (configured && existsSync(configured)) return configured;
  try {
    return execSync("which claude", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    // daemon PATH miss — fall through to fixed locations
  }
  for (const candidate of KNOWN_CLAUDE_LOCATIONS) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("claude executable not found. Install Claude Code or set CLAUDE_CODE_PATH.");
}

const KNOWN_CODEX_LOCATIONS = [join(homedir(), ".local", "bin", "codex")];

export function findCodex(configPath?: string): string {
  const env = process.env["CODEX_PATH"];
  if (env) {
    if (!existsSync(env)) throw new Error(`CODEX_PATH set but not found: ${env}`);
    return env;
  }
  const configured = loadWorkerConfig(configPath).codexPath;
  if (configured && existsSync(configured)) return configured;
  try {
    return execSync("which codex", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    // daemon PATH miss — fall through to fixed locations
  }
  for (const candidate of KNOWN_CODEX_LOCATIONS) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("codex executable not found. Install Codex or set CODEX_PATH.");
}

export interface ExtractionEngine {
  engine: Engine;
  path: string;
}

/**
 * Which local agent CLI runs extraction. An `extractAgent` of "claude" or
 * "codex" pins it — a missing CLI throws rather than silently switching, since
 * the user asked for that one. Under "auto" (the default), Claude Code is
 * preferred — the pinned prompt was validated against it — with Codex as the
 * fallback so a Codex-only machine can still onboard.
 */
export function resolveExtractionEngine(
  configPath?: string,
  // injectable so tests can exercise the fallback order without depending on
  // which agent CLIs happen to be installed on the machine running them
  deps: { claude: typeof findClaude; codex: typeof findCodex } = { claude: findClaude, codex: findCodex },
): ExtractionEngine {
  const pinned = loadWorkerConfig(configPath).extractAgent;
  if (pinned === "claude") return { engine: "claude", path: deps.claude(configPath) };
  if (pinned === "codex") return { engine: "codex", path: deps.codex(configPath) };

  try {
    return { engine: "claude", path: deps.claude(configPath) };
  } catch (err) {
    // An explicit CLAUDE_CODE_PATH that doesn't resolve is a mistake worth
    // surfacing — silently switching engines would be a debugging trap.
    if (process.env["CLAUDE_CODE_PATH"]) throw err;
    // otherwise: no claude installed — try codex before giving up
  }
  try {
    return { engine: "codex", path: deps.codex(configPath) };
  } catch {
    throw new Error(
      "neither `claude` nor `codex` found. Install Claude Code or Codex (or set CLAUDE_CODE_PATH / CODEX_PATH).",
    );
  }
}

// Exported for tests: the spawn argv, including --model only when configured
// (unset = the CLI's own default).
export function buildClaudeArgs(claudePath: string, promptPath: string, observationsPath: string, model: string | null): string[] {
  return [
    claudePath, "-p",
    "--output-format", "json",
    "--allowedTools", "Read",
    ...(model ? ["--model", model] : []),
    "--system-prompt-file", promptPath,
    `Read the session transcript at ${observationsPath} and extract memory records as a JSON array.`,
  ];
}

// Codex has no --system-prompt-file and its read-only sandbox makes reading a
// tmp transcript awkward, so the prompt (system prompt + transcript inline)
// goes in on stdin and the answer comes back via --output-last-message.
// `--cd tmpdir` is deliberate: extraction spawns the user's own codex, which
// fires their aznex hooks — a non-git cwd has no repo fingerprint, so
// pipeline.ts drops that relayed session instead of extracting it in a loop.
export function buildCodexArgs(codexPath: string, cwd: string, outFile: string, model: string | null): string[] {
  return [
    codexPath, "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "-s", "read-only",
    "--cd", cwd,
    ...(model ? ["-m", model] : []),
    "-o", outFile,
    "-", // prompt on stdin
  ];
}

// Codex answers in prose-capable markdown; the array may arrive fenced.
export function stripFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced?.[1] ?? text).trim();
}

const claudeRunner = (claudePath: string): ExtractionRunner => async (promptPath, observationsPath) => {
  const proc = Bun.spawn(
    buildClaudeArgs(claudePath, promptPath, observationsPath, extractionModel("claude")),
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

const codexRunner = (codexPath: string): ExtractionRunner => async (promptPath, observationsPath) => {
  const outFile = `${observationsPath}.out`;
  const prompt = [
    readFileSync(promptPath, "utf-8"),
    "Session transcript (JSONL, one observation per line):",
    readFileSync(observationsPath, "utf-8"),
    "Extract memory records from the transcript above and reply with ONLY a JSON array.",
  ].join("\n\n");
  const proc = Bun.spawn(buildCodexArgs(codexPath, tmpdir(), outFile, extractionModel("codex")), {
    stdin: new TextEncoder().encode(prompt),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  if ((await proc.exited) !== 0) throw new Error(`codex exited ${proc.exitCode}: ${stderr.slice(0, 300)}`);
  try {
    if (!existsSync(outFile)) throw new Error("codex produced no final message");
    return stripFence(readFileSync(outFile, "utf-8"));
  } finally {
    rmSync(outFile, { force: true });
  }
};

/**
 * The model this engine runs with. Unset config means the engine's cheapest
 * model, and a model belonging to the *other* engine is discarded — see
 * resolveModel. Exported for the settings API, which shows the effective value.
 */
export function extractionModel(engine: Engine, configPath?: string): string {
  return resolveModel(engine, loadWorkerConfig(configPath).extractModel);
}

const defaultRunner: ExtractionRunner = async (promptPath, observationsPath) => {
  const { engine, path } = resolveExtractionEngine();
  const run = engine === "claude" ? claudeRunner(path) : codexRunner(path);
  return run(promptPath, observationsPath);
};

// Provenance only — an injected test runner means no engine is installed, so
// this must never throw.
function provenanceModel(): string {
  try {
    const { engine } = resolveExtractionEngine();
    return extractionModel(engine);
  } catch {
    return loadWorkerConfig().extractModel ?? "unknown";
  }
}

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
        agent: ctx.agent ?? "claude-code",
        kind: "observation",
        ai_extracted: true,
        confirmed_commit: null,
        // Provenance: which prompt/model produced this record.
        metadata: { prompt_version: EXTRACTION_PROMPT_VERSION, model: provenanceModel() },
        created_at_epoch: now,
        updated_at_epoch: now,
      }),
    );
  } finally {
    rmSync(observationsPath, { force: true }); // raw tool I/O never lingers
  }
}
