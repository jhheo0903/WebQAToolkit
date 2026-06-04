# WebQA Runner

Background E2E test automation tool that analyzes DOM states, executes AI-driven test scenarios, and captures screenshots at each step. Designed to run unattended via Windows Task Scheduler.

---

## Features

- **Headless execution** — runs silently in the background via Playwright
- **AI-driven steps** — uses Azure OpenAI to decide each action (click, fill, navigate, wait)
- **DOM stability waiting** — polls element count until the page settles before proceeding
- **Per-step screenshots** — captures before/after images for every action
- **Self-contained HTML report** — inline base64 screenshots, lightbox zoom, dark theme
- **Windows Task Scheduler ready** — `run.bat` / `run.ps1` entry points included
- **Simple scenario format** — define test scenarios in plain natural language

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
    "api_version": "2024-02-01"
  },
  "browser": {
    "headless": true,
    "viewport": { "width": 1280, "height": 800 }
  },
  "runner": {
    "max_steps": 20,
    "dom_stable_ms": 600,
    "dom_max_wait_ms": 8000,
    "screenshot_on_each_step": true
  },
  "scenarios_file": "scenarios/scenarios.json",
  "report_dir": "reports"
}
```

| Field | Description |
|---|---|
| `azure.endpoint` | Azure OpenAI resource endpoint |
| `azure.api_key` | Azure OpenAI API key |
| `azure.deployment` | Deployment name (e.g. `gpt-4o`) |
| `browser.headless` | `true` for background execution, `false` to watch the browser |
| `browser.proxy` | Proxy server URL string, or `null` |
| `runner.max_steps` | Maximum steps per scenario before giving up |
| `runner.dom_stable_ms` | Milliseconds of no DOM change to consider page settled |
| `runner.dom_max_wait_ms` | Hard timeout for DOM stability wait |
| `base_url` | Default starting URL if the scenario does not specify one |

---

## Writing Scenarios

Scenarios are defined in `scenarios/scenarios.json`.

```json
[
  {
    "id": "SC-001",
    "title": "Login Test",
    "url": "http://intranet.example.com/login",
    "scenario": "Log in with admin@company.com and verify the dashboard title is visible"
  },
  {
    "id": "SC-002",
    "title": "User List Check",
    "url": "http://intranet.example.com",
    "scenario": "Navigate to User Management and confirm the user list table is displayed"
  }
]
```

| Field | Required | Description |
|---|---|---|
| `id` | No | Scenario ID (auto-assigned as `SC-001`, `SC-002`, … if omitted) |
| `title` | No | Display name shown in the report |
| `url` | No | Starting URL (falls back to `base_url` in config) |
| `scenario` | Yes | Natural language description of what to test |

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
└── 2026-06-04_09-00-00\
    ├── report.html              ← self-contained HTML report (open in browser)
    ├── report.json              ← machine-readable results (no base64)
    └── screenshots\
        ├── SC-001_step_01_before.png
        ├── SC-001_step_01_after.png
        └── ...
```

The HTML report includes:
- Summary bar (PASS / FAIL / SKIP counts, total elapsed time)
- Per-scenario accordion with status badge
- Per-step action description, AI reasoning, and before/after screenshots
- Click-to-zoom lightbox for screenshots

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

Playwright acts as the **eyes and hands**; Azure OpenAI acts as the **brain**. Because the AI cannot see the page directly, Playwright translates the DOM into text and passes it to the AI. The AI's decision is then translated back into real browser actions by Playwright.

```
┌──────────────────────────────────────────────────────────────┐
│  Playwright (eyes + hands)            AI (brain)             │
│                                                              │
│  1. Open page                                                │
│  2. Inject JS → serialize DOM ──────────→ Build prompt       │
│     { elements, visibleText,              then call          │
│       fieldValues, url ... }              Azure OpenAI       │
│                                                 │            │
│  3. Execute action  ←───────────────────────────┘            │
│    .click()            {"action": {"type": "click",          │
│    .fill()                          "elementId": "el-007"}}  │
│    .goto()                                                   │
│                                                              │
│  4. Wait for DOM stability + capture After screenshot        │
│  5. Next step → repeat from 2                                │
└──────────────────────────────────────────────────────────────┘
```

Per-step code flow:

```python
# Playwright reads the current DOM state
dom_state = await get_dom_state(page)       # JS injection → returns element list

# Builds a text prompt and sends it to AI
prompt = _build_prompt(dom_state, scenario_text, history)
response, _ = ai_client.call(prompt)        # Azure OpenAI call

# AI says "click el-007" → Playwright executes it
action = response["action"]                 # {"type": "click", "elementId": "el-007"}
await page.locator('[data-webqa-id="el-007"]').click()

# Next step: reads the updated DOM again and repeats
```

---

## How It Works

```
Task Scheduler → run.bat
    └── runner.py
         ├── Load config.json + scenarios.json
         ├── Launch headless Chromium (Playwright)
         └── For each scenario:
              ├── Navigate to starting URL
              └── Step loop (max 20):
                   ├── Capture before screenshot
                   ├── Inject JS → serialize DOM elements + field values
                   ├── Build prompt (page state + elements + history + scenario)
                   ├── Call Azure OpenAI → parse JSON action
                   ├── Execute action (click / fill / navigate / wait)
                   ├── Wait for DOM stability (element count polling)
                   ├── Capture after screenshot
                   └── On "done" action → record pass/fail, break loop
              └── Generate report.html + report.json
```

### DOM Stability Wait Strategy

After each action, the runner polls `document.querySelectorAll('*').length` every 200 ms. Once the count has remained unchanged for `dom_stable_ms` (default 600 ms), the page is considered settled. A hard `dom_max_wait_ms` timeout (default 8 s) prevents infinite waits on live-updating dashboards.

After navigation actions, `networkidle` is awaited first, then the polling wait runs as a secondary check.

---

## Project Structure

```
WebQARunner\
├── runner.py                  Main entry point
├── requirements.txt           Python dependencies
├── config.json                Configuration template
├── run.bat                    Task Scheduler batch entry point
├── run.ps1                    PowerShell entry point
├── scenarios\
│   └── scenarios.json         Test scenario definitions
├── reports\                   Generated reports (created at runtime)
└── modules\
    ├── dom_analyzer.py        JS injection for DOM state extraction
    ├── wait_helper.py         DOM stability polling helpers
    ├── ai_client.py           Azure OpenAI client
    ├── scenario_runner.py     Per-scenario execution loop
    └── report_generator.py    HTML report builder
```

---

## Dependencies

| Package | Purpose |
|---|---|
| `playwright` | Headless browser control, screenshots |
| `openai` | Azure OpenAI API client (`AzureOpenAI` class) |
