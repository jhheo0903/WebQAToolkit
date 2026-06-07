# WebQA Runner

Background E2E test automation tool that analyzes DOM state, executes AI-driven test scenarios, and captures a final screenshot per scenario. Designed to run unattended via Windows Task Scheduler.

---

## Features

- **Headless execution** — runs silently in the background via Playwright Chromium
- **AI-driven steps** — Azure OpenAI decides each action (click, fill, navigate, wait) by reading the serialized DOM
- **Current datetime in prompt** — today's date is injected into every AI call so date-based verifications work correctly
- **Single browser session** — all scenarios share one context; login state persists across scenarios
- **DOM stability waiting** — polls element count until the page settles before each AI call
- **Click & navigate waiting** — all click and navigate actions wait for `networkidle` + DOM stable
- **elementId validation** — skips execution and injects an error hint if the AI returns a click/fill without an element ID
- **Stuck detection** — auto-fails a scenario if the same action repeats 3 times consecutively
- **Final screenshot per scenario** — one full-page capture at the end of each scenario
- **Self-contained HTML report** — inline base64 screenshots, lightbox zoom, dark theme
- **Windows Task Scheduler ready** — `run.bat` / `run.ps1` entry points included

---

## Requirements

- Python 3.10+
- Windows 10 / 11

---

## Installation

```powershell
cd D:\src\WebQAToolkit\WebQARunner

# Create virtual environment
python -m venv .venv
.venv\Scripts\Activate.ps1

# Install dependencies
pip install -r requirements.txt

# Install Playwright browser
playwright install chromium
```

---

## Configuration

Edit `config.json` before running:

```json
{
  "azure": {
    "endpoint": "https://YOUR_RESOURCE.openai.azure.com",
    "api_key": "YOUR_API_KEY",
    "deployment": "gpt-4o",
    "api_version": "2024-02-01",
    "temperature": 0
  },
  "browser": {
    "type": "chromium",
    "headless": true,
    "proxy": null,
    "viewport": { "width": 1280, "height": 800 }
  },
  "runner": {
    "max_steps": 20,
    "dom_stable_ms": 600,
    "dom_max_wait_ms": 8000,
    "navigation_timeout_ms": 10000,
    "action_timeout_ms": 10000,
    "screenshot_full_page": true
  },
  "base_url": "https://your-app.example.com",
  "scenarios_file": "scenarios/scenarios.json",
  "report_dir": "reports"
}
```

| Field | Description |
|---|---|
| `azure.endpoint` | Azure OpenAI resource endpoint |
| `azure.api_key` | Azure OpenAI API key |
| `azure.deployment` | Deployment name (e.g. `gpt-4o`) |
| `azure.temperature` | Sampling temperature — `0` for deterministic decisions |
| `browser.type` | Browser engine (`chromium`, `firefox`, `webkit`) |
| `browser.headless` | `true` for background execution, `false` to watch the browser |
| `browser.proxy` | Proxy server URL string, or `null` |
| `browser.viewport` | Viewport size — does not limit screenshot (see `screenshot_full_page`) |
| `runner.max_steps` | Maximum steps per scenario before marking incomplete |
| `runner.dom_stable_ms` | Milliseconds of no DOM change to consider page settled |
| `runner.dom_max_wait_ms` | Hard timeout for DOM stability wait |
| `runner.navigation_timeout_ms` | Timeout for page navigation and `networkidle` wait |
| `runner.action_timeout_ms` | Timeout for click / fill element interactions |
| `runner.screenshot_full_page` | `true` captures full scrollable page; `false` captures viewport only |
| `base_url` | URL navigated to once before all scenarios begin |

---

## Writing Scenarios

Scenarios are defined in `scenarios/scenarios.json`.

All scenarios share a **single browser session**. If SC-001 logs in, SC-002 starts already authenticated. The browser navigates to `base_url` once at startup, and each scenario continues from where the previous one left off.

