import { MemoryTypeSchema, type MemoryType } from "@aznex/shared";

/**
 * The memory types, straight from the shared Zod enum.
 *
 * The frontend used to hardcode this list and had only four of the five, so
 * `raw_observation` memories showed up with a badge but could never be filtered
 * for. Deriving it means a new type can't be silently missed.
 */
export const MEMORY_TYPES: readonly MemoryType[] = MemoryTypeSchema.options;

const TYPE_LABELS: Record<MemoryType, string> = {
  raw_observation: "Observation",
  extracted_learning: "Learning",
  summary: "Summary",
  negative_result: "Dead end",
  decision: "Decision",
};

/** Human label for a memory type. `extracted_learning` is not a word. */
export function typeLabel(type: string): string {
  return TYPE_LABELS[type as MemoryType] ?? type;
}

export function isMemoryType(value: string): value is MemoryType {
  return MemoryTypeSchema.safeParse(value).success;
}

export function formatDate(epoch: number): string {
  return new Date(epoch).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Date *and* time — "last used" is useless for debugging a worker without it. */
export function formatDateTime(epoch: number): string {
  return new Date(epoch).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "3 hours ago". Recency is what matters for memories and key usage; falls back
 * to an absolute date once relative stops being informative.
 */
export function formatRelative(epoch: number, now = Date.now()): string {
  const delta = now - epoch;
  if (delta < 0) return formatDate(epoch);
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) {
    const n = Math.floor(delta / MINUTE);
    return `${n} ${plural(n, "minute")} ago`;
  }
  if (delta < DAY) {
    const n = Math.floor(delta / HOUR);
    return `${n} ${plural(n, "hour")} ago`;
  }
  if (delta < 7 * DAY) {
    const n = Math.floor(delta / DAY);
    return `${n} ${plural(n, "day")} ago`;
  }
  return formatDate(epoch);
}

/** ISO string for a `<time datetime>` attribute. */
export function isoDate(epoch: number): string {
  return new Date(epoch).toISOString();
}

export function plural(n: number, word: string, plural = `${word}s`): string {
  return n === 1 ? word : plural;
}

/** "1 memory" / "2 memories" — the count line used to always say "memories". */
export function countLabel(n: number, word: string, pluralForm?: string): string {
  return `${n} ${plural(n, word, pluralForm)}`;
}

export function preview(content: string, max = 180): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * A GitHub link for a repo-relative path, so file anchors are clickable instead
 * of decorative. `HEAD` rather than a branch name: we don't know the default.
 */
export function githubFileUrl(fingerprint: string, path: string): string | null {
  const [host, owner, ...name] = fingerprint.split("/");
  if (host !== "github.com" || !owner || name.length === 0) return null;
  return `https://github.com/${owner}/${name.join("/")}/blob/HEAD/${path}`;
}
