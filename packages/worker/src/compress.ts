// Compression stage (#18). Filters high-noise tool events and compresses the
// survivors into raw_observation records ready for extraction.

// Tools whose output is pure noise for memory purposes. Configurable constant.
export const SKIP_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "LS",
  "TodoWrite",
  "NotebookRead",
  "WebSearch",
]);

// Trivial shell commands carry no durable signal either.
const TRIVIAL_BASH = /^\s*(?:ls|cat|head|tail|pwd|cd|echo|which|wc|find)\b/;

const MAX_OUTPUT_CHARS = 2000;

export interface ToolEvent {
  tool_name: string;
  tool_input?: unknown;
  tool_response?: unknown;
}

export interface RawObservation {
  type: "raw_observation";
  title: string;
  content: string;
  files_read: string[];
  files_modified: string[];
}

function asString(v: unknown): string {
  if (typeof v === "string") return v;
  return JSON.stringify(v) ?? "";
}

function truncate(s: string, max = MAX_OUTPUT_CHARS): string {
  return s.length > max ? `${s.slice(0, max)}…[truncated ${s.length - max} chars]` : s;
}

/** Returns null for noise; a raw_observation record for signal. */
export function compressToolEvent(evt: ToolEvent): RawObservation | null {
  if (SKIP_TOOLS.has(evt.tool_name)) return null;

  const input = evt.tool_input as Record<string, unknown> | undefined;
  if (evt.tool_name === "Bash" && TRIVIAL_BASH.test(asString(input?.["command"]))) return null;

  const filePath = typeof input?.["file_path"] === "string" ? (input["file_path"] as string) : null;
  const modifies = ["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(evt.tool_name);

  return {
    type: "raw_observation",
    title: `${evt.tool_name}${filePath ? `: ${filePath}` : ""}`,
    content:
      `Tool: ${evt.tool_name}\n` +
      `Input: ${truncate(asString(evt.tool_input ?? {}))}\n` +
      `Output: ${truncate(asString(evt.tool_response ?? ""))}`,
    files_read: [],
    files_modified: modifies && filePath ? [filePath] : [],
  };
}