```json
[
  {
    "id": "SC-001",
    "title": "Add to Cart",
    "description": "Verify that a product can be added to the shopping cart.",
    "scenario": "Navigate to the Electronics category, open the first product, click Add to Cart, then verify the cart icon shows a quantity of 1."
  },
  {
    "id": "SC-002",
    "title": "Checkout Total",
    "description": "Verify the cart total is correctly calculated.",
    "scenario": "Open the shopping cart and confirm the total price matches the sum of the item prices shown."
  },
  {
    "id": "SC-003",
    "title": "Order History",
    "description": "Verify the order history page displays past orders.",
    "scenario": "Go to My Account > Order History and confirm at least one order entry is listed."
  }
]
```

| Field | Required | Description |
|---|---|---|
| `id` | No | Scenario ID (auto-assigned as `SC-001`, `SC-002`, … if omitted) |
| `title` | No | Display name shown in the report |
| `description` | No | Additional notes about the scenario |
| `scenario` | Yes | Natural language description of what to test and verify |

---

## Running

**Manual run:**
```powershell
python runner.py
```

**With overrides:**
```powershell
python runner.py --scenarios path\to\other.json --report-dir D:\reports --log-level DEBUG
```

**Via batch file (Task Scheduler):**
```
run.bat
```

### CLI Options

| Option | Default | Description |
|---|---|---|
| `--config` | `config.json` | Path to configuration file |
| `--scenarios` | _(from config)_ | Override scenarios file path |
| `--report-dir` | _(from config)_ | Override report output directory |
| `--log-level` | `INFO` | `DEBUG` / `INFO` / `WARNING` |

---

## Output

Each run creates a timestamped folder under `reports/`:

```
reports\
└── 2026-06-07_09-00-00\
    ├── report.html              ← self-contained HTML report (open in browser)
    ├── report.json              ← machine-readable results (no base64)
    └── screenshots\
        ├── SC-001_final.png
        ├── SC-002_final.png
        └── ...
```

The HTML report includes:
- Summary bar (PASS / FAIL / SKIP / INCOMPLETE counts, total elapsed time)
- Per-scenario accordion with status badge and elapsed time
- Per-step action description and AI reasoning (`thinking`)
- Final screenshot per scenario (inline base64, click-to-zoom lightbox)

---

## Windows Task Scheduler Setup

1. Open **Task Scheduler** → **Create Basic Task**
2. Set trigger (e.g. Daily at 09:00)
3. Action: **Start a program**
   - Program: `D:\src\WebQAToolkit\WebQARunner\run.bat`
   - Start in: `D:\src\WebQAToolkit\WebQARunner`
4. In **General** tab → check **"Run whether user is logged on or not"**
5. Check **"Run with highest privileges"** if the target site requires it

---

## How Playwright and AI Work Together

Playwright is the **eyes and hands**; Azure OpenAI is the **brain**. The AI cannot see the page directly, so Playwright translates the DOM into text and passes it to the AI. The AI's decision is then translated back into real browser actions by Playwright.

```
┌──────────────────────────────────────────────────────────────┐
│  Playwright (eyes + hands)            AI (brain)             │
│                                                              │
│  1. Open page                                                │
│  2. Inject JS → serialize DOM ──────────→ Build prompt:      │
│     { elements, visibleText,              - current datetime │
│       fieldValues, url ... }              - page state       │
│                                           - scenario text    │
│                                           - action history   │
│                                           Call Azure OpenAI  │
│                                                 │            │
│  3. Execute action  ←───────────────────────────┘            │
│    .click()            {"action": {"type": "click",          │
│    .fill()                          "elementId": "el-007"}}  │
│    .goto()                                                   │
│                                                              │
│  4. Wait: networkidle + DOM stable (click/navigate)          │
│           DOM stable only (fill/wait)                        │
│  5. Next step → repeat from 2                                │
└──────────────────────────────────────────────────────────────┘
```

Per-step code flow:

