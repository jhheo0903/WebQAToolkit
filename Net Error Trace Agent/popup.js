const STORAGE_KEY = "capturedErrors";
const PROVIDER_CONFIGS_KEY = "providerConfigs";
const SELECTED_PROVIDER_KEY = "selectedProvider";
const listElement = document.getElementById("list");
const refreshButton = document.getElementById("refreshButton");
const clearButton = document.getElementById("clearButton");
const filterInfo = document.getElementById("filterInfo");
const promptInput = document.getElementById("promptInput");
const promptSendButton = document.getElementById("promptSendButton");
const themeToggleButton = document.getElementById("themeToggleButton");
const settingsButton = document.getElementById("settingsButton");
const settingsOverlay = document.getElementById("settingsOverlay");
const providerTabs = document.getElementById("providerTabs");
const providerFields = document.getElementById("providerFields");
const saveSettingsButton = document.getElementById("saveSettingsButton");
const saveStatus = document.getElementById("saveStatus");
const aiInfo = document.getElementById("aiInfo");
const GITHUB_AUTH_KEY = "githubCopilotAuth";
const CAPTURE_PORT_NAME = "net-error-capture-session";

let filterQuery = "";
const expandedIds = new Set();
let lastRenderSignature = "";
const THEME_STORAGE_KEY = "networkErrorPanelTheme";
let currentProvider = "openai";
let providerConfigs = {};
let aiRunning = false;
let copilotDeviceFlowState = null;
let captureSessionPort = null;

function startCaptureSession() {
  if (captureSessionPort) {
    return;
  }

  try {
    captureSessionPort = chrome.runtime.connect({ name: CAPTURE_PORT_NAME });
    captureSessionPort.onDisconnect.addListener(() => {
      captureSessionPort = null;
    });
  } catch {
    captureSessionPort = null;
  }
}

function stopCaptureSession() {
  if (!captureSessionPort) {
    return;
  }

  try {
    captureSessionPort.disconnect();
  } catch {
    // Ignore teardown errors during panel close/navigation.
  }

  captureSessionPort = null;
}

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
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return date.toLocaleString();
}

function classifyStatus(status) {
  if (status >= 500) {
    return "error";
  }

  return "warning";
}

function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function getProviderLabel(providerKey) {
  return globalThis.AIProviders?.PROVIDERS?.[providerKey]?.label || providerKey;
}

function setSaveStatus(message, type) {
  if (!saveStatus) {
    return;
  }

  saveStatus.textContent = message || "";
  saveStatus.className = type ? `saveStatus ${type}` : "saveStatus";
}

function setAiInfo(message) {
  if (!aiInfo) {
    return;
  }

  const text = String(message || "").trim();
  if (!text) {
    aiInfo.textContent = "";
    aiInfo.classList.remove("show");
    return;
  }

  aiInfo.textContent = text;
  aiInfo.classList.add("show");
}

function applyTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", nextTheme);

  if (themeToggleButton) {
    themeToggleButton.textContent = nextTheme === "dark" ? "Light" : "Dark";
  }
}

function initializeTheme() {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  const preferredTheme = storedTheme === "dark" || storedTheme === "light"
    ? storedTheme
    : "light";

  applyTheme(preferredTheme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
  const nextTheme = currentTheme === "dark" ? "light" : "dark";

  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  applyTheme(nextTheme);
}

function matchesFilter(item) {
  if (!filterQuery) {
    return true;
  }

  const haystack = [
    item.url,
    item.method,
    item.status,
    item.responseBody,
    item.timestamp,
    item.pageUrl
  ]
    .map((value) => normalizeText(value))
    .join("\n");

  return haystack.includes(normalizeText(filterQuery));
}

function toggleSettingsPanel(forceOpen) {
  if (!settingsOverlay || !settingsButton) {
    return;
  }

  const shouldOpen = typeof forceOpen === "boolean"
    ? forceOpen
    : !settingsOverlay.classList.contains("open");

  settingsOverlay.classList.toggle("open", shouldOpen);
  settingsButton.classList.toggle("active", shouldOpen);
}

function parseResultToArray(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).map((item) => String(item));
  }

  return [];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getGitHubModelField() {
  const defs = globalThis.AIProviders?.PROVIDERS || {};
  return defs.github_copilot?.fields?.find((item) => item.key === "model") || null;
}

