const STORAGE_KEY = "capturedErrors";

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  if (!Array.isArray(stored[STORAGE_KEY])) {
    await chrome.storage.local.set({ [STORAGE_KEY]: [] });
  }
});
