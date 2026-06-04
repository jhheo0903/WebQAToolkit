"""WebQA Runner — background E2E test automation with screenshot capture."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from datetime import datetime
from pathlib import Path

from playwright.async_api import async_playwright

from modules.ai_client import AzureOpenAIClient
from modules.report_generator import generate_report
from modules.scenario_runner import run_scenario


def _setup_logging(level: str) -> logging.Logger:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    return logging.getLogger("webqa")


async def main(args: argparse.Namespace) -> int:
    log = _setup_logging(args.log_level)

    config_path = Path(args.config)
    if not config_path.exists():
        log.error("Config not found: %s", config_path)
        return 1

    with open(config_path, encoding="utf-8") as f:
        config = json.load(f)

    scenarios_path = Path(
        args.scenarios or config.get("scenarios_file", "scenarios/scenarios.json")
    )
    if not scenarios_path.exists():
        log.error("Scenarios not found: %s", scenarios_path)
        return 1

    with open(scenarios_path, encoding="utf-8") as f:
        scenarios: list[dict] = json.load(f)

    if not scenarios:
        log.error("No scenarios in %s", scenarios_path)
        return 1

    log.info("Loaded %d scenario(s) from %s", len(scenarios), scenarios_path)

    report_base = Path(args.report_dir or config.get("report_dir", "reports"))
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    report_dir = report_base / timestamp
    report_dir.mkdir(parents=True, exist_ok=True)
    screenshots_dir = report_dir / "screenshots"
    screenshots_dir.mkdir(exist_ok=True)
    log.info("Report directory: %s", report_dir)

    ai_client = AzureOpenAIClient(config["azure"])
    runner_config: dict = config.get("runner", {})
    browser_config: dict = config.get("browser", {})

    all_results: list[dict] = []

    async with async_playwright() as pw:
        browser_type_name = browser_config.get("type", "chromium")
        browser_type = getattr(pw, browser_type_name)

        proxy_conf = browser_config.get("proxy")
        browser = await browser_type.launch(
            headless=browser_config.get("headless", True),
            proxy={"server": proxy_conf} if proxy_conf else None,
        )

        viewport = browser_config.get("viewport", {"width": 1280, "height": 800})

        for i, scenario in enumerate(scenarios):
            scenario_id: str = scenario.get("id") or f"SC-{i + 1:03d}"
            scenario_text: str = (
                scenario.get("scenario") or scenario.get("description") or ""
            )

            if not scenario_text.strip():
                log.info("[%s] Skipping — no scenario text", scenario_id)
                all_results.append({
                    "id": scenario_id,
                    "title": scenario.get("title", ""),
                    "scenario": "",
                    "status": "skip",
                    "reason": "",
                    "steps": [],
                    "elapsed": 0.0,
                })
                continue

            log.info(
                "[%s] Starting: %s",
                scenario_id,
                scenario.get("title") or scenario_text[:60],
            )

            context = await browser.new_context(viewport=viewport)
            page = await context.new_page()

            start_url = scenario.get("url") or config.get("base_url")
            if start_url:
                await page.goto(start_url, timeout=15000)

            result = await run_scenario(
                page=page,
                scenario_id=scenario_id,
                scenario_text=scenario_text,
                ai_client=ai_client,
                screenshots_dir=screenshots_dir,
                config=runner_config,
                log=log,
            )
            result["title"] = scenario.get("title", "")
            all_results.append(result)

            await context.close()

            sym = {"pass": "✓", "fail": "✗"}.get(result["status"], "~")
            log.info(
                "[%s] %s %s  (%d steps, %.1fs)",
                scenario_id,
                sym,
                result["status"].upper(),
                len(result["steps"]),
                result["elapsed"],
            )

        await browser.close()

    report_path = report_dir / "report.html"
    generate_report(all_results, report_path)
    log.info("Report saved: %s", report_path)

    # JSON report strips base64 screenshots to keep the file small
    slim: list[dict] = []
    for r in all_results:
        slim.append({
            **r,
            "steps": [
                {k: v for k, v in s.items() if k != "screenshots"}
                for s in r.get("steps", [])
            ],
        })
    json_path = report_dir / "report.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(slim, f, ensure_ascii=False, indent=2)

    passed = sum(1 for r in all_results if r["status"] == "pass")
    failed = sum(1 for r in all_results if r["status"] == "fail")
    skipped = sum(1 for r in all_results if r["status"] == "skip")
    total = len(all_results)
    log.info("Done — PASS %d / FAIL %d / SKIP %d / TOTAL %d", passed, failed, skipped, total)

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="WebQA Runner — background E2E test automation")
    parser.add_argument("--config", default="config.json", help="Path to config.json")
    parser.add_argument("--scenarios", help="Override scenarios file path")
    parser.add_argument("--report-dir", help="Override report output directory")
    parser.add_argument(
        "--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING"],
    )
    parsed = parser.parse_args()
    sys.exit(asyncio.run(main(parsed)))
