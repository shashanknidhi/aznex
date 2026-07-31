import { test, expect } from "bun:test";
import { checkForUpdate, isNewerVersion } from "./self-update.js";

const registry = (version: string) =>
  (async () => new Response(JSON.stringify({ version }), { status: 200 })) as unknown as typeof fetch;

test("isNewerVersion compares semver parts numerically", () => {
  expect(isNewerVersion("0.1.2", "0.1.1")).toBe(true);
  expect(isNewerVersion("0.1.1", "0.1.1")).toBe(false);
  expect(isNewerVersion("0.1.1", "0.1.2")).toBe(false);
  expect(isNewerVersion("0.10.0", "0.9.9")).toBe(true);
  expect(isNewerVersion("1.0.0", "0.99.99")).toBe(true);
});

test("newer registry version → install then exit(0)", async () => {
  const events: string[] = [];
  await checkForUpdate({
    fetchImpl: registry("99.0.0"),
    install: async () => {
      events.push("install");
      return 0;
    },
    exit: (code) => events.push(`exit:${code}`),
  });
  expect(events).toEqual(["install", "exit:0"]);
});

test("same/older version or failed install → no exit", async () => {
  const events: string[] = [];
  await checkForUpdate({
    fetchImpl: registry("0.0.1"),
    install: async () => {
      events.push("install");
      return 0;
    },
    exit: () => events.push("exit"),
  });
  expect(events).toEqual([]);

  await checkForUpdate({
    fetchImpl: registry("99.0.0"),
    install: async () => 1, // install failed — keep running current version
    exit: () => events.push("exit"),
  });
  expect(events).toEqual([]);
});

test("AZNEX_AUTO_UPDATE=off disables the check; registry errors are silent", async () => {
  process.env["AZNEX_AUTO_UPDATE"] = "off";
  try {
    let fetched = false;
    await checkForUpdate({
      fetchImpl: (async () => {
        fetched = true;
        return new Response("{}");
      }) as unknown as typeof fetch,
    });
    expect(fetched).toBe(false);
  } finally {
    delete process.env["AZNEX_AUTO_UPDATE"];
  }
  // network failure never throws
  await checkForUpdate({
    fetchImpl: (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch,
    exit: () => {
      throw new Error("must not exit");
    },
  });
});

// ── the check always says what it did ────────────────────────────────────────

// Silence used to cover "up to date", "registry down" and "never ran" alike.
async function logsFrom(run: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const [log, warn] = [console.log, console.warn];
  console.log = (...a: unknown[]) => lines.push(a.join(" "));
  console.warn = (...a: unknown[]) => lines.push(a.join(" "));
  try {
    await run();
  } finally {
    console.log = log;
    console.warn = warn;
  }
  return lines.join("\n");
}

test("already current → logs the local and latest versions", async () => {
  const out = await logsFrom(() => checkForUpdate({ fetchImpl: registry("0.0.1"), exit: () => {} }));
  expect(out).toContain("is current");
  expect(out).toContain("latest 0.0.1");
});

test("registry error status → logs the status rather than going quiet", async () => {
  const out = await logsFrom(() =>
    checkForUpdate({ fetchImpl: (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch }),
  );
  expect(out).toContain("503");
});

test("unreachable registry → logs why the version didn't move", async () => {
  const out = await logsFrom(() =>
    checkForUpdate({ fetchImpl: (async () => { throw new Error("offline"); }) as unknown as typeof fetch }),
  );
  expect(out).toContain("offline");
});

test("AZNEX_AUTO_UPDATE=off says so instead of looking like a broken check", async () => {
  process.env["AZNEX_AUTO_UPDATE"] = "off";
  try {
    const out = await logsFrom(() => checkForUpdate({ fetchImpl: registry("99.0.0") }));
    expect(out).toContain("AZNEX_AUTO_UPDATE=off");
  } finally {
    delete process.env["AZNEX_AUTO_UPDATE"];
  }
});
