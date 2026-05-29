const STORAGE_KEY = "capturedErrors";
const PROVIDER_CONFIGS_KEY = "providerConfigs";
const SELECTED_PROVIDER_KEY = "selectedProvider";
const GITHUB_AUTH_KEY = "githubCopilotAuth";
const CAPTURE_FILTER_KEY = "captureStatusFilter";

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
const selectedIds = new Set();
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

// ─── Chat history ─────────────────────────────────────────────────────────────

const chatHistory = [];

function appendChatMessage(role, text, meta) {
  chatHistory.push({ role, text, meta });
  renderChatHistory();
}

function renderChatHistory() {
  if (!aiInfo) return;
  if (chatHistory.length === 0) {
    aiInfo.innerHTML = '<div class="chatEmpty">로그를 선택하면 AI가 분석합니다.<br>선택 없이 입력하면 자유 대화가 가능합니다.</div>';
    return;
  }
  aiInfo.innerHTML = chatHistory.map(({ role, text, meta }) => {
    const roleLabel = role === "user" ? "You" : escapeHtml(meta?.provider || "AI");
    const roleClass = role === "user" ? "chatUser" : "chatAi";
    const metaHtml = meta?.usage
      ? `<span class="chatMeta">Tokens in/out: ${meta.usage.input} / ${meta.usage.output}</span>`
      : "";
    return `
      <div class="chatMsg ${roleClass}">
        <span class="chatRole">${roleLabel}</span>
        <pre class="chatText">${escapeHtml(text)}</pre>
        ${metaHtml}
      </div>`;
  }).join("");
  aiInfo.scrollTop = aiInfo.scrollHeight;
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
  const isSelected = selectedIds.has(String(item.id || index));
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
    <article class="item ${statusClass}${isSelected ? " selected" : ""}" data-index="${index}">
      <button class="summary" data-toggle-id="${id}" type="button">
        <div class="row">
          <span class="leftMeta">
            <label class="selectCheck" title="컨텍스트로 선택">
              <input type="checkbox" class="itemCheckbox" data-select-id="${id}"${isSelected ? " checked" : ""}>
            </label>
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

function updateSelectionBadge() {
  const badge = document.getElementById("selectionBadge");
  if (!badge) return;
  const count = selectedIds.size;
  badge.textContent = count > 0 ? `${count}개 선택됨 · 컨텍스트로 사용` : "";
  badge.classList.toggle("show", count > 0);
}

function handleItemCheckbox(event, checkbox) {
  event.stopPropagation();
  const captureId = checkbox.dataset.selectId;
  if (!captureId) return;
  selectedIds[checkbox.checked ? "add" : "delete"](captureId);
  checkbox.closest("article.item")?.classList.toggle("selected", checkbox.checked);
  updateSelectionBadge();
}

function handleTabSwitch(tabBtn) {
  const { tabId, tabKey } = tabBtn.dataset;
  if (!tabId || !tabKey) return;
  activeBodyTab[tabId] = tabKey;
  const body = listElement.querySelector(`[data-body-id="${CSS.escape(tabId)}"]`);
  if (!body) return;
  body.querySelectorAll(".bodyTab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tabKey === tabKey);
  });
  body.querySelectorAll(".bodyPane").forEach((pane) => {
    pane.classList.toggle("active", pane.dataset.paneKey === tabKey);
  });
}

function handleToggleExpand(toggleBtn) {
  const captureId = toggleBtn.dataset.toggleId;
  if (!captureId) return;
  if (expandedIds.has(captureId)) {
    expandedIds.delete(captureId);
  } else {
    expandedIds.add(captureId);
  }
  lastRenderSignature = "";
  render();
}

