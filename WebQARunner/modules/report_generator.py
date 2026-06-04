"""Self-contained HTML report generation with inline base64 screenshots."""

from __future__ import annotations

import html
from datetime import datetime
from pathlib import Path


def generate_report(results: list[dict], output_path: Path) -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    passed = sum(1 for r in results if r["status"] == "pass")
    failed = sum(1 for r in results if r["status"] == "fail")
    skipped = sum(1 for r in results if r["status"] == "skip")
    total = len(results)
    total_elapsed = sum(r.get("elapsed", 0) for r in results)

    scenario_sections = "".join(_render_scenario(r) for r in results)

    content = f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>WebQA Runner — {now}</title>
<style>{_CSS}</style>
</head>
<body>
<div class="header">
  <h1>WebQA Runner Report</h1>
  <div class="meta">{now} &nbsp;|&nbsp; 총 소요: {total_elapsed:.1f}s</div>
  <div class="summary">
    <span class="badge pass">PASS {passed}</span>
    <span class="badge fail">FAIL {failed}</span>
    <span class="badge skip">SKIP {skipped}</span>
    <span class="badge total">TOTAL {total}</span>
  </div>
</div>
<div class="scenarios">{scenario_sections}</div>
<div id="lightbox" onclick="this.classList.remove('open')"><img id="lb-img"></div>
<script>{_JS}</script>
</body>
</html>"""

    output_path.write_text(content, encoding="utf-8")


def _render_scenario(result: dict) -> str:
    status = result["status"]
    sid = html.escape(result["id"])
    title_raw = result.get("title") or result.get("scenario", "")[:80]
    title = html.escape(title_raw)
    elapsed = result.get("elapsed", 0)
    steps = result.get("steps", [])
    reason = html.escape(result.get("reason", ""))

    reason_html = f'<div class="reason">{reason}</div>' if reason else ""
    steps_html = "".join(_render_step(s) for s in steps)

    return f"""
<div class="scenario {status}">
  <div class="sc-header" onclick="toggle(this)">
    <span class="sc-title"><span class="si">{_status_icon(status)}</span> [{sid}] {title}</span>
    <span class="sc-meta">{status.upper()} &nbsp;|&nbsp; {elapsed:.1f}s &nbsp;|&nbsp; {len(steps)} steps <span class="arrow">▸</span></span>
  </div>
  <div class="sc-body">
    {reason_html}
    {steps_html}
  </div>
