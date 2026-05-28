const STORAGE_KEY = "capturedErrors";
const MAX_CAPTURED_ITEMS = 100;

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

chrome.devtools.network.onRequestFinished.addListener((request) => {
  if (isScriptOrStylesheet(request)) {
    return;
  }

  const url = request.request.url;
  if (!/^https?:\/\//i.test(url)) {
    return;
  }

  const status = request.response.status;
  if (status < 500 || status >= 600) {
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
