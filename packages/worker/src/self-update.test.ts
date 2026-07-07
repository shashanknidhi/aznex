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