</div>"""


def _render_step(step: dict) -> str:
    num = step["step"]
    thinking = html.escape(step.get("thinking", ""))
    action = step.get("action", {})
    action_type = action.get("type", "")
    shots = step.get("screenshots", {})

    action_desc = html.escape(_describe_action(action))
    thinking_html = f'<div class="thinking">{thinking}</div>' if thinking else ""

    before_html = _img_tag(shots.get("before", ""), "Before")
    after_html = _img_tag(shots.get("after", ""), "After")
    shots_html = ""
    if before_html or after_html:
        shots_html = f'<div class="screenshots">{before_html}{after_html}</div>'

    return f"""
  <div class="step">
    <div class="step-hdr">
      <span class="step-num">Step {num}</span>
      <span class="step-action {action_type}">{action_desc}</span>
    </div>
    {thinking_html}
    {shots_html}
  </div>"""


def _describe_action(action: dict) -> str:
    t = action.get("type", "")
    if t == "click":
        return f"click [{action.get('elementId', '')}]"
    if t == "fill":
        val = action.get("value", "")
        if len(val) > 40:
            val = val[:40] + "..."
        return f'fill [{action.get("elementId", "")}] = "{val}"'
    if t == "navigate":
        return f"navigate → {action.get('url', '')}"
    if t == "wait":
        return f"wait {action.get('ms', '')}ms"
    if t == "done":
        return f"done (pass={action.get('pass')}) — {action.get('reason', '')[:80]}"
    return t


def _img_tag(b64: str, label: str) -> str:
    if not b64:
        return ""
    return (
        f'<div class="screenshot">'
        f'<div class="shot-label">{label}</div>'
        f'<img src="data:image/png;base64,{b64}" alt="{label}" loading="lazy" onclick="openImg(this)">'
        f'</div>'
    )


def _status_icon(status: str) -> str:
    return {"pass": "✓", "fail": "✗", "skip": "—", "incomplete": "⚠"}.get(status, "?")


_CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Consolas,'Courier New',monospace;background:#1e1e1e;color:#d4d4d4;padding:20px;font-size:13px}
h1{font-size:20px;color:#e8e8e8}
.header{background:#252526;padding:20px;border-radius:8px;margin-bottom:20px;border:1px solid #333}
.meta{color:#888;margin:6px 0 12px;font-size:12px}
.summary{display:flex;gap:10px;flex-wrap:wrap}
.badge{padding:4px 14px;border-radius:4px;font-size:12px;font-weight:bold}
.badge.pass{background:#1e4620;color:#6dbf6d;border:1px solid #2d7a2d}
.badge.fail{background:#4a1e1e;color:#e06c6c;border:1px solid #7a2d2d}
.badge.skip{background:#2e2e1e;color:#c5b06d;border:1px solid #5c5c1e}
.badge.total{background:#1e2e3e;color:#6da8e0;border:1px solid #2d5c7a}
.scenario{background:#252526;border-radius:8px;margin-bottom:12px;overflow:hidden;border:1px solid #333}
.scenario.pass{border-left:4px solid #2d7a2d}
.scenario.fail{border-left:4px solid #7a2d2d}
.scenario.skip{border-left:4px solid #5c5c1e}
.scenario.incomplete{border-left:4px solid #5c3d1e}
.sc-header{padding:12px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;user-select:none}
.sc-header:hover{background:#2d2d2d}
.sc-title{font-size:14px;color:#e8e8e8}
.si{margin-right:6px}
.scenario.pass .si{color:#6dbf6d}
.scenario.fail .si{color:#e06c6c}
.sc-meta{color:#888;font-size:12px;white-space:nowrap}
.sc-body{padding:0 16px 16px;display:none}
.sc-body.open{display:block}
.reason{color:#c5b06d;margin:10px 0;font-size:12px;padding:8px 12px;background:#1e1e1e;border-radius:4px}
.step{border-left:2px solid #3c3c3c;margin:10px 0;padding-left:14px}
.step-hdr{display:flex;align-items:center;gap:10px;margin-bottom:4px}
.step-num{color:#888;font-size:11px;min-width:52px}
.step-action{color:#9cdcfe}
.step-action.navigate{color:#ce9178}
.step-action.done{color:#6dbf6d}
.step-action.wait{color:#666}
.thinking{color:#6a9955;font-style:italic;font-size:11px;margin-bottom:6px;padding-left:4px}
.screenshots{display:flex;gap:12px;flex-wrap:wrap;margin-top:8px}
.shot-label{font-size:10px;color:#666;margin-bottom:3px;text-transform:uppercase;letter-spacing:.5px}
.screenshot img{max-width:480px;max-height:320px;border:1px solid #444;border-radius:3px;cursor:zoom-in;display:block}
.screenshot img:hover{border-color:#888}
#lightbox{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.92);z-index:1000;cursor:zoom-out;align-items:center;justify-content:center}
#lightbox.open{display:flex}
#lightbox img{max-width:95vw;max-height:95vh;border:2px solid #555;border-radius:4px}
"""

_JS = """
function toggle(hdr){
  const body=hdr.nextElementSibling;
  body.classList.toggle('open');
  hdr.querySelector('.arrow').textContent=body.classList.contains('open')?'▾':'▸';
}
function openImg(el){
  document.getElementById('lb-img').src=el.src;
  document.getElementById('lightbox').classList.add('open');
}
document.addEventListener('keydown',e=>{
  if(e.key==='Escape') document.getElementById('lightbox').classList.remove('open');
});
"""
