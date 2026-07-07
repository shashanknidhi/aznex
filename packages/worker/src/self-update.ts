import pkg from "../package.json" with { type: "json" };

// Daemon self-update: check npm for a newer @aznex/worker; if found, install
// it globally and exit — launchd/systemd's crash recovery restarts us on the
// new version, so the existing restart machinery doubles as the applicator.
// Opt out with AZNEX_AUTO_UPDATE=off. Runs on daemon start and daily.

const REGISTRY_URL = "https://registry.npmjs.org/@aznex/worker/latest";
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (v: string) => v.split(".").map((n) => Number(n) || 0);
  const [a, b] = [parse(candidate), parse(current)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

export interface SelfUpdateDeps {
  fetchImpl?: typeof fetch;
  install?: () => Promise<number>; // exit code
  exit?: (code: number) => void;
}

async function defaultInstall(): Promise<number> {
  const proc = Bun.spawn([process.execPath, "install", "-g", "@aznex/worker@latest"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  return await proc.exited;
}

export async function checkForUpdate(deps: SelfUpdateDeps = {}): Promise<void> {
  if (process.env["AZNEX_AUTO_UPDATE"] === "off") return;
  const doFetch = deps.fetchImpl ?? fetch;
  try {
    const res = await doFetch(REGISTRY_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return;
    const { version } = (await res.json()) as { version: string };
    if (!isNewerVersion(version, pkg.version)) return;

    console.log(`self-update: ${pkg.version} → ${version} — installing and restarting`);
    const code = await (deps.install ?? defaultInstall)();
    if (code !== 0) {
      console.warn(`self-update: install exited ${code} — staying on ${pkg.version}`);
      return;
    }
    // Exit cleanly; the daemon manager restarts us on the new version.
    (deps.exit ?? process.exit)(0);
  } catch {
    // Registry unreachable — try again next interval. Never block capture.
  }
}
