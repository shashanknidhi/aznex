import {
  IngestRequestSchema,
  IngestResponseSchema,
  type IngestRequest,
  type IngestResponse,
} from "@aznex/shared";

// Ingest POST client (#21). Exponential backoff on transient failures
// (network errors, 5xx). 4xx means the payload or credentials are wrong —
// retrying can't help, so we throw immediately. Safe to retry by design:
// session/memory ids are stable idempotency keys.

export interface IngestClientOptions {
  serviceUrl: string;
  apiKey: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
}

export async function postIngest(request: IngestRequest, opts: IngestClientOptions): Promise<IngestResponse> {
  const body = JSON.stringify(IngestRequestSchema.parse(request));
  const maxAttempts = opts.maxAttempts ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const doFetch = opts.fetchImpl ?? fetch;

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** (attempt - 1)));
    try {
      const res = await doFetch(`${opts.serviceUrl}/v1/ingest`, {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
        body,
      });
      if (res.status >= 500) {
        lastError = new Error(`service returned ${res.status}`);
        continue; // transient — retry
      }
      if (!res.ok) throw new Error(`ingest rejected: ${res.status} ${await res.text().catch(() => "")}`);
      const response = IngestResponseSchema.parse(await res.json());
      for (const r of response.rejected) {
        console.warn(`ingest rejected memory ${r.id}: ${r.reason}`);
      }
      return response;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("ingest rejected")) throw err;
      lastError = err; // network error — retry
    }
  }
  throw new Error(`ingest failed after ${maxAttempts} attempts: ${String(lastError)}`);
}
