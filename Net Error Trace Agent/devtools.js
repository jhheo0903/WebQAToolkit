const STORAGE_KEY = "capturedErrors";
const MAX_CAPTURED_ITEMS = 100;
const CAPTURE_FILTER_KEY = "captureStatusFilter";

chrome.devtools.panels.create(
  "Net Error Trace",
  "",
  "panel.html",
  () => {}
);

function isScriptOrStylesheet(request) {
  try {
    const path = new URL(request.request.url).pathname.toLowerCase();
    if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".css")) {
      return true;
    }
  } catch {
    // ignore invalid URL
  }

  const type = String(request._resourceType || "").toLowerCase();
  return type === "script" || type === "stylesheet";
}

function extractRequestPayload(request) {
  const postData = request.request.postData;
  if (!postData) {
    return null;
  }

  return postData.text || null;
}

async function storeCapture(capture) {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const list = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
      list.push(capture);

      if (list.length > MAX_CAPTURED_ITEMS) {
        list.splice(0, list.length - MAX_CAPTURED_ITEMS);
      }

      chrome.storage.local.set({ [STORAGE_KEY]: list }, resolve);
    });
  });
}

const DEFAULT_CAPTURE_RANGES = ["5xx"];

function isStatusCaptured(status, ranges) {
  const activeRanges = Array.isArray(ranges) && ranges.length > 0 ? ranges : DEFAULT_CAPTURE_RANGES;
  return activeRanges.some((range) => {
    if (range === "2xx") return status >= 200 && status < 300;
    if (range === "3xx") return status >= 300 && status < 400;
    if (range === "4xx") return status >= 400 && status < 500;
    if (range === "5xx") return status >= 500 && status < 600;
    return false;
  });
}

chrome.devtools.network.onRequestFinished.addListener((request) => {
  if (isScriptOrStylesheet(request)) {
    return;
  }

  const url = request.request.url;
  if (!/^https?:\/\//i.test(url)) {
    return;
  }

  const status = request.response.status;

  chrome.storage.local.get(CAPTURE_FILTER_KEY, (result) => {
    const ranges = result[CAPTURE_FILTER_KEY];
    if (!isStatusCaptured(status, ranges)) {
      return;
    }

    request.getContent((body) => {
      const capture = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        url,
        method: request.request.method,
        status: request.response.status,
        requestHeaders: request.request.headers,
        requestPayload: extractRequestPayload(request),
        responseHeaders: request.response.headers,
        responseBody: body || null,
        timing: request.time,
        timestamp: new Date().toISOString(),
        tabId: chrome.devtools.inspectedWindow.tabId
      };

      storeCapture(capture);
    });
  });
});
