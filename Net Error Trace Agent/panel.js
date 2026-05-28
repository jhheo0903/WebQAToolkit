const STORAGE_KEY = "capturedErrors";
const PROVIDER_CONFIGS_KEY = "providerConfigs";
const SELECTED_PROVIDER_KEY = "selectedProvider";
const GITHUB_AUTH_KEY = "githubCopilotAuth";

const listElement = document.getElementById("list");
const refreshButton = document.getElementById("refreshButton");
const clearButton = document.getElementById("clearButton");
const filterInfo = document.getElementById("filterInfo");
const promptInput = document.getElementById("promptInput");
const promptSendButton = document.getElementById("promptSendButton");
const settingsButton = document.getElementById("settingsButton");
const settingsOverlay = document.getElementById("settingsOverlay");
const mcpButton = document.getElementById("mcpButton");
const mcpOverlay = document.getElementById("mcpOverlay");
const mcpRefreshButton = document.getElementById("mcpRefreshButton");
const mcpServerList = document.getElementById("mcpServerList");
const providerTabs = document.getElementById("providerTabs");
const providerFields = document.getElementById("providerFields");
const saveSettingsButton = document.getElementById("saveSettingsButton");
const saveStatus = document.getElementById("saveStatus");
const aiInfo = document.getElementById("aiInfo");

let filterQuery = "";
const expandedIds = new Set();
const activeBodyTab = {};
let lastRenderSignature = "";
let currentProvider = "openai";
let providerConfigs = {};
let aiRunning = false;
let copilotDeviceFlowState = null;
let mcpRefreshing = false;

// ─── Utilities ───────────────────────────────────────────────────────────────

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
}

function classifyStatus(status) {
  const s = Number(status);
  if (s >= 500) return "error";
  if (s >= 400) return "warning";
  return "info";
}

