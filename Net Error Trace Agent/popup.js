const STORAGE_KEY = "capturedErrors";
const listElement = document.getElementById("list");
const refreshButton = document.getElementById("refreshButton");
const clearButton = document.getElementById("clearButton");
const filterInfo = document.getElementById("filterInfo");
const promptInput = document.getElementById("promptInput");
const promptSendButton = document.getElementById("promptSendButton");
const themeToggleButton = document.getElementById("themeToggleButton");

let filterQuery = "";
const expandedIds = new Set();
let lastRenderSignature = "";
const THEME_STORAGE_KEY = "networkErrorPanelTheme";

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

promptSendButton.addEventListener("click", () => {
  applyPromptFilter();
});

promptInput.addEventListener("input", () => {
  autoResizePrompt();
  promptSendButton.disabled = promptInput.value.trim().length === 0;
});

promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    applyPromptFilter();
  }
});

render();
autoResizePrompt();
promptSendButton.disabled = true;
initializeTheme();
setInterval(render, 2000);
