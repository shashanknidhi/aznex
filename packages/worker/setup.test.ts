import { test, expect } from "bun:test";
import { resolveApiKey, detectAgents, agentLabel, type Validator } from "./setup.js";

// Re-running setup used to mint a throwaway key every time; these cover the
// reuse/mint decision without touching the network or a browser.

const okValidator: Validator = async () => "ok";
const rejectValidator: Validator = async () => "rejected";
const mintFails = async (): Promise<string> => {
  throw new Error("browserAuth should not have been called");
};
const mints = (key: string) => async () => key;

const NONE = { apiKey: null, serviceUrl: null };

test("a valid stored key for the same service is reused — no new key minted", async () => {
  const result = await resolveApiKey(
    { newKey: false, serviceUrl: "https://svc", stored: { apiKey: "axk_stored", serviceUrl: "https://svc" } },
    { validate: okValidator, mint: mintFails },
  );
  expect(result).toEqual({ apiKey: "axk_stored", source: "stored" });
});

test("a stored key trailing-slashed in config still matches the same service", async () => {
  const result = await resolveApiKey(
    { newKey: false, serviceUrl: "https://svc", stored: { apiKey: "axk_stored", serviceUrl: "https://svc/" } },
    { validate: okValidator, mint: mintFails },
  );
  expect(result.source).toBe("stored");
});

test("a rejected stored key falls through to a fresh mint", async () => {
  let calls = 0;
  const validate: Validator = async (_url, key) => (key === "axk_stored" ? "rejected" : "ok");
  const result = await resolveApiKey(
    { newKey: false, serviceUrl: "https://svc", stored: { apiKey: "axk_stored", serviceUrl: "https://svc" } },
    { validate, mint: async () => { calls++; return "axk_new"; } },
  );
  expect(result).toEqual({ apiKey: "axk_new", source: "minted" });
  expect(calls).toBe(1);
});

test("an unreachable service fails loudly instead of minting a key", async () => {
  const unreachable: Validator = async () => {
    throw new Error("service unreachable: https://svc/health");
  };
  await expect(
    resolveApiKey(
      { newKey: false, serviceUrl: "https://svc", stored: { apiKey: "axk_stored", serviceUrl: "https://svc" } },
      { validate: unreachable, mint: mintFails },
    ),
  ).rejects.toThrow("service unreachable");
});

test("--new-key mints even when the stored key is valid", async () => {
  const result = await resolveApiKey(
    { newKey: true, serviceUrl: "https://svc", stored: { apiKey: "axk_stored", serviceUrl: "https://svc" } },
    { validate: okValidator, mint: mints("axk_new") },
  );
  expect(result).toEqual({ apiKey: "axk_new", source: "minted" });
});

test("a key stored for a different service URL is never reused", async () => {
  const result = await resolveApiKey(
    { newKey: false, serviceUrl: "https://new-svc", stored: { apiKey: "axk_stored", serviceUrl: "https://old-svc" } },
    { validate: okValidator, mint: mints("axk_new") },
  );
  expect(result.source).toBe("minted");
});

test("--api-key wins over a stored key, and a rejected one is a hard error", async () => {
  const result = await resolveApiKey(
    { flagKey: "axk_flag", newKey: false, serviceUrl: "https://svc", stored: { apiKey: "axk_stored", serviceUrl: "https://svc" } },
    { validate: okValidator, mint: mintFails },
  );
  expect(result).toEqual({ apiKey: "axk_flag", source: "flag" });

  await expect(
    resolveApiKey(
      { flagKey: "axk_bad", newKey: false, serviceUrl: "https://svc", stored: NONE },
      { validate: rejectValidator, mint: mintFails },
    ),
  ).rejects.toThrow("check the key you passed");
});

test("detectAgents wires only the agents actually installed", () => {
  expect(detectAgents(() => true)).toEqual(["claude-code", "codex"]);
  expect(detectAgents((b) => b === "codex")).toEqual(["codex"]);
  expect(detectAgents(() => false)).toEqual([]);
});

test("agentLabel reads as prose in the post-setup message", () => {
  expect(agentLabel(["claude-code"])).toBe("Claude Code");
  expect(agentLabel(["claude-code", "codex"])).toBe("Claude Code or Codex");
});
