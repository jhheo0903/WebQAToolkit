"""E2E scenario execution loop with DOM analysis, AI decisions, and screenshot capture."""

from __future__ import annotations

import asyncio
import base64
import logging
import time
from pathlib import Path

from playwright.async_api import Page

from modules.ai_client import AzureOpenAIClient
from modules.dom_analyzer import get_dom_state, serialize_elements
from modules.wait_helper import wait_after_action, wait_after_navigation


async def run_scenario(
    page: Page,
    scenario_id: str,
    scenario_text: str,
    ai_client: AzureOpenAIClient,
    screenshots_dir: Path,
    config: dict,
    log: logging.Logger,
) -> dict:
    max_steps: int = config.get("max_steps", 20)
    stable_ms: int = config.get("dom_stable_ms", 600)
    max_wait_ms: int = config.get("dom_max_wait_ms", 8000)
    take_screenshots: bool = config.get("screenshot_on_each_step", True)

    steps: list[dict] = []
    history: list[dict] = []
    start_time = time.monotonic()
    status = "incomplete"
    reason = ""

    for step_num in range(1, max_steps + 1):
        log.debug("[%s] Step %d — analyzing DOM", scenario_id, step_num)

        before_b64 = ""
        if take_screenshots:
            before_b64 = await _screenshot_b64(
                page,
                screenshots_dir / f"{scenario_id}_step_{step_num:02d}_before.png",
            )

        try:
            dom_state = await get_dom_state(page)
        except Exception as exc:
            log.warning("[%s] Step %d — DOM analysis failed: %s", scenario_id, step_num, exc)
            status = "fail"
            reason = f"DOM analysis failed: {exc}"
            break

        prompt = _build_prompt(dom_state, scenario_text, history)

        try:
            response, usage = ai_client.call(prompt)
        except Exception as exc:
            log.warning("[%s] Step %d — AI call failed: %s", scenario_id, step_num, exc)
            status = "fail"
            reason = f"AI call failed: {exc}"
            break

        action = response.get("action", {})
        thinking = response.get("thinking", "")
        action_type = action.get("type", "")

        _log_step(log, scenario_id, step_num, action_type, action)

        if action_type == "done":
            status = "pass" if action.get("pass") else "fail"
            reason = action.get("reason", "")
            steps.append(_make_step(step_num, thinking, action, before_b64, ""))
            history.append({"step": step_num, "action": action})
            break

        after_b64 = ""
        try:
            navigated = await _execute_action(page, action)
            if navigated:
                await wait_after_navigation(page, timeout_ms=10000)
            else:
                await wait_after_action(page, stable_ms=stable_ms, max_ms=max_wait_ms)
        except Exception as exc:
            log.warning("[%s] Step %d — action execution failed: %s", scenario_id, step_num, exc)

        if take_screenshots:
            after_b64 = await _screenshot_b64(
                page,
                screenshots_dir / f"{scenario_id}_step_{step_num:02d}_after.png",
            )

        steps.append(_make_step(step_num, thinking, action, before_b64, after_b64))
        history.append({"step": step_num, "action": action})

        if _is_stuck(history):
            log.warning("[%s] Same action repeated 3 times — stopping", scenario_id)
            status = "fail"
            reason = "Repeated the same action 3 times consecutively"
            break
    else:
        status = "incomplete"
        reason = f"Reached max steps ({max_steps}) without completion"

    elapsed = time.monotonic() - start_time
    return {
        "id": scenario_id,
        "scenario": scenario_text,
        "status": status,
        "reason": reason,
        "steps": steps,
        "elapsed": round(elapsed, 1),
    }


async def _execute_action(page: Page, action: dict) -> bool:
    """Execute action and return True if navigation occurred."""
    action_type = action.get("type", "")

    if action_type == "click":
        locator = page.locator(f'[data-webqa-id="{action.get("elementId", "")}"]')
        await locator.scroll_into_view_if_needed(timeout=5000)
        await locator.click(timeout=5000)
        return False

    if action_type == "fill":
        locator = page.locator(f'[data-webqa-id="{action.get("elementId", "")}"]')
        await locator.fill(action.get("value", ""), timeout=5000)
        return False

    if action_type == "navigate":
        await page.goto(action.get("url", ""), timeout=10000)
        return True

    if action_type == "wait":
        ms = min(int(action.get("ms", 2000)), 5000)
        await asyncio.sleep(ms / 1000)
        return False

    return False


async def _screenshot_b64(page: Page, save_path: Path) -> str:
    try:
        data = await page.screenshot(full_page=False)
        save_path.write_bytes(data)
        return base64.b64encode(data).decode()
    except Exception:
        return ""


def _make_step(
    step_num: int,
    thinking: str,
    action: dict,
    before_b64: str,
    after_b64: str,
) -> dict:
    return {
        "step": step_num,
        "thinking": thinking,
        "action": action,
        "screenshots": {"before": before_b64, "after": after_b64},
    }


def _is_stuck(history: list[dict]) -> bool:
    if len(history) < 3:
        return False
    last3 = history[-3:]
    return all(h["action"] == last3[0]["action"] for h in last3)


def _log_step(log: logging.Logger, sid: str, step_num: int, action_type: str, action: dict) -> None:
    if action_type in ("click", "fill"):
        detail = f"{action.get('elementId', '')} {action.get('value', '')}"
    elif action_type == "navigate":
        detail = f"→ {action.get('url', '')}"
    elif action_type == "wait":
        detail = f"{action.get('ms', '')}ms"
    elif action_type == "done":
        detail = f"pass={action.get('pass')} — {action.get('reason', '')[:60]}"
    else:
        detail = ""
    log.info("[%s] Step %d | %-10s %s", sid, step_num, action_type, detail)


def _build_prompt(dom_state: dict, scenario_text: str, history: list[dict]) -> str:
    lines: list[str] = []

    lines += [
        "[CURRENT PAGE]",
        f"URL: {dom_state['url']}",
        f"Title: {dom_state['title']}",
        f"Body: {dom_state['visibleText'][:600]}",
        "",
    ]

    if dom_state.get("fieldValues"):
        lines.append("[PAGE FIELD VALUES]")
        lines += [f"  {fv}" for fv in dom_state["fieldValues"][:40]]
        lines.append("")

    lines.append("[INTERACTABLE ELEMENTS]")
    lines.append(serialize_elements(dom_state["elements"]))
    lines.append("")

    lines += ["[TEST SCENARIO]", scenario_text, ""]

    if history:
        lines.append("[PREVIOUS ACTIONS]")
        for h in history[-5:]:
            a = h["action"]
            t = a.get("type", "")
            if t in ("click", "fill"):
                lines.append(f"  Step {h['step']}: {t} {a.get('elementId', '')} {a.get('value', '')}")
            elif t == "navigate":
                lines.append(f"  Step {h['step']}: navigate → {a.get('url', '')}")
            elif t == "wait":
                lines.append(f"  Step {h['step']}: wait {a.get('ms', '')}ms")
        lines.append("")

    lines += [
        "[RULES]",
        "- Use click for buttons, links, checkboxes, select options",
        "- Use fill for text inputs and textareas",
        "- Use navigate to go to a specific URL directly",
        "- Use wait (ms: 1000-3000) when content is still loading",
        '- Use done when complete: {"type":"done","pass":true/false,"reason":"what you verified"}',
        "- Never repeat the same action consecutively",
        "- If the test goal is achieved, call done immediately",
        "",
        "Respond with JSON only (no markdown):",
        '{"thinking": "brief reasoning", "action": {"type": "click|fill|navigate|wait|done", ...}}',
    ]

    return "\n".join(lines)
