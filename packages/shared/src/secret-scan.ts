// Secret scanning — shared by the worker (client-side pre-transmission scrub) and
// the service (authoritative server-side re-scan at ingestion). Both import this so
// the detection logic never drifts between the two passes.
//
// ponytail: hand-rolled pattern list + one entropy heuristic is the known ceiling.
// If real credentials slip through in production, swap the pattern set for a
// maintained ruleset (gitleaks/trufflehog rules) — the scanSecrets signature stays.

export interface SecretViolation {
  offset: number; // index into the ORIGINAL text where the match starts
  type: string;
}

export interface SecretScanResult {
  clean: boolean;
  violations: SecretViolation[];
  scrubbed: string; // text with <private>…</private> blocks removed
}

// Ordered, named patterns. `g` flag so we can walk every match with matchAll.
const PATTERNS: { type: string; re: RegExp }[] = [
  { type: "github_token", re: /\bgh[posru]_[A-Za-z0-9]{36,}\b/g },
  { type: "aws_access_key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { type: "slack_token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { type: "private_key_header", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { type: "bearer_token", re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g },
  // key=value / "key": "value" style credentials
  { type: "api_key_assignment", re: /\b(?:api[_-]?key|secret|token|password|passwd)\b["']?\s*[:=]\s*["']?[A-Za-z0-9._\-]{12,}/gi },
];

const PRIVATE_BLOCK = /<private>[\s\S]*?<\/private>/g;

// Shannon entropy in bits per character.
function shannonEntropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

// Long, high-entropy tokens (hex/base64 blobs) that aren't caught by a named pattern.
// >= 3.5 bits/char over a 32+ char token flags typical keys (hex maxes at 4.0,
// base64 higher) while sparing prose/paths. Errs toward over-rejection on purpose —
// this is a secret gate, a false positive costs one rejected memory, a miss leaks.
const ENTROPY_TOKEN = /[A-Za-z0-9+/=_-]{32,}/g;
const ENTROPY_THRESHOLD = 3.5;

export function scanSecrets(text: string): SecretScanResult {
  // 1. Strip <private> blocks first — their contents leave entirely, so they are
  //    neither scanned nor emitted. Offsets below are relative to the ORIGINAL text.
  const scrubbed = text.replace(PRIVATE_BLOCK, "");

  const violations: SecretViolation[] = [];
  const seen = new Set<number>(); // dedupe overlapping matches by offset

  const push = (offset: number, type: string) => {
    if (seen.has(offset)) return;
    seen.add(offset);
    violations.push({ offset, type });
  };

  for (const { type, re } of PATTERNS) {
    for (const m of text.matchAll(re)) push(m.index ?? 0, type);
  }

  for (const m of text.matchAll(ENTROPY_TOKEN)) {
    const token = m[0];
    if (shannonEntropy(token) >= ENTROPY_THRESHOLD) push(m.index ?? 0, "high_entropy");
  }

  violations.sort((a, b) => a.offset - b.offset);
  return { clean: violations.length === 0, violations, scrubbed };
}
