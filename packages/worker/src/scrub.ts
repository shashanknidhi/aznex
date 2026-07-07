import { scanSecrets } from "@aznex/shared";

// Client-side scrub stage (#20). <private>…</private> blocks are stripped
// entirely; detected secrets are replaced with [REDACTED]. Returns null when
// the text still scans dirty after redaction — that memory must not be sent.

const MAX_PASSES = 5;

export function scrubContent(content: string): string | null {
  // First pass strips <private> blocks; subsequent scans run on the stripped
  // text so violation offsets line up with what we're editing.
  let text = scanSecrets(content).scrubbed;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const scan = scanSecrets(text);
    if (scan.clean) return text.trim() === "" ? null : text;
    // Replace right-to-left so earlier offsets stay valid.
    for (const v of [...scan.violations].reverse()) {
      text = text.slice(0, v.offset) + "[REDACTED]" + text.slice(v.offset + v.length);
    }
  }
  return scanSecrets(text).clean && text.trim() !== "" ? text : null;
}
