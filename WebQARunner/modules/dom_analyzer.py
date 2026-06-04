"""DOM state extraction via JavaScript injection into Playwright pages."""

from __future__ import annotations

from playwright.async_api import Page

# Injected into the page to discover and serialize interactable elements.
# Assigns data-webqa-id attributes so actions can re-locate elements by ID.
_INJECT_JS = r"""
(() => {
    const SELECTORS = [
        'button:not([disabled])',
        'a[href]',
        'input:not([type="hidden"]):not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[role="button"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[role="tab"]',
        '[role="option"]',
        '[role="combobox"]',
        '[aria-expanded]',
        'label[for]',
        'tr[tabindex]',
        '[tabindex="0"]:not(input):not(button):not(a):not(select):not(textarea)'
    ].join(',');

    document.querySelectorAll('[data-webqa-id]').forEach(el => el.removeAttribute('data-webqa-id'));

    const all = [...document.querySelectorAll(SELECTORS)];
    const seen = new Set();
    const result = [];
    let counter = 1;

    for (const el of all) {
        if (seen.has(el)) continue;
        seen.add(el);

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        if (rect.bottom < -200 || rect.top > window.innerHeight + 200) continue;

        const id = 'el-' + String(counter++).padStart(3, '0');
        el.setAttribute('data-webqa-id', id);

        const tag = el.tagName.toLowerCase();
        const type = el.getAttribute('type') || null;

        let text = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 80);
        if (tag === 'tr') {
            const cells = [...el.querySelectorAll('td, th')];
            text = cells.map(c => (c.innerText || '').trim()).filter(Boolean).join(' | ').slice(0, 100);
        }

        result.push({
            id,
            tag,
            type,
            text,
            ariaLabel: el.getAttribute('aria-label') || null,
            placeholder: el.placeholder || null,
            title: el.title || null,
            name: el.name || null,
            href: el.href || null,
            role: el.getAttribute('role') || null,
            value: (el.value !== undefined && el.value !== '') ? String(el.value).slice(0, 50) : null,
            checked: (type === 'checkbox' || type === 'radio') ? el.checked : null,
            disabled: el.disabled || false
        });
    }

    const fieldValues = [];
    document.querySelectorAll('label[for]').forEach(label => {
        const input = document.getElementById(label.htmlFor);
        if (input && input.value) {
            const lText = (label.innerText || '').trim();
            if (lText) fieldValues.push(lText + ': "' + input.value + '"');
        }
    });
    document.querySelectorAll('tr').forEach(row => {
        const cells = [...row.querySelectorAll('th, td')];
        if (cells.length === 2) {
            const key = (cells[0].innerText || '').trim();
            const val = (cells[1].innerText || '').trim();
            if (key && val && val.length < 200) fieldValues.push(key + ': "' + val + '"');
        }
    });

    return {
        url: window.location.href,
        title: document.title,
        elements: result,
        elementCount: result.length,
        visibleText: (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').slice(0, 1500),
        fieldValues: fieldValues.slice(0, 40)
    };
})()
"""


async def get_dom_state(page: Page) -> dict:
    return await page.evaluate(_INJECT_JS)


def serialize_elements(elements: list[dict]) -> str:
    lines = []
    for el in elements:
        label = (
            el.get("text")
            or el.get("ariaLabel")
            or el.get("title")
            or el.get("placeholder")
            or el.get("name")
            or el.get("value")
            or ""
        )
        tag_str = f"<{el['tag']}"
        if el.get("type"):
            tag_str += f":{el['type']}"
        tag_str += ">"

        parts = [f"[{el['id']}]", tag_str]
        if label:
            parts.append(f'"{label}"')
        if el.get("placeholder") and not label:
            parts.append(f'placeholder="{el["placeholder"]}"')
        if el.get("href"):
            parts.append(f"→{el['href'][:60]}")
        if el.get("value") and el.get("type") not in ("password",):
            parts.append(f"={el['value']}")
        if el.get("checked") is not None:
            parts.append(f"checked={el['checked']}")

        lines.append("  " + " ".join(parts))
    return "\n".join(lines)