function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function truncateText(value, maxLength) {
  const text = String(value || "");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseResultToArray(value) {
  return Array.isArray(value) ? value.filter(Boolean).map((item) => String(item)) : [];
}

// ─── Theme ───────────────────────────────────────────────────────────────────

function initializeTheme() {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  document.documentElement.setAttribute("data-theme", mq.matches ? "dark" : "light");
  mq.addEventListener("change", (e) => {
    document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
  });
}

// ─── Status helpers ───────────────────────────────────────────────────────────

function getProviderLabel(providerKey) {
  return globalThis.AIProviders?.PROVIDERS?.[providerKey]?.label || providerKey;
}

function setSaveStatus(message, type) {
  if (!saveStatus) return;
  saveStatus.textContent = message || "";
  saveStatus.className = type ? `saveStatus ${type}` : "saveStatus";
}

function setAiInfo(message) {
  if (!aiInfo) return;
  const text = String(message || "").trim();
  if (!text) { aiInfo.textContent = ""; aiInfo.classList.remove("show"); return; }
  aiInfo.textContent = text;
  aiInfo.classList.add("show");
}

// ─── Overlays ────────────────────────────────────────────────────────────────

function toggleSettingsPanel(forceOpen) {
  if (!settingsOverlay || !settingsButton) return;
  const shouldOpen = typeof forceOpen === "boolean"
    ? forceOpen
    : !settingsOverlay.classList.contains("open");
  settingsOverlay.classList.toggle("open", shouldOpen);
  settingsButton.classList.toggle("active", shouldOpen);
  if (shouldOpen) toggleMcpPanel(false);
}

function toggleMcpPanel(forceOpen) {
  if (!mcpOverlay || !mcpButton) return;
  const shouldOpen = typeof forceOpen === "boolean"
    ? forceOpen
    : !mcpOverlay.classList.contains("open");
  mcpOverlay.classList.toggle("open", shouldOpen);
  mcpButton.classList.toggle("active", shouldOpen);
  if (shouldOpen) toggleSettingsPanel(false);
}

// ─── MCP Panel ───────────────────────────────────────────────────────────────

function renderMcpPanel() {
  if (!mcpServerList) return;
  const cache = globalThis.MCPClient?._cache || {};
  const entries = Object.values(cache);

  if (entries.length === 0) {
    mcpServerList.innerHTML = '<div class="mcpEmpty">MCP 서버가 없습니다.<br>mcp-servers.json을 편집하고 Refresh를 눌러주세요.</div>';
    return;
  }

  mcpServerList.innerHTML = entries.map(({ server, tools, error }) => {
    const dotClass = error ? "err" : "ok";
    let toolsHtml;
    if (error) {
      toolsHtml = `<div class="mcpErrorText">${escapeHtml(error)}</div>`;
    } else if (tools.length === 0) {
      toolsHtml = '<div class="mcpToolItem"><span class="mcpToolName">연결됨 (도구 없음)</span></div>';
    } else {
      toolsHtml = tools.map((tool) => {
        const desc = tool.description ? ` — ${escapeHtml(String(tool.description).slice(0, 80))}` : "";
        return `<div class="mcpToolItem"><span class="mcpToolName">${escapeHtml(tool.name)}</span>${desc}</div>`;
      }).join("");
    }
    return `
      <div class="mcpServerItem">
        <div class="mcpServerHeader">
          <span class="mcpStatusDot ${dotClass}"></span>
          <span class="mcpServerName">${escapeHtml(server.name)}</span>
          <span class="mcpToolCount">${tools.length} tools</span>
        </div>
        <div class="mcpToolList">${toolsHtml}</div>
      </div>`;
  }).join("");
}

async function refreshMcpTools() {
  if (!globalThis.MCPClient || mcpRefreshing) return;
  mcpRefreshing = true;
  if (mcpRefreshButton) mcpRefreshButton.textContent = "Refreshing...";
  try {
    await globalThis.MCPClient.refreshAll();
    renderMcpPanel();
  } finally {
    mcpRefreshing = false;
    if (mcpRefreshButton) mcpRefreshButton.textContent = "Refresh";
  }
}

// ─── GitHub Copilot auth ──────────────────────────────────────────────────────

async function getGitHubAuth() {
  const result = await chrome.storage.local.get(GITHUB_AUTH_KEY);
  return result[GITHUB_AUTH_KEY] || null;
}

async function setGitHubAuth(auth) {
  await chrome.storage.local.set({ [GITHUB_AUTH_KEY]: auth });
}

function isGitHubLoggedIn(auth) {
  return Boolean(auth?.accessToken);
}

function getGitHubAuthMarkup(auth) {
  if (isGitHubLoggedIn(auth)) {
    const username = auth.username ? `@${auth.username}` : "Signed in";
    return `
      <div class="ghAuthWrap">
        <div class="ghStatus ok">Connected ${username}</div>
        <div class="ghActionsRow">
          <button type="button" class="ghButton ghost" data-gh-action="refresh-models">Refresh Models</button>
          <button type="button" class="ghButton ghost" data-gh-action="logout">Logout</button>
        </div>
      </div>`;
  }
  if (copilotDeviceFlowState) {
    return `
      <div class="ghAuthWrap">
        <div class="ghStatus">Enter this code on GitHub:</div>
        <div class="ghCode">${copilotDeviceFlowState.userCode}</div>
        <div class="ghActionsRow">
          <button type="button" class="ghButton ghost" data-gh-action="copy-code">Copy</button>
          <button type="button" class="ghButton" data-gh-action="open-verify">Open Verification Page</button>
          <button type="button" class="ghButton ghost" data-gh-action="cancel-login">Cancel</button>
        </div>
        <div class="ghHelp">Waiting for authorization...</div>
      </div>`;
  }
  return `
    <div class="ghAuthWrap">
      <div class="ghStatus">Sign in with your GitHub account to use Copilot API.</div>
      <button type="button" class="ghButton" data-gh-action="login">Login with GitHub</button>
    </div>`;
}

async function refreshGitHubModelsFromAuth(auth) {
  if (!isGitHubLoggedIn(auth) || !globalThis.AIProviders?.GithubCopilotAPI) return;
  const api = globalThis.AIProviders.GithubCopilotAPI;
  const sessionToken = await api.ensureSessionToken(auth).catch(() => null);
  const models = await api.fetchModels(sessionToken, auth.accessToken).catch(() => null);
  if (!models || models.length === 0) return;
  auth.models = models;
  if (sessionToken) auth.sessionToken = sessionToken;
  await setGitHubAuth(auth);
  applyGitHubModelOptions(models);
  if (!providerConfigs.github_copilot) providerConfigs.github_copilot = {};
  const currentModel = providerConfigs.github_copilot.model;
  if (!models.some((item) => item.value === currentModel)) {
    providerConfigs.github_copilot.model = models[0].value;
  }
  await chrome.storage.local.set({ [PROVIDER_CONFIGS_KEY]: providerConfigs });
}

function getGitHubModelField() {
  return globalThis.AIProviders?.PROVIDERS?.github_copilot?.fields?.find((f) => f.key === "model") || null;
}

function applyGitHubModelOptions(options) {
  const modelField = getGitHubModelField();
  if (!modelField || !Array.isArray(options) || options.length === 0) return;
  modelField.options = options.map((item) => ({ value: String(item.value), label: String(item.label || item.value) }));
}

async function handleGitHubLogin() {
  if (!globalThis.AIProviders?.GithubCopilotAPI) {
    setSaveStatus("GitHub Copilot API module unavailable", "err");
    return;
  }
  const api = globalThis.AIProviders.GithubCopilotAPI;
  setSaveStatus("Starting GitHub login...", "");
  let flow;
  try {
    flow = await api.startDeviceFlow();
  } catch (error) {
    setSaveStatus(`Login start failed: ${error.message}`, "err");
    return;
  }
  copilotDeviceFlowState = {
    deviceCode: flow.device_code,
    userCode: flow.user_code,
    verifyUrl: flow.verification_uri,
    intervalSec: Number(flow.interval || 5),
    expiresAt: Date.now() + Number(flow.expires_in || 900) * 1000,
    cancelled: false
  };
  setSaveStatus("Authorize in GitHub browser page", "");
  await renderProviderFields();

  while (copilotDeviceFlowState && !copilotDeviceFlowState.cancelled && Date.now() < copilotDeviceFlowState.expiresAt) {
    await sleep(copilotDeviceFlowState.intervalSec * 1000);
    let tokenResult;
    try {
      tokenResult = await api.checkDeviceToken(copilotDeviceFlowState.deviceCode);
    } catch (error) {
      setSaveStatus(`Login check failed: ${error.message}`, "err");
      continue;
    }
    if (tokenResult?.error === "authorization_pending") continue;
    if (tokenResult?.error === "slow_down") { copilotDeviceFlowState.intervalSec += 3; continue; }
    if (tokenResult?.access_token) {
      setSaveStatus("Fetching Copilot token/model list...", "");
      const sessionResult = await api.getCopilotSessionToken(tokenResult.access_token).catch(() => null);
      const auth = {
        accessToken: tokenResult.access_token,
        username: null, loginAt: Date.now(),
        sessionToken: sessionResult?.token || null,
        sessionExpiry: sessionResult?.expiresAt || 0,
        models: []
      };
      auth.username = await api.getUsername(auth.accessToken).catch(() => null);
      auth.models = await api.fetchModels(auth.sessionToken, auth.accessToken).catch(() => []);
      await setGitHubAuth(auth);
      await refreshGitHubModelsFromAuth(auth).catch(() => null);
      copilotDeviceFlowState = null;
      setSaveStatus("GitHub Copilot login complete", "ok");
      await renderProviderFields();
      return;
    }
    if (tokenResult?.error) {
      copilotDeviceFlowState = null;
      setSaveStatus(`Login failed: ${tokenResult.error}`, "err");
      await renderProviderFields();
      return;
    }
  }
  if (copilotDeviceFlowState && !copilotDeviceFlowState.cancelled) setSaveStatus("Login timeout. Try again.", "err");
  copilotDeviceFlowState = null;
  await renderProviderFields();
}

async function handleGitHubLogout() {
  copilotDeviceFlowState = null;
  await chrome.storage.local.remove(GITHUB_AUTH_KEY);
  setSaveStatus("GitHub Copilot logged out", "ok");
  await renderProviderFields();
}

async function handleGitHubOpenVerify() {
  if (!copilotDeviceFlowState?.verifyUrl) return;
  await chrome.tabs.create({ url: copilotDeviceFlowState.verifyUrl });
}

// ─── Provider settings UI ─────────────────────────────────────────────────────

function isProviderConfigured(providerKey, config) {
  if (providerKey === "ollama" || providerKey === "github_copilot") return true;
  if (providerKey === "openai" || providerKey === "claude") return Boolean(config?.apiKey);
  if (providerKey === "azure_openai") return Boolean(config?.apiKey && config?.endpoint && config?.deployment);
  return false;
}

function renderProviderTabs() {
  if (!providerTabs) return;
  const defs = globalThis.AIProviders?.PROVIDERS || {};
  providerTabs.innerHTML = "";
  Object.entries(defs).forEach(([key, def]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `provider-tab ${key === currentProvider ? "active" : ""}`;
    btn.textContent = def.label;
    btn.addEventListener("click", () => {
      currentProvider = key;
      renderProviderTabs();
      renderProviderFields();
      setSaveStatus("", "");
    });
    providerTabs.appendChild(btn);
  });
}

function renderGitHubCopilotSettings(container, auth, def, saved) {
  container.innerHTML = getGitHubAuthMarkup(auth);
  if (!isGitHubLoggedIn(auth)) return;
  const modelField = def.fields?.find((f) => f.key === "model");
  if (!modelField) return;
  const models = auth.models?.length ? auth.models : (modelField.options || []);
  const modelRow = document.createElement("div");
  modelRow.className = "field-row";
  const label = document.createElement("span");
  label.className = "field-label";
  label.textContent = "Model";
  const select = document.createElement("select");
  select.className = "field-select";
  select.id = "aiField-model";
  select.dataset.fieldKey = "model";
  models.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.value; opt.textContent = m.label;
    select.appendChild(opt);
  });
  if (saved.model) select.value = saved.model;
  select.addEventListener("input", () => setSaveStatus("", ""));
  modelRow.appendChild(label);
  modelRow.appendChild(select);
  container.appendChild(modelRow);
}

