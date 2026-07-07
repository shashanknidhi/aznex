import { randomBytes } from "crypto";
import type { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { sessionOrApiKeyAuth, type Auth } from "../auth/session.js";
import { mintApiKey } from "../auth/mint-key.js";

// CLI browser auth (localhost-callback flow). `aznex-worker setup` opens the
// web app; the logged-in user clicks Approve, which mints a ONE-TIME code the
// browser hands to the CLI's localhost server; the CLI exchanges it here for
// a fresh API key. The plaintext key never passes through the browser.
//
// ponytail: in-memory code store — single service instance (same constraint
// as the SQLite volume). Move to a table if the service ever scales out.

const CODE_TTL_MS = 5 * 60 * 1000;
const pending = new Map<string, { userId: string; expiresAt: number }>();

export function clearCliAuthCodes(): void {
  pending.clear();
}

export function registerCliAuthRoutes(app: Hono<AppEnv>, auth: Auth | null): void {
  // Browser (session cookie) → one-time code bound to the logged-in user.
  app.post("/cli-auth/approve", sessionOrApiKeyAuth(auth), (c) => {
    const code = randomBytes(16).toString("hex");
    pending.set(code, { userId: c.get("user").id, expiresAt: Date.now() + CODE_TTL_MS });
    return c.json({ code });
  });

  // CLI → exchanges the code (single-use, short-lived) for a fresh API key.
  // Unauthenticated by design: the code is the credential.
  app.post("/cli-auth/exchange", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { code?: string; name?: string } | null;
    const entry = body?.code ? pending.get(body.code) : undefined;
    if (body?.code) pending.delete(body.code); // single-use, even on failure paths
    if (!entry || entry.expiresAt < Date.now()) {
      return c.json({ error: "invalid_or_expired_code" }, 400);
    }
    const apiKey = mintApiKey(c.get("db"), entry.userId, body?.name ?? "cli");
    return c.json({ apiKey });
  });
}
