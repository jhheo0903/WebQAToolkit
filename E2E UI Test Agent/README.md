# E2E UI Test Agent

AI-powered browser E2E testing extension for Chrome/Edge.
Write scenarios in natural language, then let the agent read the current DOM and execute actions step by step.

[English](README.md) | [한국어](README.ko.md)

## What It Does

- Runs UI tests without writing test code
- Works on most web apps with no site-specific setup
- Uses AI providers (Claude, OpenAI, Azure OpenAI, Ollama, GitHub Copilot)
- Shows live run logs with action cards and PASS/FAIL results
- Supports single-scenario run and batch "Run All"

## How It Works

1. Select or type a scenario.
2. The extension reads page DOM and collects interactable elements.
3. It sends page state + scenario to the selected AI model.
4. The model returns one next action (`click`, `fill`, `navigate`, `wait`, `done`).
5. The action is executed in the active tab.
6. Repeat until `done` or step limit reached.

## Core Features

- Natural language scenario execution
- Scenario file loader (`.json`)
- Scenario-by-scenario run from list
- Batch execution (`Run All`) across loaded scenarios
- Per-step token usage display
- Highlight overlay for target elements
- iframe-only DOM mode (optional)
- Specialized handling for complex components:
  - jqGrid row/checkbox interaction
  - jsTree expand/select interaction
- Korean/English UI auto selection

## Batch Run (Run All)

`Run All` executes loaded scenarios sequentially while preserving individual run behavior.

- Existing single-run flow remains unchanged
- Each scenario is still executed independently
- Empty scenario text is skipped and counted as `SKIP`
- Final summary includes `PASS / FAIL / SKIP`
- `Stop` requests graceful stop after current step

## Installation

### Requirements

- Chrome 114+ or Edge 114+
- At least one configured model provider

### Load Unpacked Extension

1. Open `chrome://extensions` or `edge://extensions`
2. Enable Developer Mode
3. Click **Load unpacked**
4. Select this folder: `E2E UI Test Agent`

## Quick Start

1. Open your target website.
2. Click extension icon to open the side panel.
3. Open Settings and configure an AI provider.
4. Load a scenario JSON file or type a scenario manually.
5. Click `Run Agent` for a single scenario, or `Run All` for full batch.
6. Review logs and PASS/FAIL result cards.

## Scenario JSON Format

```json
[
  {
    "id": "TC-001",
    "title": "Search Smoke Test",
    "description": "Verify search returns results",
    "scenario": "Type 'hello' in the search input, click search, and verify results are visible."
  },
  {
    "id": "TC-002",
    "title": "Navigate to Detail",
    "description": "Verify list to detail navigation",
    "scenario": "Click the first item in the list and verify the detail page opens."
  }
]
```

Use [scenarios.example.json](scenarios.example.json) as the starter template.

## Supported Actions Returned by AI

- `click`
- `fill`
- `navigate`
- `wait`
- `done` (with pass/fail)

## Provider Setup

- Claude: API key
- OpenAI: API key
- Azure OpenAI: API key + endpoint + deployment (+ api version)
- Ollama: local endpoint + model
- GitHub Copilot: OAuth device login flow

## Privacy and Safety Notes

- The extension reads visible DOM content from active pages.
- Scenario text and extracted page context are sent to the selected model provider.
- Do not run on pages with sensitive data unless your policy allows it.

## Troubleshooting

- No response from page:
  - Refresh the page and run again.
- Wrong target element clicked:
  - Make scenario text more specific (field label, button text, expected page).
- iframe page not controlled:
  - Enable iframe-only mode in settings.
- Batch run stopped:
  - Check logs for stop request, provider error, or scenario parse issues.

## License

MIT
