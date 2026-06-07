"""E2E scenario execution loop with DOM analysis, AI decisions, and screenshot capture."""

from __future__ import annotations

import asyncio
import base64
import logging
import time
from datetime import datetime
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
    nav_timeout: int = config.get("navigation_timeout_ms", 10000)
    action_timeout: int = config.get("action_timeout_ms", 5000)
    full_page: bool = config.get("screenshot_full_page", True)

    steps: list[dict] = []
    history: list[dict] = []
    start_time = time.monotonic()
    status = "incomplete"
    reason = ""

    for step_num in range(1, max_steps + 1):
        log.debug("[%s] Step %d — analyzing DOM", scenario_id, step_num)

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
            steps.append(_make_step(step_num, thinking, action))
            history.append({"step": step_num, "action": action})
            break

        # Validate elementId for click/fill before attempting execution
        if action_type in ("click", "fill") and not action.get("elementId", "").strip():
            log.warning(
                "[%s] Step %d — %s action returned with no elementId; skipping execution",
                scenario_id, step_num, action_type,
            )
            hint = {**action, "elementId": "ERROR: elementId was empty — must use el-XXX from INTERACTABLE ELEMENTS"}
            steps.append(_make_step(step_num, thinking, hint))
            history.append({"step": step_num, "action": hint})
            if _is_stuck(history):
                status = "fail"
                reason = "AI repeatedly returned action without elementId"
                break
            continue

        try:
            navigated = await _execute_action(page, action, action_timeout, nav_timeout)
            if navigated or action_type == "click":
                # navigate 액션 및 click 액션 모두 networkidle + DOM stable 대기
                # click은 페이지 이동이 없어도 XHR이 끝날 때까지 기다려야 하고,
                # networkidle은 네트워크가 없으면 즉시 리턴되므로 성능 손해 없음
                await wait_after_navigation(page, timeout_ms=nav_timeout)
            else:
                await wait_after_action(page, stable_ms=stable_ms, max_ms=max_wait_ms)
        except Exception as exc:
            log.warning("[%s] Step %d — action execution failed: %s", scenario_id, step_num, exc)

        steps.append(_make_step(step_num, thinking, action))
        history.append({"step": step_num, "action": action})

        if _is_stuck(history):
            log.warning("[%s] Same action repeated 3 times — stopping", scenario_id)
            status = "fail"
            reason = "Repeated the same action 3 times consecutively"
            break
    else:
        status = "incomplete"
        reason = f"Reached max steps ({max_steps}) without completion"

    # Capture one final screenshot at the end of the scenario
    final_b64 = await _screenshot_b64(
        page,
        screenshots_dir / f"{scenario_id}_final.png",
        full_page=full_page,
    )

    elapsed = time.monotonic() - start_time
    return {
        "id": scenario_id,
        "scenario": scenario_text,
        "status": status,
        "reason": reason,
        "steps": steps,
        "final_screenshot": final_b64,
        "elapsed": round(elapsed, 1),
    }


async def _execute_action(
    page: Page,
    action: dict,
    action_timeout: int = 5000,
    nav_timeout: int = 10000,
) -> bool:
    """Execute action and return True if navigation occurred."""
    action_type = action.get("type", "")

    if action_type == "click":
        locator = page.locator(f'[data-webqa-id="{action.get("elementId", "")}"]')
        await locator.scroll_into_view_if_needed(timeout=action_timeout)
        await locator.click(timeout=action_timeout)
        return False

    if action_type == "fill":
        locator = page.locator(f'[data-webqa-id="{action.get("elementId", "")}"]')
        await locator.fill(action.get("value", ""), timeout=action_timeout)
        return False

    if action_type == "navigate":
        await page.goto(action.get("url", ""), timeout=nav_timeout)
        return True

    if action_type == "wait":
        ms = min(int(action.get("ms", 2000)), 5000)
        await asyncio.sleep(ms / 1000)
        return False

    return False


async def _screenshot_b64(page: Page, save_path: Path, full_page: bool = True) -> str:
    try:
        data = await page.screenshot(full_page=full_page)
        save_path.write_bytes(data)
        return base64.b64encode(data).decode()
    except Exception:
        return ""


def _make_step(step_num: int, thinking: str, action: dict) -> dict:
    return {
        "step": step_num,
        "thinking": thinking,
        "action": action,
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

    now = datetime.now()
    lines += [
        f"[CURRENT DATETIME] {now.strftime('%Y-%m-%d %H:%M:%S')} (today is {now.strftime('%Y-%m-%d')})",
        "",
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
            eid = a.get("elementId", "")
            if t == "click":
                lines.append(f"  Step {h['step']}: click {eid}")
            elif t == "fill":
                lines.append(f"  Step {h['step']}: fill {eid} = \"{a.get('value', '')}\"")
            elif t == "navigate":
                lines.append(f"  Step {h['step']}: navigate → {a.get('url', '')}")
            elif t == "wait":
                lines.append(f"  Step {h['step']}: wait {a.get('ms', '')}ms")
        lines.append("")

    lines += [
        "[RESPONSE FORMAT]",
        "Respond with JSON only (no markdown). Choose exactly one action:",
        "",
        '  click:    {"thinking":"...","action":{"type":"click",   "elementId":"el-XXX"}}',
        '  fill:     {"thinking":"...","action":{"type":"fill",    "elementId":"el-XXX","value":"text"}}',
        '  navigate: {"thinking":"...","action":{"type":"navigate","url":"https://..."}}',
        '  wait:     {"thinking":"...","action":{"type":"wait",    "ms":2000}}',
        '  done:     {"thinking":"...","action":{"type":"done",    "pass":true,"reason":"what you verified"}}',
        "",
        "RULES:",
        "- elementId MUST be one of the [el-XXX] IDs listed in INTERACTABLE ELEMENTS above",
        "- Never omit elementId for click or fill — it is required",
        "- Never repeat the same action consecutively",
        "- Call done immediately once the scenario goal is achieved or confirmed failed",
    ]

    return "\n".join(lines)
