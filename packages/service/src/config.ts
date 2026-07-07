// Service config — all values from env, no hardcoded secrets or endpoints.
export interface Config {
  port: number;
  defaultPromotion: "team_shared" | "private";
  githubAppId: string | null;
  githubAppPrivateKey: string | null;
  repoAccessTtlMs: number;
}

export function loadConfig(): Config {
  return {
    port: Number(process.env["PORT"] ?? 3000),
    // Pilot decision: captured memories are team-visible immediately.
    // Set AZNEX_DEFAULT_PROMOTION=private for review-before-share workflows.
    defaultPromotion: process.env["AZNEX_DEFAULT_PROMOTION"] === "private" ? "private" : "team_shared",
    githubAppId: process.env["GITHUB_APP_ID"] ?? null,
    // PEM private key; newlines may be escaped in env, so un-escape them.
    githubAppPrivateKey: process.env["GITHUB_APP_PRIVATE_KEY"]?.replace(/\\n/g, "\n") ?? null,
    repoAccessTtlMs: Number(process.env["REPO_ACCESS_TTL_MS"] ?? 5 * 60 * 1000),
  };
}