async function renderProviderFields() {
  if (!providerFields) return;
  const defs = globalThis.AIProviders?.PROVIDERS || {};
  const def = defs[currentProvider];
  const saved = providerConfigs[currentProvider] || {};
  providerFields.innerHTML = "";
  if (!def) return;
  if (def.hasOAuthFlow) {
    const auth = await getGitHubAuth();
    renderGitHubCopilotSettings(providerFields, auth, def, saved);
    return;
  }
  if (!Array.isArray(def.fields) || def.fields.length === 0) {
    providerFields.innerHTML = '<div class="composerHint">No additional settings required.</div>';
    return;
  }
  def.fields.forEach((field) => {
    const row = document.createElement("div");
    row.className = "field-row";
    const label = document.createElement("label");
    label.className = "field-label";
    label.setAttribute("for", `aiField-${field.key}`);
    label.textContent = field.label;
    let input;
    if (field.type === "select") {
      input = document.createElement("select");
      input.className = "field-select";
      input.id = `aiField-${field.key}`;
      input.dataset.fieldKey = field.key;
      (field.options || []).forEach((opt) => {
        const node = document.createElement("option");
        node.value = opt.value; node.textContent = opt.label;
        input.appendChild(node);
      });
      input.value = saved[field.key] || field.options?.[0]?.value || "";
    } else {
      input = document.createElement("input");
      input.className = "field-input";
      input.id = `aiField-${field.key}`;
      input.dataset.fieldKey = field.key;
      input.type = field.type === "password" ? "password" : "text";
      input.placeholder = field.placeholder || "";
      input.value = saved[field.key] || "";
      input.autocomplete = "off";
    }
    input.addEventListener("input", () => setSaveStatus("", ""));
    row.appendChild(label);
    row.appendChild(input);
    providerFields.appendChild(row);
  });
}

