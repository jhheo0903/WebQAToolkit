# Net Error Trace Agent

Chrome Extension (Manifest V3) for monitoring, tracing, and quickly identifying causes of network failures in web applications.

## What It Does

- Captures completed network requests using `chrome.webRequest.onCompleted`
- Excludes JS/CSS asset requests to reduce noise
- Stores request metadata and optional JSON response body
- Shows logs in Chrome right-side panel
- Displays only logs for the currently active tab
- Supports fast text filtering and light/dark theme toggle

## Current Capture Rules

- Captures all HTTP status codes (not limited to 4xx/5xx)
- Skips requests identified as:
  - `type === script` or `type === stylesheet`
  - URL path ending with `.js`, `.mjs`, `.css`
- Attempts to read response body only when response `Content-Type` includes `application/json`
- Uses re-fetch with `credentials: "include"`
- On re-fetch failure, saves `responseBody: null`

## Storage

- Uses `chrome.storage.local`
- Max 100 items retained
- Oldest entries are removed when limit is exceeded

Stored object shape:

```json
{
  "id": "1710000000000-a1b2c3",
  "url": "https://example.internal/api/orders",
  "method": "GET",
  "status": 500,
  "responseBody": "{\"message\":\"internal error\"}",
  "timestamp": "2026-05-22T10:00:00.000Z",
  "pageUrl": "https://example.internal/dashboard",
  "tabId": 123
}
```

## UI Features (Side Panel)

- Auto refresh every 2 seconds
- Refresh button for manual reload
- Clear All button to reset stored logs
- Click item to expand/collapse full response body
- Prompt-style filter box:
  - Enter: apply filter
  - Shift+Enter: newline
- Theme toggle:
  - Light / Dark
  - Theme preference persisted in localStorage
- Render optimization to avoid unnecessary blinking when data has not changed

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder

## Usage

1. Open target web application page
2. Click extension action icon
3. Right side panel opens
4. Trigger network activity and inspect captured logs

## Notes

- Some pages (for example `chrome://*`) do not allow side panel access for extensions.
- Extension-originated requests are ignored to avoid self-capture loops.
