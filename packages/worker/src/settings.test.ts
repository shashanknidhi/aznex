import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getSettings, updateSettings, InvalidSettingError } from "./settings.js";

function tmpConfig(content?: object): string {
  const dir = mkdtempSync(join(tmpdir(), "aznex-settings-"));
  const path = join(dir, "config.json");
  if (content) writeFileSync(path, JSON.stringify(content));
  return path;
}

test("getSettings never exposes the apiKey", () => {
  const path = tmpConfig({ serviceUrl: "https://svc", apiKey: "axk_secret" });
  const out = getSettings(path) as { effective: Record<string, unknown> };
  expect(JSON.stringify(out)).not.toContain("axk_secret");
  expect(out.effective["apiKey"]).toBeUndefined();
  expect(out.effective["serviceUrl"]).toBe("https://svc");
});

test("getSettings never exposes the per-owner apiKeys either", () => {
  const path = tmpConfig({ serviceUrl: "https://svc", apiKey: "axk_a", apiKeys: { "ukumi-ai": "axk_work" } });
  const out = getSettings(path) as { effective: Record<string, unknown> };
  expect(JSON.stringify(out)).not.toContain("axk_work");
  expect(out.effective["apiKeys"]).toBeUndefined();
});

test("updateSettings roundtrips editable fields and preserves setup-owned ones", () => {
  const path = tmpConfig({ serviceUrl: "https://svc", apiKey: "axk_secret", claudePath: "/opt/claude" });
  updateSettings({ extractModel: "claude-haiku-4-5", contextMemoryCount: 5, contextEnabled: false }, path);

  const file = JSON.parse(readFileSync(path, "utf-8"));
  expect(file).toEqual({
    serviceUrl: "https://svc", apiKey: "axk_secret", claudePath: "/opt/claude",
    extractModel: "claude-haiku-4-5", contextMemoryCount: 5, contextEnabled: false,
  });
  expect(statSync(path).mode & 0o777).toBe(0o600);
});

test("updateSettings ignores non-editable fields — apiKey cannot be set from the page", () => {
  const path = tmpConfig({ apiKey: "axk_original" });
  updateSettings({ apiKey: "axk_evil", serviceUrl: "https://evil", extractModel: "claude-opus-5" }, path);
  const file = JSON.parse(readFileSync(path, "utf-8"));
  expect(file["apiKey"]).toBe("axk_original");
  expect(file["serviceUrl"]).toBeUndefined();
  expect(file["extractModel"]).toBe("claude-opus-5");
});

test("null or empty string clears a field back to default; missing file is created", () => {
  const path = tmpConfig(); // no file yet
  // extractAgent pinned so the effective-model assertion doesn't depend on
  // which agent CLIs the test machine happens to have installed.
  updateSettings({ extractAgent: "claude", extractModel: "claude-opus-5", contextMemoryCount: 5 }, path);
  updateSettings({ extractModel: null, contextMemoryCount: "" }, path);
  expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ extractAgent: "claude" });
  const out = getSettings(path) as { effective: Record<string, unknown> };
  // cleared extractModel resolves to the active engine's cheapest, not null
  expect(out.effective["extractModel"]).toBe("claude-haiku-4-5");
  expect(out.effective["contextMemoryCount"]).toBe(10);
});

test("workerPort is not editable from the page — it needs a daemon restart", () => {
  const path = tmpConfig({ workerPort: 29639 });
  updateSettings({ workerPort: 4000 }, path);
  expect(JSON.parse(readFileSync(path, "utf-8"))["workerPort"]).toBe(29639);
});

test("getSettings serves the model catalog and the resolved engine", () => {
  const out = getSettings(tmpConfig({ extractAgent: "codex" })) as {
    models: Record<string, { id: string }[]>;
    activeEngine: string;
    effective: Record<string, unknown>;
  };
  expect(out.activeEngine).toBe("codex");
  expect(out.models["codex"]?.[0]?.id).toBe("gpt-5.6-luna");
  expect(out.models["claude"]?.[0]?.id).toBe("claude-haiku-4-5");
  expect(out.effective["extractModel"]).toBe("gpt-5.6-luna");
});

test("updateSettings rejects an unknown agent and a model from the wrong engine", () => {
  const path = tmpConfig({ extractAgent: "claude" });
  expect(() => updateSettings({ extractAgent: "gemini" }, path)).toThrow(InvalidSettingError);
  // claude is the stored agent, so a codex model must not be accepted
  expect(() => updateSettings({ extractModel: "gpt-5.6-luna" }, path)).toThrow(/not a known claude model/);
  // ...but it is accepted when the same request switches the agent to codex
  updateSettings({ extractAgent: "codex", extractModel: "gpt-5.6-luna" }, path);
  expect(JSON.parse(readFileSync(path, "utf-8"))["extractModel"]).toBe("gpt-5.6-luna");
});