async function loadAiConfig() {
  const result = await chrome.storage.local.get([SELECTED_PROVIDER_KEY, PROVIDER_CONFIGS_KEY]);
  providerConfigs = result[PROVIDER_CONFIGS_KEY] || {};
  const defs = globalThis.AIProviders?.PROVIDERS || {};
  const stored = result[SELECTED_PROVIDER_KEY];
  if (stored && defs[stored]) currentProvider = stored;
  const githubAuth = await getGitHubAuth();
  await refreshGitHubModelsFromAuth(githubAuth).catch(() => null);
  renderProviderTabs();
  await renderProviderFields();
}

function collectCurrentProviderConfig() {
  const defs = globalThis.AIProviders?.PROVIDERS || {};
  const def = defs[currentProvider];
  const config = {};
  if (!def || !Array.isArray(def.fields)) return config;
  if (def.hasOAuthFlow) {
    const modelNode = document.getElementById("aiField-model");
    if (modelNode instanceof HTMLSelectElement || modelNode instanceof HTMLInputElement) {
      config.model = String(modelNode.value || "").trim();
    }
    return config;
  }
  def.fields.forEach((field) => {
    const node = document.getElementById(`aiField-${field.key}`);
    if (!(node instanceof HTMLInputElement) && !(node instanceof HTMLSelectElement)) return;
    config[field.key] = String(node.value || "").trim();
  });
  return config;
}

