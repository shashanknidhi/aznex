import { randomBytes } from "crypto";
import { hostname } from "os";

// Browser login for `aznex-worker setup` (localhost-callback flow, like
// Claude Code's login). We start a throwaway localhost server, send the user
// to the Aznex web app to approve, receive a one-time code on /callback, and
// exchange it for a fresh API key. The key never travels through the browser.

export interface BrowserAuthOpts {
  openBrowser?: (url: string) => void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function defaultOpen(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  try {
    Bun.spawn([cmd, url], { stdout: "ignore", stderr: "ignore" });
  } catch {
    // No opener available (headless) — the URL is printed either way.
  }
}

export async function browserAuth(serviceUrl: string, opts: BrowserAuthOpts = {}): Promise<string> {
  const state = randomBytes(16).toString("hex");
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const doFetch = opts.fetchImpl ?? fetch;

  let resolveCode!: (code: string) => void;
  let rejectCode!: (err: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = Bun.serve({
    hostname: "127.0.0.1", // one-time code must only be receivable locally
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/callback") return new Response("not found", { status: 404 });
      const code = url.searchParams.get("code");
      if (url.searchParams.get("state") !== state || !code) {
        rejectCode(new Error("state mismatch on callback — try setup again"));
        return new Response("state mismatch", { status: 400 });
      }
      resolveCode(code);
      return new Response(
        "<html><body style='font-family:system-ui'>✓ Authorized — return to your terminal.</body></html>",
        { headers: { "Content-Type": "text/html" } },
      );
    },
  });

  const timer = setTimeout(
    () => rejectCode(new Error(`browser authorization timed out after ${timeoutMs / 1000}s`)),
    timeoutMs,
  );

  try {
    const authUrl = `${serviceUrl}/cli-auth?port=${server.port}&state=${state}`;
    console.log(`→ opening browser to authorize this device\n  ${authUrl}`);
    (opts.openBrowser ?? defaultOpen)(authUrl);

    const code = await codePromise;
    const res = await doFetch(`${serviceUrl}/api/cli-auth/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `cli-${hostname()}` }),
    });
    if (!res.ok) throw new Error(`code exchange failed: ${res.status}`);
    const { apiKey } = (await res.json()) as { apiKey: string };
    return apiKey;
  } finally {
    clearTimeout(timer);
    server.stop();
  }
}
