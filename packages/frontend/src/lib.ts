import type { MemoryItem } from "./api.js";

// Client-side facet filters over the current page of results.
// ponytail: server-side type filter when pages get big enough to matter.
export interface MemoryFilters {
  type: string | null;
}

export function filterMemories(items: MemoryItem[], filters: MemoryFilters): MemoryItem[] {
  return items.filter((m) => !filters.type || m.type === filters.type);
}

export function formatDate(epoch: number): string {
  return new Date(epoch).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function preview(content: string, max = 180): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