async function saveProviderConfig() {
  const config = collectCurrentProviderConfig();
  providerConfigs[currentProvider] = config;
  await chrome.storage.local.set({
    [PROVIDER_CONFIGS_KEY]: providerConfigs,
    [SELECTED_PROVIDER_KEY]: currentProvider
  });
  setSaveStatus("Saved", "ok");
}

// ─── Filter ───────────────────────────────────────────────────────────────────

function matchesFilter(item) {
  if (!filterQuery) return true;
  const haystack = [
    item.url, item.method, item.status,
    item.responseBody, item.requestPayload,
    item.timestamp
  ].map(normalizeText).join("\n");
  return haystack.includes(normalizeText(filterQuery));
}

function updateFilterInfo(totalCount, shownCount) {
  if (!filterInfo) return;
  filterInfo.textContent = filterQuery
    ? `Filtered: ${shownCount} / ${totalCount}`
    : `Current tab logs: ${shownCount}`;
}

// ─── Item rendering ───────────────────────────────────────────────────────────

function buildHeaderTableHtml(headers) {
  if (!Array.isArray(headers) || headers.length === 0) {
    return '<span style="font-size:11px;color:var(--muted)">No headers captured</span>';
  }
  const rows = headers.map(({ name, value }) =>
    `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(value)}</td></tr>`
  ).join("");
  return `<table class="headerTable"><tbody>${rows}</tbody></table>`;
}

function buildTimingHtml(timing) {
  if (!timing || timing <= 0) {
    return '<span style="font-size:11px;color:var(--muted)">No timing info</span>';
  }
  return `<div class="timingRow"><span class="timingLabel">Total time</span><span class="timingValue">${timing.toFixed(1)} ms</span></div>`;
}

