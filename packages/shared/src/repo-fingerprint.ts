/**
 * Repo fingerprinting (#5).
 *
 * A fingerprint is the canonical git-host identity of a repository:
 * "host/owner/name" — lowercase host and owner, no protocol, no trailing
 * ".git". It is the key every memory is scoped by, and must be resolvable
 * by the service for permission checks (never a local path).
 */

/**
 * Normalize a git remote URL to "host/owner/name", or null if the URL
 * doesn't look like a host-owner-name remote.
 *
 * Handles:
 *   git@github.com:Owner/Name.git
 *   ssh://git@github.com/Owner/Name.git
 *   https://github.com/Owner/Name.git
 *   https://user:token@github.com/Owner/Name
 *   git://github.com/Owner/Name.git
 */
export function normalizeRemoteUrl(url: string): string | null {
  let rest = url.trim();
  if (rest === "") return null;

  // scp-like syntax: [user@]host:owner/name
  const scp = rest.match(/^(?:[^@/\s]+@)([^:/\s]+):(.+)$/);
  if (scp) {
    rest = `${scp[1]}/${scp[2]}`;
  } else {
    // URL syntax: scheme://[user[:pass]@]host[:port]/path
    const m = rest.match(/^[a-z+]+:\/\/(?:[^@/\s]+@)?([^:/\s]+)(?::\d+)?\/(.+)$/i);
    if (!m) return null;
    rest = `${m[1]}/${m[2]}`;
  }

  const parts = rest.replace(/\.git$/i, "").replace(/\/+$/, "").split("/");
  if (parts.length < 3) return null;
  const host = parts[0]!.toLowerCase();
  const name = parts[parts.length - 1]!;
  const owner = parts
    .slice(1, -1)
    .join("/")
    .toLowerCase(); // GitHub owners are case-insensitive
  if (!host || !owner || !name) return null;
  return `${host}/${owner}/${name}`;
}

/**
 * Compute the repo fingerprint for a working directory by reading its
 * `origin` remote. Returns null when there is no git repo, no origin
 * remote, or the remote URL can't be normalized.
 */
export async function computeRepoFingerprint(cwd: string): Promise<string | null> {
  const proc = Bun.spawn(["git", "remote", "get-url", "origin"], {
    cwd,
    stdout: "pipe",
    stderr: "ignore",
  });
  const [exitCode, out] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
  if (exitCode !== 0) return null;
  return normalizeRemoteUrl(out);
}
