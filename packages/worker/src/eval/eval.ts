import { join, dirname } from "path";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { MemorySchema, type Memory } from "@aznex/shared";

// ── helpers ──────────────────────────────────────────────────────────────────

export function injectStubs(raw: unknown): unknown {
  const now = Date.now();
  return {
    ...(raw as object),
    id: "eval-stub",
    repo_fingerprint: "eval/stub",
    session_id: null,
    author_id: "eval",
    agent: "claude-code",
    kind: "observation",
    ai_extracted: true,
    confirmed_commit: null,
    created_at_epoch: now,
    updated_at_epoch: now,
  };
}

export function validateRecord(obj: unknown): Memory {
  return MemorySchema.parse(obj);
}

function findClaude(): string {
  const envPath = process.env.CLAUDE_CODE_PATH;
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

// ── types ─────────────────────────────────────────────────────────────────────

interface FixtureResult {
  fixture: string;
  pass: boolean;
  memoryCount: number;
  types: string[];
  errors: string[];
  records: Memory[];
}

// ── core ──────────────────────────────────────────────────────────────────────

async function extractFromFixture(
  claudePath: string,
  promptPath: string,
  fixturePath: string,
): Promise<FixtureResult> {
  const fixtureName = fixturePath.split("/").pop()!;

  const proc = Bun.spawn(
    [
      claudePath, "-p",
      "--output-format", "json",
      "--allowedTools", "Read",
      "--system-prompt-file", promptPath,
      `Read the session transcript at ${fixturePath} and extract memory records as a JSON array.`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;

  if (proc.exitCode !== 0) {
    return {
      fixture: fixtureName,
      pass: false,
      memoryCount: 0,
      types: [],
      errors: [`claude exited ${proc.exitCode}: ${stderr.slice(0, 300)}`],
      records: [],
    };
  }

  // Parse the outer JSON envelope from --output-format json
  let envelope: { result?: string; is_error?: boolean };
  try {
    envelope = JSON.parse(stdout);
  } catch {
    return {
      fixture: fixtureName,
      pass: false,
      memoryCount: 0,
      types: [],
      errors: [`Failed to parse claude JSON envelope: ${stdout.slice(0, 200)}`],
      records: [],
    };
  }

  if (envelope.is_error) {
    return {
      fixture: fixtureName,
      pass: false,
      memoryCount: 0,
      types: [],
      errors: [`claude returned is_error=true: ${envelope.result ?? "(no message)"}`],
      records: [],
    };
  }

  const resultText = envelope.result ?? "";

  // Parse the inner JSON array from Claude's response text
  let rawRecords: unknown[];
  try {
    rawRecords = JSON.parse(resultText);
    if (!Array.isArray(rawRecords)) throw new Error("not an array");
  } catch {
    return {
      fixture: fixtureName,
      pass: false,
      memoryCount: 0,
      types: [],
      errors: [`Claude response is not a JSON array: ${resultText.slice(0, 300)}`],
      records: [],
    };
  }

  // Inject stubs and validate each record
  const records: Memory[] = [];
  const errors: string[] = [];

  for (let i = 0; i < rawRecords.length; i++) {
    try {
      const combined = injectStubs(rawRecords[i]);
      records.push(validateRecord(combined));
    } catch (err) {
      errors.push(`Record ${i}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const pass = errors.length === 0 && records.length > 0;
  const types = [...new Set(records.map((r) => r.type))];

  return { fixture: fixtureName, pass, memoryCount: records.length, types, errors, records };
}

function buildReport(results: FixtureResult[]): string {
  const ts = new Date().toISOString();
  const passed = results.filter((r) => r.pass).length;
  const lines: string[] = [
    `# LLM Extraction Eval — ${ts}`,
    "",
    `**Result:** ${passed}/${results.length} fixtures passed`,
    "",
    "## Fixtures",
    "",
  ];

  for (const r of results) {
    lines.push(`### ${r.fixture} — ${r.pass ? "PASS" : "FAIL"}`);
    lines.push("");
    lines.push(`- Memories extracted: ${r.memoryCount}`);
    lines.push(`- Types: ${r.types.join(", ") || "(none)"}`);
    if (r.errors.length > 0) {
      lines.push("- Errors:");
      for (const e of r.errors) lines.push(`  - ${e}`);
    }
    if (r.records.length > 0) {
      lines.push("");
      lines.push("**Records:**");
      lines.push("");
      lines.push("```json");
      lines.push(JSON.stringify(r.records, null, 2));
      lines.push("```");
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const evalDir = dirname(new URL(import.meta.url).pathname);
  const promptPath = join(evalDir, "prompts", "extraction.md");
  const fixturesDir = join(evalDir, "fixtures");
  const resultsDir = join(evalDir, "eval-results");

  if (!existsSync(promptPath)) throw new Error(`Prompt not found: ${promptPath}`);
  mkdirSync(resultsDir, { recursive: true });

  const claudePath = findClaude();
  const fixtures = [
    join(fixturesDir, "session-auth-fix.jsonl"),
    join(fixturesDir, "session-fts-feature.jsonl"),
    join(fixturesDir, "session-db-design.jsonl"),
  ];

  const results: FixtureResult[] = [];

  for (const fixturePath of fixtures) {
    const name = fixturePath.split("/").pop()!;
    process.stdout.write(`Running ${name}... `);
    const result = await extractFromFixture(claudePath, promptPath, fixturePath);
    results.push(result);

    const status = result.pass ? "PASS" : "FAIL";
    const typeStr = result.types.join(", ");
    const detail = result.pass
      ? `${result.memoryCount} memories [${typeStr}]`
      : result.errors.join("; ");
    console.log(`${status}  ${detail}`);
  }

  const report = buildReport(results);
  const reportPath = join(resultsDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
  writeFileSync(reportPath, report, "utf-8");
  console.log(`\nReport written: ${reportPath}`);

  const anyFailed = results.some((r) => !r.pass);
  process.exit(anyFailed ? 1 : 0);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