function applyGitHubModelOptions(options) {
  const modelField = getGitHubModelField();
  if (!modelField || !Array.isArray(options) || options.length === 0) {
    return;
  }

  modelField.options = options.map((item) => ({
    value: String(item.value),
    label: String(item.label || item.value)
  }));
}

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
      </div>
    `;
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
      </div>
    `;
  }

  return `
    <div class="ghAuthWrap">
      <div class="ghStatus">Sign in with your GitHub account to use Copilot API.</div>
      <button type="button" class="ghButton" data-gh-action="login">Login with GitHub</button>
    </div>
  `;
}

async function refreshGitHubModelsFromAuth(auth) {
  if (!isGitHubLoggedIn(auth) || !globalThis.AIProviders?.GithubCopilotAPI) {
    return;
  }

  const api = globalThis.AIProviders.GithubCopilotAPI;
  const sessionToken = await api.ensureSessionToken(auth).catch(() => null);
  const models = await api.fetchModels(sessionToken, auth.accessToken).catch(() => null);
  if (!models || models.length === 0) {
    return;
  }

  auth.models = models;
  if (sessionToken) {
    auth.sessionToken = sessionToken;
  }
  await setGitHubAuth(auth);

  applyGitHubModelOptions(models);

  if (!providerConfigs.github_copilot) {
    providerConfigs.github_copilot = {};
  }

  const currentModel = providerConfigs.github_copilot.model;
  const hasCurrent = models.some((item) => item.value === currentModel);
  if (!hasCurrent) {
    providerConfigs.github_copilot.model = models[0].value;
  }

  await chrome.storage.local.set({ [PROVIDER_CONFIGS_KEY]: providerConfigs });
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

    if (tokenResult?.error === "authorization_pending") {
      continue;
    }

    if (tokenResult?.error === "slow_down") {
      copilotDeviceFlowState.intervalSec += 3;
      continue;
    }

    if (tokenResult?.access_token) {
      setSaveStatus("Fetching Copilot token/model list...", "");
      const sessionResult = await api.getCopilotSessionToken(tokenResult.access_token).catch(() => null);
      const sessionToken = sessionResult?.token || null;
      const sessionExpiry = sessionResult?.expiresAt || 0;

      const auth = {
        accessToken: tokenResult.access_token,
        username: null,
        loginAt: Date.now(),
        sessionToken,
        sessionExpiry,
        models: []
      };

      auth.username = await api.getUsername(auth.accessToken).catch(() => null);
      auth.models = await api.fetchModels(sessionToken, auth.accessToken).catch(() => []);
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

  if (copilotDeviceFlowState && !copilotDeviceFlowState.cancelled) {
    setSaveStatus("Login timeout. Try again.", "err");
  }

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
  if (!copilotDeviceFlowState?.verifyUrl) {
    return;
  }

  await chrome.tabs.create({ url: copilotDeviceFlowState.verifyUrl });
}

function isProviderConfigured(providerKey, config) {
  if (providerKey === "ollama") {
    return true;
  }

  if (providerKey === "github_copilot") {
    return true;
  }

  if (providerKey === "openai" || providerKey === "claude") {
    return Boolean(config?.apiKey);
  }

  if (providerKey === "azure_openai") {
    return Boolean(config?.apiKey && config?.endpoint && config?.deployment);
  }

  return false;
}

function updatePromptButtonState() {
  const hasText = promptInput.value.trim().length > 0;
  promptSendButton.disabled = !hasText || aiRunning;
}

function renderProviderTabs() {
  if (!providerTabs) {
    return;
  }

  const defs = globalThis.AIProviders?.PROVIDERS || {};
  providerTabs.innerHTML = "";

  Object.entries(defs).forEach(([providerKey, def]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `provider-tab ${providerKey === currentProvider ? "active" : ""}`;
    button.textContent = def.label;
    button.addEventListener("click", () => {
      currentProvider = providerKey;
      renderProviderTabs();
      renderProviderFields();
      setSaveStatus("", "");
    });
    providerTabs.appendChild(button);
  });
}

function renderGitHubCopilotSettings(container, auth, def, saved) {
  container.innerHTML = getGitHubAuthMarkup(auth);
  if (!isGitHubLoggedIn(auth)) {
    return;
  }

  const modelField = def.fields?.find((field) => field.key === "model");
  if (!modelField) {
    return;
  }

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

  models.forEach((model) => {
    const option = document.createElement("option");
    option.value = model.value;
    option.textContent = model.label;
    select.appendChild(option);
  });

  if (saved.model) {
    select.value = saved.model;
  }

  select.addEventListener("input", () => setSaveStatus("", ""));
  modelRow.appendChild(label);
  modelRow.appendChild(select);
  container.appendChild(modelRow);
}

async function renderProviderFields() {
  if (!providerFields) {
    return;
  }

  const defs = globalThis.AIProviders?.PROVIDERS || {};
  const def = defs[currentProvider];
  const saved = providerConfigs[currentProvider] || {};

  providerFields.innerHTML = "";

  if (!def) {
    return;
  }

  if (def.hasOAuthFlow) {
    const auth = await getGitHubAuth();
    renderGitHubCopilotSettings(providerFields, auth, def, saved);
    return;
  }

  if (!Array.isArray(def.fields) || def.fields.length === 0) {
    providerFields.innerHTML = "<div class=\"composerHint\">No additional settings required.</div>";
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
      (field.options || []).forEach((option) => {
        const node = document.createElement("option");
        node.value = option.value;
        node.textContent = option.label;
        input.appendChild(node);
      });
      const defaultValue = field.options?.[0]?.value || "";
      input.value = saved[field.key] || defaultValue;
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
  const storedProvider = result[SELECTED_PROVIDER_KEY];
  if (storedProvider && defs[storedProvider]) {
    currentProvider = storedProvider;
  }

  const githubAuth = await getGitHubAuth();
  await refreshGitHubModelsFromAuth(githubAuth).catch(() => null);

  renderProviderTabs();
  await renderProviderFields();
}

function collectCurrentProviderConfig() {
  const defs = globalThis.AIProviders?.PROVIDERS || {};
  const def = defs[currentProvider];
  const config = {};

  if (!def || !Array.isArray(def.fields)) {
    return config;
  }

  if (def.hasOAuthFlow) {
    const modelNode = document.getElementById("aiField-model");
    if (modelNode instanceof HTMLSelectElement || modelNode instanceof HTMLInputElement) {
      config.model = String(modelNode.value || "").trim();
    }
    return config;
  }

  def.fields.forEach((field) => {
    const node = document.getElementById(`aiField-${field.key}`);
    if (!(node instanceof HTMLInputElement) && !(node instanceof HTMLSelectElement)) {
      return;
    }
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

providerFields.addEventListener("click", async (event) => {
  const target = event.target instanceof HTMLElement
    ? event.target.closest("[data-gh-action]")
    : null;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const action = target.getAttribute("data-gh-action");
  if (!action) {
    return;
  }

  if (action === "login") {
    await handleGitHubLogin();
    return;
  }

  if (action === "logout") {
    await handleGitHubLogout();
    return;
  }

  if (action === "open-verify") {
    await handleGitHubOpenVerify();
    return;
  }

  if (action === "copy-code") {
    if (copilotDeviceFlowState?.userCode) {
      await navigator.clipboard.writeText(copilotDeviceFlowState.userCode).catch(() => null);
      setSaveStatus("Device code copied", "ok");
    }
    return;
  }

  if (action === "cancel-login") {
    if (copilotDeviceFlowState) {
      copilotDeviceFlowState.cancelled = true;
    }
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

function updateFilterInfo(totalCount, shownCount) {
  if (!filterInfo) {
    return;
  }

  if (!filterQuery) {
    filterInfo.textContent = `Current tab logs: ${shownCount}`;
    return;
  }

  filterInfo.textContent = `Filtered: ${shownCount} / ${totalCount}`;
}

function createItemMarkup(item, index) {
  const captureId = escapeHtml(String(item.id || index));
  const statusClass = classifyStatus(item.status);
  const statusLabel = String(item.status || "-");
  const methodLabel = escapeHtml(item.method || "UNKNOWN");
  const urlLabel = escapeHtml(item.url || "Unknown URL");
  const timeLabel = escapeHtml(formatTimestamp(item.timestamp));
  const bodyText = item.responseBody === null ? "null" : String(item.responseBody);
  const bodyLabel = escapeHtml(bodyText);
  const isOpen = expandedIds.has(String(item.id || index));
  const chevron = isOpen ? "▾" : "▸";

  return `
    <article class="item ${statusClass}" data-index="${index}">
      <button class="summary" data-toggle-id="${captureId}" type="button">
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
      <div class="body ${isOpen ? "open" : ""}" data-body-id="${captureId}">
        <pre>${bodyLabel}</pre>
      </div>
    </article>
  `;
}

listElement.addEventListener("click", (event) => {
  const target = event.target instanceof HTMLElement
    ? event.target.closest("[data-toggle-id]")
    : null;

  if (!(target instanceof HTMLElement)) {
    return;
  }

  const captureId = target.getAttribute("data-toggle-id");
  if (!captureId) {
    return;
  }

  if (expandedIds.has(captureId)) {
    expandedIds.delete(captureId);
  } else {
    expandedIds.add(captureId);
  }

  render();
});

async function loadCaptures() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const captures = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTabId = tabs[0] && Number.isInteger(tabs[0].id) ? tabs[0].id : null;

  const filtered = activeTabId === null
    ? captures
    : captures.filter((item) => item && item.tabId === activeTabId);

  filtered.sort((a, b) => {
    const aTime = new Date(a.timestamp).getTime();
    const bTime = new Date(b.timestamp).getTime();
    return bTime - aTime;
  });

  return filtered;
}

function autoResizePrompt() {
  if (!promptInput) {
    return;
  }

  promptInput.style.height = "auto";
  const nextHeight = Math.min(promptInput.scrollHeight, 220);
  promptInput.style.height = `${Math.max(nextHeight, 96)}px`;
}

function applyPromptFilter() {
  filterQuery = String(promptInput.value || "").trim();
  lastRenderSignature = "";
  render();
}

function truncateText(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}...`;
}

function buildAiPrompt(userPrompt, captures) {
  const compactLogs = captures.slice(0, 35).map((item, index) => ({
    idx: index + 1,
    id: item.id,
    method: item.method,
    status: item.status,
    url: truncateText(item.url, 180),
    timestamp: item.timestamp,
    responseBody: truncateText(item.responseBody, 500)
  }));

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
    "",
    `User request: ${userPrompt}`,
    `Total logs: ${captures.length}`,
    "Logs (latest first, truncated):",
    JSON.stringify(compactLogs, null, 2)
  ].join("\n");
}

async function runPromptWithAi() {
  const promptText = String(promptInput.value || "").trim();
  if (!promptText) {
    return;
  }

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

    const aiPrompt = buildAiPrompt(promptText, captures);
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

function buildRenderSignature(totalCount, visibleCaptures) {
  const expandedState = Array.from(expandedIds).sort().join(",");
  const itemSignature = visibleCaptures
    .map((item) => {
      const id = String(item.id || "");
      const ts = String(item.timestamp || "");
      const status = String(item.status || "");
      const body = item.responseBody === null ? "null" : String(item.responseBody || "");
      return `${id}|${ts}|${status}|${body.length}`;
    })
    .join(";");

  return `${filterQuery}__${totalCount}__${visibleCaptures.length}__${expandedState}__${itemSignature}`;
}

async function render() {
  const captures = await loadCaptures();
  const visibleCaptures = captures.filter(matchesFilter);
  const signature = buildRenderSignature(captures.length, visibleCaptures);

  if (signature === lastRenderSignature) {
    return;
  }

  lastRenderSignature = signature;

  updateFilterInfo(captures.length, visibleCaptures.length);

  if (visibleCaptures.length === 0) {
    listElement.innerHTML = filterQuery
      ? '<div class="empty">No logs matched your filter.</div>'
      : '<div class="empty">No captured logs in this tab yet.</div>';
    return;
  }

  listElement.innerHTML = visibleCaptures.map((item, index) => createItemMarkup(item, index)).join("");
}

refreshButton.addEventListener("click", () => {
  render();
});

clearButton.addEventListener("click", async () => {
  await chrome.storage.local.set({ [STORAGE_KEY]: [] });
  expandedIds.clear();
  lastRenderSignature = "";
  render();
});

themeToggleButton.addEventListener("click", () => {
  toggleTheme();
});

settingsButton.addEventListener("click", () => {
  toggleSettingsPanel();
});

document.addEventListener("click", (event) => {
  if (!settingsOverlay.classList.contains("open")) {
    return;
  }

  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  const clickedInsideOverlay = path.includes(settingsOverlay);
  const clickedSettingsButton = path.includes(settingsButton);

  if (clickedInsideOverlay || clickedSettingsButton) {
    return;
  }

  toggleSettingsPanel(false);
});

saveSettingsButton.addEventListener("click", async () => {
  try {
    await saveProviderConfig();
  } catch (error) {
    setSaveStatus(`Save failed: ${error.message}`, "err");
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    toggleSettingsPanel(false);
  }
});

promptSendButton.addEventListener("click", () => {
  runPromptWithAi();
});

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

initializeTheme();
startCaptureSession();
loadAiConfig().finally(() => {
  render();
});
autoResizePrompt();
updatePromptButtonState();
setInterval(render, 2000);

window.addEventListener("beforeunload", () => {
  stopCaptureSession();
});