function createItemMarkup(item, index) {
  const id = escapeHtml(String(item.id || index));
  const statusClass = classifyStatus(item.status);
  const statusLabel = String(item.status || "-");
  const methodLabel = escapeHtml(item.method || "UNKNOWN");
  const urlLabel = escapeHtml(item.url || "Unknown URL");
  const timeLabel = escapeHtml(formatTimestamp(item.timestamp));
  const isOpen = expandedIds.has(String(item.id || index));
  const currentTab = activeBodyTab[id] || "response";
  const chevron = isOpen ? "▾" : "▸";

  const responseBodyText = item.responseBody === null ? "null" : String(item.responseBody || "");
  const requestPayloadText = item.requestPayload === null ? "null" : String(item.requestPayload || "(none)");

  const tabs = [
    { key: "response", label: "Response Body" },
    { key: "payload", label: "Request Payload" },
    { key: "reqheaders", label: "Req Headers" },
    { key: "resheaders", label: "Res Headers" },
    { key: "timing", label: "Timing" }
  ];

  const tabsHtml = tabs.map((t) =>
    `<button class="bodyTab${currentTab === t.key ? " active" : ""}" data-tab-id="${id}" data-tab-key="${t.key}" type="button">${t.label}</button>`
  ).join("");

  const panesHtml = `
    <div class="bodyPane${currentTab === "response" ? " active" : ""}" data-pane-id="${id}" data-pane-key="response">
      <pre>${escapeHtml(responseBodyText)}</pre>
    </div>
    <div class="bodyPane${currentTab === "payload" ? " active" : ""}" data-pane-id="${id}" data-pane-key="payload">
      <pre>${escapeHtml(requestPayloadText)}</pre>
    </div>
    <div class="bodyPane${currentTab === "reqheaders" ? " active" : ""}" data-pane-id="${id}" data-pane-key="reqheaders">
      ${buildHeaderTableHtml(item.requestHeaders)}
    </div>
    <div class="bodyPane${currentTab === "resheaders" ? " active" : ""}" data-pane-id="${id}" data-pane-key="resheaders">
      ${buildHeaderTableHtml(item.responseHeaders)}
    </div>
    <div class="bodyPane${currentTab === "timing" ? " active" : ""}" data-pane-id="${id}" data-pane-key="timing">
      ${buildTimingHtml(item.timing)}
    </div>`;

  return `
    <article class="item ${statusClass}" data-index="${index}">
      <button class="summary" data-toggle-id="${id}" type="button">
        <div class="row">
          <span class="leftMeta">
            <span class="badge">${statusLabel}</span>
            <span class="method">${methodLabel}</span>
          </span>
          <span class="chevron">${chevron}</span>
        </div>
        <div class="url" title="${urlLabel}">${urlLabel}</div>
        <div class="meta">${timeLabel}</div>
      </button>
      <div class="body${isOpen ? " open" : ""}" data-body-id="${id}">
        <div class="bodyTabs">${tabsHtml}</div>
        ${panesHtml}
      </div>
    </article>`;
}

// ─── List events ──────────────────────────────────────────────────────────────

listElement.addEventListener("click", (event) => {
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (!target) return;

  // Tab switch
  const tabBtn = target.closest("[data-tab-id]");
  if (tabBtn instanceof HTMLElement) {
    const tabId = tabBtn.getAttribute("data-tab-id");
    const tabKey = tabBtn.getAttribute("data-tab-key");
    if (tabId && tabKey) {
      activeBodyTab[tabId] = tabKey;
      // Toggle pane visibility without full re-render
      const body = listElement.querySelector(`[data-body-id="${CSS.escape(tabId)}"]`);
      if (body) {
        body.querySelectorAll(".bodyTab").forEach((btn) => {
          btn.classList.toggle("active", btn.getAttribute("data-tab-key") === tabKey);
        });
        body.querySelectorAll(".bodyPane").forEach((pane) => {
          pane.classList.toggle("active", pane.getAttribute("data-pane-key") === tabKey);
        });
      }
    }
    return;
  }

  // Toggle expand
  const toggleBtn = target.closest("[data-toggle-id]");
  if (toggleBtn instanceof HTMLElement) {
    const captureId = toggleBtn.getAttribute("data-toggle-id");
    if (!captureId) return;
    if (expandedIds.has(captureId)) {
      expandedIds.delete(captureId);
    } else {
      expandedIds.add(captureId);
    }
    lastRenderSignature = "";
    render();
  }
});

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadCaptures() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const captures = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];

  const tabId = chrome.devtools?.inspectedWindow?.tabId ?? null;
  const filtered = tabId !== null
    ? captures.filter((item) => item && item.tabId === tabId)
    : captures;

  filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return filtered;
}

// ─── AI analysis ─────────────────────────────────────────────────────────────

