"""DOM stability waiting utilities for Playwright pages."""

from __future__ import annotations

import asyncio
import time

from playwright.async_api import Page


async def wait_for_dom_stable(
    page: Page,
    stable_ms: int = 600,
    max_ms: int = 8000,
    poll_ms: int = 200,
) -> None:
    """Poll DOM element count until stable for stable_ms or max_ms elapses.

    Replicates the waitForDomStable() strategy from the original sidepanel.js.
    """
    deadline = time.monotonic() + max_ms / 1000
    last_count = -1
    stable_since: float | None = None

    while time.monotonic() < deadline:
        try:
            count = await page.evaluate("document.querySelectorAll('*').length")
        except Exception:
            break

        now = time.monotonic()
        if count != last_count:
            last_count = count
            stable_since = now
        elif stable_since is not None and (now - stable_since) * 1000 >= stable_ms:
            break

        await asyncio.sleep(poll_ms / 1000)


async def wait_after_navigation(page: Page, timeout_ms: int = 10000) -> None:
    """Wait for networkidle then DOM stability after a page navigation."""
    try:
        await page.wait_for_load_state("networkidle", timeout=timeout_ms)
    except Exception:
        pass
    await wait_for_dom_stable(page, stable_ms=400, max_ms=3000)


async def wait_after_action(page: Page, stable_ms: int = 600, max_ms: int = 8000) -> None:
    """Wait for DOM to settle after a click or fill action."""
    await wait_for_dom_stable(page, stable_ms=stable_ms, max_ms=max_ms)