```python
# Playwright reads the current DOM state
dom_state = await get_dom_state(page)       # JS injection → returns element list

# Builds a text prompt (with today's date) and sends it to AI
prompt = _build_prompt(dom_state, scenario_text, history)
response, _ = ai_client.call(prompt)        # Azure OpenAI call

# AI says "click el-007" → Playwright executes it
action = response["action"]                 # {"type": "click", "elementId": "el-007"}
await page.locator('[data-webqa-id="el-007"]').click()

# Wait for page to settle, then read the updated DOM and repeat
```

---

## AI Prompt Structure

Each step sends the following sections to Azure OpenAI:

| Section | Contents |
|---|---|
| `[CURRENT DATETIME]` | Current date and time — enables date-based verifications ("오늘", "today") |
| `[CURRENT PAGE]` | URL, page title, visible body text (up to 600 chars) |
| `[PAGE FIELD VALUES]` | Label–value pairs extracted from form fields (up to 40 entries) |
| `[INTERACTABLE ELEMENTS]` | Numbered list of clickable/fillable elements (`el-001` … `el-NNN`) |
| `[TEST SCENARIO]` | Natural language scenario text |
| `[PREVIOUS ACTIONS]` | Last 5 actions taken (for context and loop prevention) |
| `[RESPONSE FORMAT]` | Required JSON schema + strict rules |

---

## How It Works

```
Task Scheduler → run.bat
    └── runner.py
         ├── Load config.json + scenarios.json
         ├── Launch headless Chromium (Playwright)
         ├── Create single browser context (shared session)
         ├── Navigate to base_url (once)
         │
         ├── [SC-001] Login Test
         │    └── Step loop (max 20):
         │         ├── Inject JS → serialize DOM elements + field values
         │         ├── Call Azure OpenAI → parse JSON action
         │         ├── Validate elementId (skip + hint if missing)
         │         ├── Execute action (click / fill / navigate / wait)
         │         ├── Wait: networkidle + DOM stable (click/navigate)
         │         │         DOM stable only (fill/wait)
         │         ├── Detect stuck loop (3× same action → fail)
         │         └── On "done" → record pass/fail, break loop
         │    └── Capture final screenshot
         │
         ├── [SC-002] Next scenario  ← session still active
         │    └── Step loop ...
         │    └── Capture final screenshot
         │
         └── Generate report.html + report.json
```

### DOM Stability Wait Strategy

After each action, the runner polls `document.querySelectorAll('*').length` every 200 ms. Once the count has remained unchanged for `dom_stable_ms` (default 600 ms), the page is considered settled. A hard `dom_max_wait_ms` timeout (default 8 s) prevents infinite waits on live-updating dashboards.

**Click and navigate actions** always wait for `networkidle` first, then run the DOM polling check as a secondary pass. This ensures both page navigations and AJAX responses triggered by clicks are fully resolved before the next step.

**Fill and wait actions** use DOM polling only, since they do not trigger network requests.

---

## Project Structure

```
WebQARunner\
├── runner.py                  Main entry point
├── requirements.txt           Python dependencies
├── config.json                Configuration
├── run.bat                    Task Scheduler batch entry point
├── run.ps1                    PowerShell entry point
├── scenarios\
│   └── scenarios.json         Test scenario definitions
├── reports\                   Generated reports (created at runtime)
└── modules\
    ├── dom_analyzer.py        JS injection for DOM state extraction and element serialization
    ├── wait_helper.py         DOM stability polling and navigation wait helpers
    ├── ai_client.py           Azure OpenAI client (json_object mode, temperature=0)
    ├── scenario_runner.py     Per-scenario step loop, prompt builder, action executor
    └── report_generator.py    Self-contained HTML report builder
```

---

## Dependencies

| Package | Purpose |
|---|---|
| `playwright` | Headless browser control, JS injection, screenshots |
| `openai` | Azure OpenAI API client (`AzureOpenAI` class) |