function buildAiPrompt(userPrompt, captures, mcpTools) {
  const compactLogs = captures.slice(0, 35).map((item, index) => ({
    idx: index + 1,
    id: item.id,
    method: item.method,
    status: item.status,
    url: truncateText(item.url, 180),
    timestamp: item.timestamp,
    requestPayload: truncateText(item.requestPayload, 300),
    responseBody: truncateText(item.responseBody, 500)
  }));

  const toolsContext = mcpTools?.length
    ? ["\n" + globalThis.MCPClient.buildContextString(mcpTools)]
    : [];

  return [
    "You are a network error analyst.",
    "Read the logs and user request, then return ONLY valid JSON.",
    "JSON schema:",
    "{",
    "  \"summary\": \"short Korean explanation\",",
    "  \"filter_query\": \"keyword query to filter logs\",",
    "  \"actions\": [\"action 1\", \"action 2\"]",
    "}",
    "Rules:",
    "- summary must be concise and practical.",
    "- filter_query should be useful with simple text contains matching.",
    "- actions should be 0~3 concrete next debugging steps.",
    ...toolsContext,
    "",
    `User request: ${userPrompt}`,
    `Total logs: ${captures.length}`,
    "Logs (latest first, truncated):",
    JSON.stringify(compactLogs, null, 2)
  ].join("\n");
}

function updatePromptButtonState() {
  const hasText = promptInput.value.trim().length > 0;
  promptSendButton.disabled = !hasText || aiRunning;
}

function applyPromptFilter() {
  filterQuery = String(promptInput.value || "").trim();
  lastRenderSignature = "";
  render();
}