listElement.addEventListener("click", (event) => {
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (!target) return;

  const checkbox = target.closest(".itemCheckbox");
  if (checkbox instanceof HTMLInputElement) { handleItemCheckbox(event, checkbox); return; }

  const tabBtn = target.closest("[data-tab-id]");
  if (tabBtn instanceof HTMLElement) { handleTabSwitch(tabBtn); return; }

  const toggleBtn = target.closest("[data-toggle-id]");
  if (toggleBtn instanceof HTMLElement) { handleToggleExpand(toggleBtn); }
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

function compactLog(item, index) {
  return {
    idx: index + 1,
    id: item.id,
    method: item.method,
    status: item.status,
    url: truncateText(item.url, 180),
    timestamp: item.timestamp,
    requestPayload: truncateText(item.requestPayload, 300),
    responseBody: truncateText(item.responseBody, 500)
  };
}

function buildLogAnalysisPrompt(userPrompt, selectedLogs, mcpTools, mcpContext) {
  const toolsContext = mcpTools?.length
    ? ["\n" + globalThis.MCPClient.buildContextString(mcpTools)]
    : [];

  return [
    "You are a network error analyst.",
    "Read the selected logs and user request, then return ONLY valid JSON.",
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
    mcpContext || "",
    "",
    `User request: ${userPrompt}`,
    `Selected logs (${selectedLogs.length}):`,
    JSON.stringify(selectedLogs.map(compactLog), null, 2)
  ].filter(Boolean).join("\n");
}

function findServerEntry(serverId) {
  return globalThis.MCPClient?._cache?.[serverId] || null;
}

function updatePromptButtonState() {
  const hasText = promptInput.value.trim().length > 0;
  promptSendButton.disabled = !hasText || aiRunning;
}

async function validateProviderConfig() {
  const config = providerConfigs[currentProvider] || {};
  if (currentProvider === "github_copilot") {
    const githubAuth = await getGitHubAuth();
    if (!isGitHubLoggedIn(githubAuth)) {
      return "GitHub Copilot 로그인이 필요합니다. 톱니바퀴 > GitHub Copilot > Login with GitHub";
    }
  } else if (!isProviderConfigured(currentProvider, config)) {
    return "AI 설정이 저장되지 않았습니다. 톱니바퀴에서 API 설정 후 Save 해주세요.";
  }
  return null;
}

function buildToolDecisionPrompt(userPrompt, mcpTools, logContext, toolResultContext) {
  const toolList = mcpTools.map((t) => {
    const params = t.inputSchema?.properties
      ? Object.entries(t.inputSchema.properties)
          .map(([k, v]) => `  ${k}(${v.type || "any"})${t.inputSchema.required?.includes(k) ? "*" : ""}: ${v.description || ""}`)
          .join("\n")
      : "";
    return `server_id="${t._serverId}" tool="${t.name}"\n  ${t.description || ""}${params ? "\n" + params : ""}`;
  }).join("\n\n");

  return [
    "You are a tool-use decision engine. Respond with ONLY valid JSON, nothing else.",
    "",
    "If a tool should be called next, respond:",
    '{"action":"call_tool","server_id":"...","tool":"...","args":{...}}',
    "",
    "If enough context exists to answer the user, respond:",
    '{"action":"answer","text":"...Korean answer here..."}',
    "",
    mcpTools.length ? `Available tools:\n${toolList}` : "",
    logContext ? `\nLog context:\n${logContext}` : "",
    toolResultContext ? `\nPrevious tool results:\n${toolResultContext}` : "",
    "",
    `User request: ${userPrompt}`
  ].filter(Boolean).join("\n");
}

async function runAgenticLoop(promptText, config, mcpTools, logContext) {
  const MAX_ROUNDS = 5;
  const providerLabel = getProviderLabel(currentProvider);
  let toolResultContext = "";
  let totalUsage = { input: 0, output: 0 };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const decisionPrompt = buildToolDecisionPrompt(promptText, mcpTools, logContext, toolResultContext);
    const { result, usage } = await globalThis.AIProviders.callAI(currentProvider, config, decisionPrompt);
    totalUsage.input += Number(usage?.input || 0);
    totalUsage.output += Number(usage?.output || 0);

    if (result?.action === "answer") {
      appendChatMessage("ai", String(result.text || "응답이 비어 있습니다."), {
        provider: providerLabel,
        usage: totalUsage
      });
      return;
    }

    if (result?.action === "call_tool") {
      const entry = findServerEntry(result.server_id);
      if (!entry) {
        appendChatMessage("ai", `MCP 서버를 찾을 수 없습니다: ${result.server_id}`, { provider: providerLabel });
        return;
      }

      appendChatMessage("ai", `🔧 ${entry.server.name} · ${result.tool}(${JSON.stringify(result.args || {})}) 호출 중...`, { provider: providerLabel });

      let toolResult;
      try {
        toolResult = await globalThis.MCPClient.callTool(entry.server, result.tool, result.args || {});
      } catch (err) {
        appendChatMessage("ai", `도구 호출 실패: ${err.message}`, { provider: providerLabel });
        return;
      }

      const resultText = typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult, null, 2);
      toolResultContext += `\n[${result.tool}] 결과:\n${resultText.slice(0, 4000)}\n`;
      continue;
    }

    // action이 없거나 알 수 없는 경우 — raw text로 표시
    const fallback = typeof result === "string" ? result : JSON.stringify(result);
    appendChatMessage("ai", fallback || "응답을 파싱할 수 없습니다.", { provider: providerLabel, usage: totalUsage });
    return;
  }

  appendChatMessage("ai", "도구 호출이 너무 많이 반복되어 중단했습니다.", { provider: providerLabel });
}

async function runLogAnalysis(promptText, selectedLogs, config, mcpTools) {
  const logContext = JSON.stringify(selectedLogs.map(compactLog), null, 2);
  await runAgenticLoop(promptText, config, mcpTools, logContext);
}

async function runChat(promptText, config, mcpTools) {
  await runAgenticLoop(promptText, config, mcpTools, null);
}


