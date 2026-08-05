// Service config — all values from env, no hardcoded secrets or endpoints.
export interface Config {
  port: number;
  githubAppId: string | null;
  githubAppPrivateKey: string | null;
  repoAccessTtlMs: number;
  landingHosts: string[];
}

// Hosts that get the marketing landing page instead of the app SPA, from
// AZNEX_LANDING_HOST (comma-separated). Empty by default, which means no host
// is special and every request behaves exactly as it did before this existed.
export function parseLandingHosts(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/:\d+$/, ""))
    .filter(Boolean);
}

export function loadConfig(): Config {
  return {
    landingHosts: parseLandingHosts(process.env["AZNEX_LANDING_HOST"]),
    port: Number(process.env["PORT"] ?? 3000),
    githubAppId: process.env["GITHUB_APP_ID"] ?? null,
    // PEM private key; newlines may be escaped in env, so un-escape them.
    githubAppPrivateKey: process.env["GITHUB_APP_PRIVATE_KEY"]?.replace(/\\n/g, "\n") ?? null,
    repoAccessTtlMs: Number(process.env["REPO_ACCESS_TTL_MS"] ?? 5 * 60 * 1000),
  };
}