async function runPromptWithAi() {
  const promptText = String(promptInput.value || "").trim();
  if (!promptText) return;

  aiRunning = true;
  updatePromptButtonState();
  setAiInfo("AI analyzing logs...");

  try {
    const captures = await loadCaptures();
    if (captures.length === 0) {
      filterQuery = "";
      lastRenderSignature = "";
      await render();
      setAiInfo("분석할 로그가 없습니다.");
      return;
    }

    const config = providerConfigs[currentProvider] || {};
    if (currentProvider === "github_copilot") {
      const githubAuth = await getGitHubAuth();
      if (!isGitHubLoggedIn(githubAuth)) {
        applyPromptFilter();
        setAiInfo("GitHub Copilot 로그인이 필요합니다. 톱니바퀴 > GitHub Copilot > Login with GitHub");
        return;
      }
    }

    if (!isProviderConfigured(currentProvider, config)) {
      applyPromptFilter();
      setAiInfo("AI 설정이 저장되지 않아 일반 필터로 동작했습니다. 톱니바퀴에서 API 설정 후 Save 해주세요.");
      return;
    }

    const mcpTools = await globalThis.MCPClient?.getAllTools().catch(() => []) || [];
    const aiPrompt = buildAiPrompt(promptText, captures, mcpTools);
    const { result, usage } = await globalThis.AIProviders.callAI(currentProvider, config, aiPrompt);

    const summary = String(result?.summary || "").trim();
    const suggestedFilter = String(result?.filter_query || "").trim();
    const actions = parseResultToArray(result?.actions).slice(0, 3);
    const providerLabel = getProviderLabel(currentProvider);

    filterQuery = suggestedFilter || promptText;
    lastRenderSignature = "";
    await render();

    const usageText = usage
      ? `Tokens in/out: ${Number(usage.input || 0)} / ${Number(usage.output || 0)}`
      : "";
    const actionText = actions.length ? `\nNext:\n- ${actions.join("\n- ")}` : "";
    setAiInfo(`[${providerLabel}] ${summary || "분석은 완료됐지만 summary가 비어 있습니다."}${usageText ? `\n${usageText}` : ""}${actionText}`);
  } catch (error) {
    applyPromptFilter();
    setAiInfo(`AI 실행 실패: ${error.message}\n일반 필터로 동작했습니다.`);
  } finally {
    aiRunning = false;
    updatePromptButtonState();
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────

function buildRenderSignature(totalCount, visibleCaptures) {
  const expandedState = Array.from(expandedIds).sort().join(",");
  const itemSignature = visibleCaptures.map((item) => {
    const id = String(item.id || "");
    const ts = String(item.timestamp || "");
    const status = String(item.status || "");
    const body = item.responseBody === null ? "null" : String(item.responseBody || "");
    const payload = item.requestPayload === null ? "null" : String(item.requestPayload || "");
    return `${id}|${ts}|${status}|${body.length}|${payload.length}`;
  }).join(";");
  return `${filterQuery}__${totalCount}__${visibleCaptures.length}__${expandedState}__${itemSignature}`;
}

async function render() {
  const captures = await loadCaptures();
  const visibleCaptures = captures.filter(matchesFilter);
  const signature = buildRenderSignature(captures.length, visibleCaptures);

  if (signature === lastRenderSignature) return;
  lastRenderSignature = signature;

  updateFilterInfo(captures.length, visibleCaptures.length);

  if (visibleCaptures.length === 0) {
    listElement.innerHTML = filterQuery
      ? '<div class="empty">No logs matched your filter.</div>'
      : '<div class="empty">No captured logs in this tab yet.<br>Make sure DevTools is open while browsing.</div>';
    return;
  }

  listElement.innerHTML = visibleCaptures.map((item, index) => createItemMarkup(item, index)).join("");
}

function autoResizePrompt() {
  if (!promptInput) return;
  promptInput.style.height = "auto";
  promptInput.style.height = `${Math.max(Math.min(promptInput.scrollHeight, 220), 96)}px`;
}

// ─── Event wiring ─────────────────────────────────────────────────────────────

refreshButton.addEventListener("click", () => {
  lastRenderSignature = "";
  render();
});

clearButton.addEventListener("click", async () => {
  await chrome.storage.local.set({ [STORAGE_KEY]: [] });
  expandedIds.clear();
  lastRenderSignature = "";
  render();
});

settingsButton.addEventListener("click", () => toggleSettingsPanel());

document.addEventListener("click", (event) => {
  if (!settingsOverlay.classList.contains("open")) return;
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  if (path.includes(settingsOverlay) || path.includes(settingsButton)) return;
  toggleSettingsPanel(false);
});

saveSettingsButton.addEventListener("click", async () => {
  try { await saveProviderConfig(); } catch (error) { setSaveStatus(`Save failed: ${error.message}`, "err"); }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { toggleSettingsPanel(false); toggleMcpPanel(false); }
});

mcpButton?.addEventListener("click", () => toggleMcpPanel());
mcpRefreshButton?.addEventListener("click", () => refreshMcpTools());

document.addEventListener("click", (event) => {
  if (!mcpOverlay?.classList.contains("open")) return;
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  if (path.includes(mcpOverlay) || path.includes(mcpButton)) return;
  toggleMcpPanel(false);
});

providerFields.addEventListener("click", async (event) => {
  const target = event.target instanceof HTMLElement
    ? event.target.closest("[data-gh-action]")
    : null;
  if (!(target instanceof HTMLElement)) return;
  const action = target.getAttribute("data-gh-action");
  if (action === "login") { await handleGitHubLogin(); return; }
  if (action === "logout") { await handleGitHubLogout(); return; }
  if (action === "open-verify") { await handleGitHubOpenVerify(); return; }
  if (action === "copy-code") {
    if (copilotDeviceFlowState?.userCode) {
      await navigator.clipboard.writeText(copilotDeviceFlowState.userCode).catch(() => null);
      setSaveStatus("Device code copied", "ok");
    }
    return;
  }
  if (action === "cancel-login") {
    if (copilotDeviceFlowState) copilotDeviceFlowState.cancelled = true;
    copilotDeviceFlowState = null;
    setSaveStatus("Login cancelled", "");
    await renderProviderFields();
    return;
  }
  if (action === "refresh-models") {
    const auth = await getGitHubAuth();
    await refreshGitHubModelsFromAuth(auth);
    setSaveStatus("Model list refreshed", "ok");
    await renderProviderFields();
  }
});

promptSendButton.addEventListener("click", () => runPromptWithAi());

promptInput.addEventListener("input", () => {
  autoResizePrompt();
  updatePromptButtonState();
});

promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    runPromptWithAi();
  }
});

// ─── Storage change listener (live update) ───────────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) {
    lastRenderSignature = "";
    render();
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

initializeTheme();
loadAiConfig().finally(() => render());
autoResizePrompt();
updatePromptButtonState();

if (globalThis.MCPClient) {
  globalThis.MCPClient.loadCached().then(() => {
    renderMcpPanel();
    globalThis.MCPClient.refreshAll().then(() => renderMcpPanel()).catch(() => null);
  });
}
