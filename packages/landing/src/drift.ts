// Real memory titles, not filler — this is what the store fills up with.
export const DRIFT: ReadonlyArray<readonly [type: string, title: string]> = [
  ["decision", "Authorize on collaborator membership, never permission level"],
  ["negative_result", "Retrying the 413 does not help — the payload cap is the cause"],
  ["extracted_learning", "Hooks must return before extraction, or the IDE stalls"],
  ["decision", "One SQLite file, isolation enforced by the authorizer"],
  ["summary", "Ingest stores every extracted field; anchors derive server-side"],
  ["negative_result", "Per-org database files cost more than they buy"],
  ["extracted_learning", "Cross-tenant requests 404, or the tenant list leaks"],
  ["decision", "Deletion is the only withdrawal — no staleness state"],
];
