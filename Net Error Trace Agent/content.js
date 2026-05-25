const STORAGE_KEY = "capturedErrors";
const ROOT_ID = "__network_error_live_monitor_root__";
const MAX_VISIBLE_ITEMS = 100;

let isOpen = false;
let rootElement = null;
let refreshTimer = null;
let expandedIds = new Set();

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
  return Number(status) >= 500 ? "error" : "warning";
}

function ensureRoot() {
  if (rootElement && document.body.contains(rootElement)) {
    return rootElement;
  }

  const host = document.createElement("div");
  host.id = ROOT_ID;
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.left = "0";
  host.style.top = "0";
  host.style.width = "380px";
  host.style.height = "100vh";
  host.style.zIndex = "2147483646";
  host.style.transform = "translateX(-100%)";
  host.style.transition = "transform 160ms ease";
  host.style.boxShadow = "2px 0 24px rgba(0,0,0,0.2)";

  host.innerHTML = `
    <style>
      #${ROOT_ID} .panel {
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        background: linear-gradient(155deg, #f8fafc 0%, #eef2ff 100%);
        border-right: 1px solid #cbd5e1;
        color: #0f172a;
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      }

      #${ROOT_ID} .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 10px 12px;
        border-bottom: 1px solid #d1d5db;
        background: rgba(255, 255, 255, 0.88);
        backdrop-filter: blur(4px);
      }

      #${ROOT_ID} .title {
        margin: 0;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.01em;
      }

      #${ROOT_ID} .controls {
        display: flex;
        gap: 6px;
      }

      #${ROOT_ID} button {
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        padding: 5px 8px;
        background: #ffffff;
        font-size: 11px;
        cursor: pointer;
        color: #0f172a;
      }

      #${ROOT_ID} button:hover {
        background: #f8fafc;
      }

      #${ROOT_ID} .list {
        flex: 1;
        overflow: auto;
        display: grid;
        gap: 8px;
        padding: 10px;
      }

      #${ROOT_ID} .item {
        border: 1px solid #d1d5db;
        border-radius: 10px;
        overflow: hidden;
        background: #ffffff;
      }

      #${ROOT_ID} .item.warning {
        background: #fff8db;
        border-color: #facc15;
      }

      #${ROOT_ID} .item.error {
        background: #fee2e2;
        border-color: #ef4444;
      }

      #${ROOT_ID} .summary {
        width: 100%;
        text-align: left;
        border: 0;
        background: transparent;
        display: block;
        padding: 10px;
      }

      #${ROOT_ID} .row {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 5px;
      }

      #${ROOT_ID} .badge {
        font-size: 11px;
        font-weight: 700;
        border-radius: 999px;
        padding: 2px 7px;
        border: 1px solid transparent;
      }

      #${ROOT_ID} .item.warning .badge {
        color: #854d0e;
        border-color: #facc15;
      }

      #${ROOT_ID} .item.error .badge {
        color: #991b1b;
        border-color: #ef4444;
      }

      #${ROOT_ID} .method {
        font-size: 11px;
        font-weight: 700;
      }

      #${ROOT_ID} .url {
        font-size: 11px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      #${ROOT_ID} .meta {
        margin-top: 4px;
        font-size: 10px;
        color: #475569;
      }

      #${ROOT_ID} .body {
        display: none;
        border-top: 1px dashed #cbd5e1;
        padding: 10px;
        background: #ffffff;
      }

      #${ROOT_ID} .body.open {
        display: block;
      }

      #${ROOT_ID} pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 11px;
      }

      #${ROOT_ID} .empty {
        border: 1px dashed #cbd5e1;
        border-radius: 10px;
        padding: 14px;
        text-align: center;
        font-size: 12px;
        color: #64748b;
        background: #ffffff;
      }
    </style>
    <section class="panel" role="dialog" aria-label="Network Error Panel">
      <header class="header">
        <h2 class="title">Network Error Live Monitor</h2>
        <div class="controls">
          <button type="button" data-action="refresh">Refresh</button>
          <button type="button" data-action="clear">Clear</button>
          <button type="button" data-action="close">Close</button>
        </div>
      </header>
      <div class="list" data-role="list"></div>
    </section>
  `;

  document.documentElement.appendChild(host);
  rootElement = host;
  bindRootEvents();
  return rootElement;
}

function bindRootEvents() {
  if (!rootElement) {
    return;
  }

  rootElement.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const action = target.getAttribute("data-action");
    if (action === "refresh") {
      await render();
      return;
    }

    if (action === "clear") {
      await chrome.storage.local.set({ [STORAGE_KEY]: [] });
      expandedIds = new Set();
      await render();
      return;
    }

    if (action === "close") {
      closePanel();
      return;
    }

    const toggleId = target.getAttribute("data-toggle-id") || target.closest("[data-toggle-id]")?.getAttribute("data-toggle-id");
    if (!toggleId) {
      return;
    }

    if (expandedIds.has(toggleId)) {
      expandedIds.delete(toggleId);
    } else {
      expandedIds.add(toggleId);
    }

    const body = rootElement.querySelector(`[data-body-id="${CSS.escape(toggleId)}"]`);
    if (body) {
      body.classList.toggle("open");
    }
  });
}

async function loadCaptures() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const captures = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
  captures.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return captures.slice(0, MAX_VISIBLE_ITEMS);
}

function renderEmpty(listElement) {
  listElement.innerHTML = '<div class="empty">No captured 4xx/5xx responses yet.</div>';
}

function createItemMarkup(item) {
  const id = escapeHtml(String(item.id || "unknown"));
  const statusClass = classifyStatus(item.status);
  const status = escapeHtml(String(item.status || "-"));
  const method = escapeHtml(item.method || "UNKNOWN");
  const url = escapeHtml(item.url || "Unknown URL");
  const timestamp = escapeHtml(formatTimestamp(item.timestamp));
  const responseBody = escapeHtml(item.responseBody === null ? "null" : String(item.responseBody));
  const isOpen = expandedIds.has(String(item.id || "unknown"));

  return `
    <article class="item ${statusClass}">
      <button class="summary" type="button" data-toggle-id="${id}">
        <div class="row">
          <span class="badge">${status}</span>
          <span class="method">${method}</span>
        </div>
        <div class="url" title="${url}">${url}</div>
        <div class="meta">${timestamp}</div>
      </button>
      <div class="body ${isOpen ? "open" : ""}" data-body-id="${id}">
        <pre>${responseBody}</pre>
      </div>
    </article>
  `;
}

async function render() {
  if (!rootElement) {
    return;
  }

  const listElement = rootElement.querySelector("[data-role='list']");
  if (!listElement) {
    return;
  }

  const captures = await loadCaptures();
  if (captures.length === 0) {
    renderEmpty(listElement);
    return;
  }

  listElement.innerHTML = captures.map((item) => createItemMarkup(item)).join("");
}

async function openPanel() {
  ensureRoot();
  if (!rootElement) {
    return;
  }

  isOpen = true;
  rootElement.style.transform = "translateX(0)";
  await render();

  if (refreshTimer === null) {
    refreshTimer = setInterval(() => {
      if (isOpen) {
        render();
      }
    }, 2000);
  }
}

function closePanel() {
  if (!rootElement) {
    return;
  }

  isOpen = false;
  rootElement.style.transform = "translateX(-100%)";
}

function togglePanel() {
  if (isOpen) {
    closePanel();
  } else {
    openPanel();
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "toggle-network-error-panel") {
    return;
  }

  togglePanel();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (!isOpen || areaName !== "local" || !changes[STORAGE_KEY]) {
    return;
  }

  render();
});