test("envOverridden flags fields pinned by env vars", () => {
  process.env["AZNEX_EXTRACT_MODEL"] = "pinned";
  try {
    const out = getSettings(tmpConfig({})) as { envOverridden: string[] };
    expect(out.envOverridden).toEqual(["extractModel"]);
  } finally {
    delete process.env["AZNEX_EXTRACT_MODEL"];
  }
});

// ── per-owner accounts, editable from the settings page ─────────────────────

const KEYED = { serviceUrl: "https://svc", apiKey: "axk_personal_aaaa", apiKeys: { "ukumi-ai": "axk_work_bbbb" } };

function accountsOf(path: string): { hasDefault: boolean; owners: string[] } {
  return (getSettings(path) as { accounts: ReturnType<typeof accountsOf> }).accounts;
}

test("getSettings lists the owners that have their own identity, never their keys", () => {
  const accounts = accountsOf(tmpConfig(KEYED));
  expect(accounts).toEqual({ hasDefault: true, owners: ["ukumi-ai"] });
});

test("getSettings reports no default key before setup has run", () => {
  expect(accountsOf(tmpConfig({ serviceUrl: "https://svc" })).hasDefault).toBe(false);
});

test("adding an account writes the key and lowercases the owner", () => {
  const path = tmpConfig(KEYED);
  updateSettings({ apiKeys: { "Acme-Inc": "axk_acme" } }, path);
  const file = JSON.parse(readFileSync(path, "utf-8"));
  expect(file["apiKeys"]).toEqual({ "ukumi-ai": "axk_work_bbbb", "acme-inc": "axk_acme" }); // patch, not replace
  expect(statSync(path).mode & 0o777).toBe(0o600);
});

test("removing an account drops just that owner", () => {
  const path = tmpConfig({ ...KEYED, apiKeys: { "ukumi-ai": "axk_work_bbbb", acme: "axk_acme" } });
  updateSettings({ apiKeys: { acme: null } }, path);
  const file = JSON.parse(readFileSync(path, "utf-8"));
  expect(file["apiKeys"]).toEqual({ "ukumi-ai": "axk_work_bbbb" });
  expect(file["apiKey"]).toBe("axk_personal_aaaa"); // the default is never touched
});

test("removing the last account leaves no empty apiKeys behind", () => {
  const path = tmpConfig(KEYED);
  updateSettings({ apiKeys: { "ukumi-ai": null } }, path);
  expect(JSON.parse(readFileSync(path, "utf-8"))["apiKeys"]).toBeUndefined();
});

test("the response after a save contains no key material at all", () => {
  const out = updateSettings({ apiKeys: { acme: "axk_acme_secret" } }, tmpConfig(KEYED));
  expect(JSON.stringify(out)).not.toContain("axk_");
});

test("an invalid owner name is rejected rather than saved as a rule that never matches", () => {
  const path = tmpConfig(KEYED);
  for (const owner of ["acme inc", "acme/repo", "-acme", "acme--inc", "", "a".repeat(40)]) {
    expect(() => updateSettings({ apiKeys: { [owner]: "axk_x" } }, path)).toThrow(InvalidSettingError);
  }
  expect(JSON.parse(readFileSync(path, "utf-8"))["apiKeys"]).toEqual({ "ukumi-ai": "axk_work_bbbb" });
});

test("a pasted key with whitespace is rejected instead of becoming an unexplained 401", () => {
  expect(() => updateSettings({ apiKeys: { acme: "axk_x " } }, tmpConfig(KEYED))).toThrow(InvalidSettingError);
  expect(() => updateSettings({ apiKeys: { acme: "axk_ x" } }, tmpConfig(KEYED))).toThrow(InvalidSettingError);
});

test("a non-object apiKeys payload is rejected", () => {
  expect(() => updateSettings({ apiKeys: "axk_x" }, tmpConfig(KEYED))).toThrow(InvalidSettingError);
  expect(() => updateSettings({ apiKeys: ["axk_x"] }, tmpConfig(KEYED))).toThrow(InvalidSettingError);
});

test("saving other settings leaves the accounts alone", () => {
  const path = tmpConfig(KEYED);
  updateSettings({ contextMemoryCount: 5 }, path);
  expect(JSON.parse(readFileSync(path, "utf-8"))["apiKeys"]).toEqual({ "ukumi-ai": "axk_work_bbbb" });
});
