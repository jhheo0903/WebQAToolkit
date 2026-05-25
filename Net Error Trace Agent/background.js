const STORAGE_KEY = "capturedErrors";
const MAX_CAPTURED_ITEMS = 100;

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  if (!Array.isArray(stored[STORAGE_KEY])) {
    await chrome.storage.local.set({ [STORAGE_KEY]: [] });
  }

  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    // Ignore if browser version does not support panel behavior API.
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || typeof tab.id !== "number") {
    return;
  }

  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (error) {
    // Some pages (for example, chrome://) do not allow extension side panel access.
  }
});

function getHeaderValue(headers, headerName) {
  if (!Array.isArray(headers)) {
    return null;
  }

  const targetName = headerName.toLowerCase();
  const match = headers.find((header) => String(header.name || "").toLowerCase() === targetName);
  return match ? String(match.value || "") : null;
}

function isJsonResponse(headers) {
  const contentType = getHeaderValue(headers, "content-type");
  return Boolean(contentType && contentType.toLowerCase().includes("application/json"));
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(url);
}

function isScriptOrStylesheetRequest(details) {
  const type = String(details.type || "").toLowerCase();
  if (type === "script" || type === "stylesheet") {
    return true;
  }

  try {
    const url = new URL(details.url);
    const path = url.pathname.toLowerCase();
    return path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".css");
  } catch (error) {
    return false;
  }
}

function isExtensionInitiated(details) {
  const extensionOrigin = `chrome-extension://${chrome.runtime.id}`;
  const possibleInitiators = [details.initiator, details.documentUrl];

  return possibleInitiators.some(
    (value) => typeof value === "string" && value.startsWith(extensionOrigin)
  );
}

async function readResponseBody(details) {
  if (!isHttpUrl(details.url)) {
    return null;
  }

  if (!isJsonResponse(details.responseHeaders)) {
    return null;
  }

  try {
    const response = await fetch(details.url, {
      method: "GET",
      credentials: "include",
      cache: "no-store"
    });

    const fetchedContentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!fetchedContentType.includes("application/json")) {
      return null;
    }

    return await response.text();
  } catch (error) {
    return null;
  }
}

async function storeCapture(capture) {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const list = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];

  list.push(capture);

  if (list.length > MAX_CAPTURED_ITEMS) {
    list.splice(0, list.length - MAX_CAPTURED_ITEMS);
  }

  await chrome.storage.local.set({ [STORAGE_KEY]: list });
}

chrome.webRequest.onCompleted.addListener(
  async (details) => {
    if (isScriptOrStylesheetRequest(details)) {
      return;
    }

    if (isExtensionInitiated(details)) {
      return;
    }

    const capture = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      url: details.url,
      method: details.method,
      status: details.statusCode,
      responseBody: await readResponseBody(details),
      timestamp: new Date(details.timeStamp).toISOString(),
      pageUrl: details.initiator || details.documentUrl || null,
      tabId: Number.isInteger(details.tabId) && details.tabId >= 0 ? details.tabId : null
    };

    await storeCapture(capture);
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);