async function runPromptWithAi() {
  const promptText = String(promptInput.value || "").trim();
  if (!promptText) return;

  aiRunning = true;
  updatePromptButtonState();

  try {
    const validationError = await validateProviderConfig();
    if (validationError) { appendChatMessage("ai", validationError, {}); return; }

    const config = providerConfigs[currentProvider] || {};
    const mcpTools = await globalThis.MCPClient?.getAllTools().catch(() => []) || [];
    const allCaptures = await loadCaptures();
    const selectedLogs = allCaptures.filter((item) => selectedIds.has(String(item.id)));

    appendChatMessage("user", selectedLogs.length > 0
      ? `[로그 ${selectedLogs.length}개 선택] ${promptText}`
      : promptText
    );
    promptInput.value = "";
    autoResizePrompt();
    updatePromptButtonState();

    if (selectedLogs.length > 0) {
      await runLogAnalysis(promptText, selectedLogs, config, mcpTools);
    } else {
      await runChat(promptText, config, mcpTools);
    }
  } catch (error) {
    appendChatMessage("ai", `AI 실행 실패: ${error.message}`, {});
  } finally {
    aiRunning = false;
    updatePromptButtonState();
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────

function buildRenderSignature(totalCount, visibleCaptures) {
  const expandedState = Array.from(expandedIds).sort().join(",");
  const selectedState = Array.from(selectedIds).sort().join(",");
  const itemSignature = visibleCaptures.map((item) => {
    const id = String(item.id || "");
    const ts = String(item.timestamp || "");
    const status = String(item.status || "");
    const body = item.responseBody === null ? "null" : String(item.responseBody || "");
    const payload = item.requestPayload === null ? "null" : String(item.requestPayload || "");
    return `${id}|${ts}|${status}|${body.length}|${payload.length}`;
  }).join(";");
  return `${filterQuery}__${totalCount}__${visibleCaptures.length}__${expandedState}__${selectedState}__${itemSignature}`;
}

let renderPending = false;
let renderQueued = false;

async function render() {
  if (renderPending) {
    renderQueued = true;
    return;
  }
  renderPending = true;
  try {
    const captures = await loadCaptures();
    const visibleCaptures = captures.filter(matchesFilter);
    const signature = buildRenderSignature(captures.length, visibleCaptures);

    if (signature !== lastRenderSignature) {
      lastRenderSignature = signature;
      updateFilterInfo(captures.length, visibleCaptures.length);

      if (visibleCaptures.length === 0) {
        listElement.innerHTML = filterQuery
          ? '<div class="empty">No logs matched your filter.</div>'
          : '<div class="empty">No captured logs in this tab yet.<br>Make sure DevTools is open while browsing.</div>';
      } else {
        listElement.innerHTML = visibleCaptures.map((item, index) => createItemMarkup(item, index)).join("");
        updateSelectionBadge();
      }
    }
  } finally {
    renderPending = false;
    if (renderQueued) {
      renderQueued = false;
      render();
    }
  }
}

function autoResizePrompt() {
  if (!promptInput) return;
  promptInput.style.height = "auto";
  promptInput.style.height = `${Math.max(Math.min(promptInput.scrollHeight, 140), 60)}px`;
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
  const action = target.dataset.ghAction;
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

// ─── Status capture filter ────────────────────────────────────────────────────

const STATUS_RANGES = ["2xx", "3xx", "4xx", "5xx"];

function getActiveRanges() {
  return STATUS_RANGES.filter((range) => {
    const chip = document.getElementById(`chip-${range}`);
    return chip?.querySelector("input")?.checked;
  });
}

function applyChipActiveClass(range, checked) {
  const chip = document.getElementById(`chip-${range}`);
  if (!chip) return;
  chip.classList.toggle(`active-${range}`, checked);
}

async function saveCaptureFilter() {
  const ranges = getActiveRanges();
  await chrome.storage.local.set({ [CAPTURE_FILTER_KEY]: ranges });
}

async function loadCaptureFilter() {
  const result = await chrome.storage.local.get(CAPTURE_FILTER_KEY);
  const ranges = Array.isArray(result[CAPTURE_FILTER_KEY]) && result[CAPTURE_FILTER_KEY].length > 0
    ? result[CAPTURE_FILTER_KEY]
    : ["5xx"];

  STATUS_RANGES.forEach((range) => {
    const chip = document.getElementById(`chip-${range}`);
    if (!chip) return;
    const checkbox = chip.querySelector("input");
    const checked = ranges.includes(range);
    if (checkbox) checkbox.checked = checked;
    applyChipActiveClass(range, checked);
  });
}

document.querySelector(".statusFilterBar")?.addEventListener("change", async (event) => {
  const checkbox = event.target instanceof HTMLInputElement ? event.target : null;
  if (!checkbox) return;
  const range = checkbox.value;
  applyChipActiveClass(range, checkbox.checked);
  await saveCaptureFilter();
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

initializeTheme();
loadAiConfig().finally(() => render());
await loadCaptureFilter();
autoResizePrompt();
updatePromptButtonState();

if (globalThis.MCPClient) {
  globalThis.MCPClient.loadCached().then(() => {
    renderMcpPanel();
    globalThis.MCPClient.refreshAll().then(() => renderMcpPanel()).catch(() => null);
  });
}
