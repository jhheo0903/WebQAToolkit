# E2E UI Test Agent

> AI-powered E2E web testing via Chrome or Edge extension — write tests in plain language, not code.

[한국어](README.ko.md) | English

An AI agent interprets natural language scenarios and directly controls your browser tab to execute tests on any website, with no additional setup required.

---

## Features

- **No coding required** — describe what to test in plain text
- **Works on any website** — no per-site configuration needed
- **Multi-AI provider support** — Claude, OpenAI, Azure OpenAI, Ollama, or GitHub Copilot
- **Real-time visual feedback** — watch every step as it executes
- **Handles complex UI** — jqGrid, Tables, jsTree nodes, dropdowns, collapsibles, card elements, React/Vue forms
- **Token usage display** — input and output token counts shown per step in the run log
- **Bilingual UI** — Korean and English (auto-detected)

---

## How It Works

```
User enters a scenario in the side panel
              ↓
Reads the current page DOM
(assigns unique IDs to all interactive elements)
              ↓
Sends DOM state + scenario to the AI provider
              ↓
AI decides the next action (click / fill / navigate / wait)
              ↓
Executes the action with visual feedback
              ↓
Repeats up to 20 steps → PASS / FAIL
```

---

## Demo

**Scenario:** Search for `'Hello, World'` in the search box and verify that results appear.

```
Step 1 — Thinking: Search input detected on the page. Filling it with the query.
         Action: fill "Search…" ← "Hello, World"

Step 2 — Thinking: Query entered. Clicking the search button to submit.
         Action: click "Search"

Step 3 — Thinking: Results page loaded. Waiting for result items to render.
         Action: wait 1000ms

Step 4 — Thinking: Result items are visible and contain "Hello, World". Goal achieved.
         Action: done → ✅ PASS
         ↑ 1,243 · ↓ 89 tokens
```

---

## Installation

**Requirements**

- Chrome 114+ or Edge 114+ (Side Panel API required)
- An API key from at least one supported AI provider:
  - [Anthropic Claude](https://console.anthropic.com/)
  - [OpenAI](https://platform.openai.com/)
  - Azure OpenAI
  - [Ollama](https://ollama.com/) (local, no API key needed)
  - [GitHub Copilot](https://github.com/settings/tokens) (GitHub account with Copilot subscription)
- Internet connection (for cloud AI providers)

**Load the Extension**

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select this folder
4. The extension icon appears in the toolbar — done

---

## Usage

1. Navigate to the website you want to test
2. Click the extension icon to open the side panel
3. Go to **Settings**, select an AI provider, and enter your API key (saved locally, one-time)
4. Switch to the **Scenario** tab
5. Type a scenario or load a `.json` scenario file via **Load**
6. Click **Run Agent** and watch the steps execute in real time
7. Review the PASS / FAIL result and full execution log

### Writing Scenarios

Write scenarios as plain-language descriptions of what to do and what to verify:

```
Type 'Hello, World' in the search box and verify that search results appear.
```
```
Add an item to the cart and confirm navigation to the checkout page.
```
```
Fill in all fields of the registration form and verify a success message appears after submission.
```

### Verification Tips

The AI verifies results by reading visible page text and structured field values. For the most reliable verification, **write the final step as a navigation action** rather than a passive "confirm" check:

| Less reliable | More reliable |
|---|---|
| `... > confirm the app appears in favorites` | `... > click the app link in the favorites list to navigate to its detail page` |

When a click causes a URL change, the agent automatically recognizes success. This is especially important for AJAX-based actions (favorites, toggles, status changes) that update the DOM without changing the URL.

### Loading Multiple Scenarios

To run multiple scenarios in sequence, load a `.json` file:

```json
[
  {
    "id": "TC-001",
    "title": "Search Test",
    "description": "Verify search returns results",
    "scenario": "Type 'Hello, World' in the search box and confirm results appear."
  },
  {
    "id": "TC-002",
    "title": "Cart Test",
    "description": "Verify item can be added to cart",
    "scenario": "Click the first product, add it to the cart, and confirm the cart count increases."
  }
]
```

See [`scenarios.example.json`](scenarios.example.json) for the full format reference.

---

## Supported Actions

| Action | Description |
|--------|-------------|
| `click` | Click buttons, links, tabs, dropdowns, cards, or any interactive element |
| `fill` | Type text into inputs (React/Vue compatible) |
| `navigate` | Go to a specific URL |
| `wait` | Wait for async operations to complete |
| `done` | Final PASS / FAIL verdict |

---

## AI Provider Configuration

| Provider | Required Fields | Notes |
|----------|----------------|-------|
| **Claude** | API Key | Default: `claude-sonnet-4-6` |
| **OpenAI** | API Key | Default: `gpt-4o` |
| **Azure OpenAI** | API Key, Endpoint, Deployment, API Version | For enterprise deployments |
| **Ollama** | Endpoint, Model | Local inference, no API key needed |
| **GitHub Copilot** | — | OAuth login via GitHub; no token required |

API keys are stored in Chrome's local storage and never transmitted except to the configured provider endpoint.

---

## GitHub Copilot Setup

GitHub Copilot support uses the **GitHub Copilot API** (`api.githubcopilot.com`) via OAuth Device Flow — no manual token copying or app registration required. You log in directly through GitHub, and the extension fetches the model list from your Copilot subscription automatically (the same models shown in VS Code, filtered and sorted alphabetically).

### How to Log In

1. Click the extension icon → open the side panel
2. Click the gear icon (⚙) to open Settings
3. Select the **GitHub Copilot** tab
4. Click **Login with GitHub**
5. A **device code** (e.g. `XXXX-XXXX`) appears in the panel
6. Click **Enter code on GitHub →** — this opens `github.com/login/device` in a new tab
7. Enter the code and authorize
8. Return to the extension — it detects authorization and fetches your Copilot models automatically
9. Select a model and click **Save**

### Session Management

- Login persists across extension reloads (stored in Chrome local storage)
- Copilot session tokens expire after 30 minutes and are **auto-refreshed** before each test run
- Click **Logout** in Settings to clear the session

---

## License

MIT
