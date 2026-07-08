import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getSettings, updateSettings } from "./settings.js";

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
  updateSettings({ apiKey: "axk_evil", serviceUrl: "https://evil", extractModel: "m" }, path);
  const file = JSON.parse(readFileSync(path, "utf-8"));
  expect(file["apiKey"]).toBe("axk_original");
  expect(file["serviceUrl"]).toBeUndefined();
  expect(file["extractModel"]).toBe("m");
});

test("null or empty string clears a field back to default; missing file is created", () => {
  const path = tmpConfig(); // no file yet
  updateSettings({ extractModel: "m", workerPort: 4000 }, path);
  updateSettings({ extractModel: null, workerPort: "" }, path);
  expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({});
  const out = getSettings(path) as { effective: Record<string, unknown> };
  expect(out.effective["extractModel"]).toBe(null);
  expect(out.effective["workerPort"]).toBe(29639);
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
