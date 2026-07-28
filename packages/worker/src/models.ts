// Model catalog for the extraction engines. Single source of truth: the
// settings page fetches this over /api/settings rather than hardcoding a
// second copy that drifts.
//
// Ordered cheapest-first, and the first entry of each list is the default —
// extraction is a bulk classify/summarise job, so the cheapest tier is the
// right default and the expensive tiers are opt-in.
// ponytail: hardcoded list. Neither CLI can enumerate its models (`claude
// --help` documents aliases; `codex` has no list command), so a release is
// the only way to learn about new ones anyway.

export type Engine = "claude" | "codex";

export interface ModelChoice {
  id: string;
  label: string;
}

export const MODELS: Record<Engine, ModelChoice[]> = {
  // Claude Code accepts an alias or a full name; full names pin the generation.
  claude: [
    { id: "claude-haiku-4-5", label: "Haiku 4.5 — cheapest" },
    { id: "claude-sonnet-5", label: "Sonnet 5" },
    { id: "claude-opus-5", label: "Opus 5" },
    { id: "claude-fable-5", label: "Fable 5 — most capable" },
  ],
  // Codex 0.145 slugs. Luna is the nano tier Codex itself recommends for
  // "classification, extraction, high-volume" — i.e. exactly this pipeline.
  codex: [
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna — cheapest" },
    { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol — most capable" },
    { id: "gpt-5.5", label: "GPT-5.5" },
    { id: "gpt-5.4", label: "GPT-5.4" },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
    { id: "gpt-5.2", label: "GPT-5.2" },
  ],
};

/** The default model for an engine — always the cheapest one we list. */
export function cheapestModel(engine: Engine): string {
  const first = MODELS[engine][0];
  if (!first) throw new Error(`no models listed for engine ${engine}`);
  return first.id;
}

export function isKnownModel(engine: Engine, model: string): boolean {
  return MODELS[engine].some((m) => m.id === model);
}

/**
 * The model to actually pass to `engine`. A configured model that belongs to
 * the *other* engine (left behind by switching agents) is discarded rather
 * than passed through — `claude --model gpt-5.6-luna` would just fail.
 */
export function resolveModel(engine: Engine, configured: string | null): string {
  if (configured && isKnownModel(engine, configured)) return configured;
  return cheapestModel(engine);
}
