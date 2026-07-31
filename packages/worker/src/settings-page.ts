// The worker's settings page — one static HTML string, vanilla JS, no build.
// ponytail: inline template; reach for a real frontend only if this grows
// past a handful of fields.

export const SETTINGS_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>aznex worker settings</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; max-width: 560px; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.3rem; }
  label { display: block; margin-top: 1rem; font-weight: 600; }
  input[type=text], input[type=number], select { width: 100%; padding: .4rem; box-sizing: border-box; }
  .hint { font-size: .85rem; opacity: .7; margin: .15rem 0 0; }
  .env { color: #b45309; }
  input[type=password] { width: 100%; padding: .4rem; box-sizing: border-box; }
  button { margin-top: 1.5rem; padding: .5rem 1.5rem; }
  #status, #accountStatus { margin-left: 1rem; }
  details { margin-top: 2.5rem; border-top: 1px solid currentColor; padding-top: 1rem; }
  summary { cursor: pointer; font-weight: 600; }
  #accounts { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  #accounts td { padding: .3rem 0; }
  #accounts td:last-child { text-align: right; }
  #accounts button { margin: 0; padding: .2rem .6rem; }
  code { font-size: .9em; }
</style>
</head>
<body>
<h1>aznex worker settings</h1>
<p class="hint">Service: <span id="serviceUrl">…</span> — stored in ~/.aznex/config.json; env vars win over saved values.</p>
<form id="form">
  <label>Coding agent
    <select name="extractAgent">
      <option value="auto">Auto — Claude Code, else Codex</option>
      <option value="claude">Claude Code</option>
      <option value="codex">Codex</option>
    </select>
  </label>
  <p class="hint">Which local CLI runs extraction, on your own subscription. Picking one explicitly fails loudly if it isn't installed.</p>

  <label>Extraction model
    <select name="extractModel"></select>
  </label>
  <p class="hint">Passed as <code>--model</code> to that CLI. Defaults to the cheapest model — extraction is a bulk summarise job, so the cheap tier is the right one.</p>

  <label><input type="checkbox" name="contextEnabled"> Inject team memory at session start</label>
  <label>Memories to inject
    <input type="number" name="contextMemoryCount" min="1" max="50">
  </label>

  <label><input type="checkbox" name="fileContextEnabled"> Inject file-anchored memories on Read</label>
  <p class="hint">Claude Code only — Codex reads files through the shell, so there's no file path to key off.</p>

  <button type="submit">Save</button><span id="status"></span>
</form>

<details id="advanced">
<summary>Advanced — more than one GitHub account</summary>
<p class="hint">Aznex checks access as you, per repo, so a work key on a personal repo is denied and vice versa. Give a GitHub owner its own key and every repo under it — reads and writes both — uses that identity. Everything else uses the default. Nothing to switch: the identity follows the repo.</p>
<table id="accounts"><tbody></tbody></table>
<label>GitHub owner
  <input type="text" id="newOwner" placeholder="acme-inc" autocomplete="off">
</label>
<p class="hint">The <code>owner</code> in <code>github.com/owner/repo</code> — an organization or a personal account.</p>
<label>API key for that account
  <input type="password" id="newKey" placeholder="axk_…" autocomplete="off">
</label>
<p class="hint">Mint one with <code>aznex-worker setup --new-key</code> while signed into that GitHub account in your browser, then put your original key back as the default. That account must already be a member of the Aznex org that owns the repos.</p>
<button type="button" id="addAccount">Add account</button><span id="accountStatus"></span>
</details>

<script>
const form = document.getElementById("form");
const fields = ["extractAgent", "extractModel", "contextEnabled", "contextMemoryCount", "fileContextEnabled"];
let catalog = { claude: [], codex: [] };
let activeEngine = "claude";

// The model list belongs to whichever engine will actually run — under "auto"
// that's the one the server resolved. Keeps a claude model from being saved
// against codex, which would fail at spawn time rather than here.
function fillModels(selected) {
  const agent = form.elements["extractAgent"].value;
  const models = catalog[agent === "auto" ? activeEngine : agent] ?? [];
  form.elements["extractModel"].innerHTML = models
    .map((m) => \`<option value="\${m.id}">\${m.label}</option>\`)
    .join("");
  // Keep the current pick across an agent switch when that engine has it too,
  // else fall back to the first (cheapest) entry.
  if (models.some((m) => m.id === selected)) form.elements["extractModel"].value = selected;
}

// Owner names come straight from the config file, which is hand-editable, so
// they're written as text nodes rather than innerHTML.
function accountRow(owner, state, onRemove) {
  const tr = document.createElement("tr");
  const name = document.createElement("td");
  name.textContent = owner;
  const key = document.createElement("td");
  key.textContent = state;
  const action = document.createElement("td");
  if (onRemove) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Remove";
    button.addEventListener("click", onRemove);
    action.append(button);
  }
  tr.append(name, key, action);
  return tr;
}

function renderAccounts(accounts) {
  const body = document.querySelector("#accounts tbody");
  body.textContent = "";
  body.append(accountRow("every other repo", accounts.hasDefault ? "default key" : "not configured", null));
  for (const owner of accounts.owners) {
    body.append(accountRow(owner, "own key", () => saveAccounts({ [owner]: null }, \`removed \${owner}\`)));
  }
  // Only worth unfolding on its own if you already use it.
  if (accounts.owners.length > 0) document.getElementById("advanced").open = true;
}

async function saveAccounts(patch, okMessage) {
  const status = document.getElementById("accountStatus");
  const res = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKeys: patch }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    status.textContent = data.detail ?? "save failed";
    return false;
  }
  status.textContent = okMessage;
  renderAccounts(data.accounts);
  return true;
}

function render(data) {
  document.getElementById("serviceUrl").textContent = data.effective.serviceUrl ?? "not configured — run: npx aznex-worker setup";
  renderAccounts(data.accounts);
  catalog = data.models;
  activeEngine = data.activeEngine;
  form.elements["extractAgent"].value = data.effective.extractAgent;
  fillModels(data.effective.extractModel);
  for (const name of fields) {
    const el = form.elements[name];
    const value = data.effective[name];
    if (el.type === "checkbox") el.checked = !!value;
    else el.value = value ?? "";
    if (data.envOverridden.includes(name)) {
      el.disabled = true;
      el.closest("label").insertAdjacentHTML("beforeend", ' <span class="hint env">(pinned by env var)</span>');
    }
  }
}

fetch("/api/settings").then(r => r.json()).then(render);

document.getElementById("addAccount").addEventListener("click", async () => {
  const owner = document.getElementById("newOwner");
  const key = document.getElementById("newKey");
  if (owner.value.trim() === "" || key.value === "") {
    document.getElementById("accountStatus").textContent = "owner and key are both required";
    return;
  }
  if (await saveAccounts({ [owner.value.trim()]: key.value }, \`saved \${owner.value.trim()} ✓\`)) {
    owner.value = "";
    key.value = ""; // don't leave a usable credential sitting in the form
  }
});

form.elements["extractAgent"].addEventListener("change", () => {
  fillModels(form.elements["extractModel"].value);
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {};
  for (const name of fields) {
    const el = form.elements[name];
    if (el.disabled) continue;
    if (el.type === "checkbox") body[name] = el.checked;
    else if (el.type === "number") body[name] = el.value === "" ? null : Number(el.value);
    else body[name] = el.value || null;
  }
  const res = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    document.getElementById("status").textContent = "saved ✓";
  } else {
    const err = await res.json().catch(() => ({}));
    document.getElementById("status").textContent = err.detail ?? "save failed";
  }
});
</script>
</body>
</html>
`;
