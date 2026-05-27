// content.js
// 모든 페이지에 자동 주입 - DOM 읽기 및 액션 실행 담당
(function () {
  'use strict';

  // 이미 로드됐으면 스킵
  if (globalThis.__pageAgentLoaded) return;
  globalThis.__pageAgentLoaded = true;

  // ─── 하이라이트 오버레이 ───────────────────────────

  let highlightEl = null;

  function createHighlight() {
    const div = document.createElement('div');
    div.id = '__page_agent_highlight__';
    div.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 2147483647;
      border: 3px solid #6366f1;
      border-radius: 4px;
      box-shadow: 0 0 0 4px rgba(99,102,241,0.25);
      transition: all 0.15s ease;
      display: none;
    `;
    document.body.appendChild(div);
    return div;
  }

  function showHighlight(el) {
    if (!highlightEl) highlightEl = createHighlight();
    const rect = el.getBoundingClientRect();
    highlightEl.style.display = 'block';
    highlightEl.style.top = `${rect.top - 3}px`;
    highlightEl.style.left = `${rect.left - 3}px`;
    highlightEl.style.width = `${rect.width + 6}px`;
    highlightEl.style.height = `${rect.height + 6}px`;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function hideHighlight() {
    if (highlightEl) highlightEl.style.display = 'none';
  }

  // ─── ID 주입 ──────────────────────────────────────

  function injectIds() {
    // 기존 ID 제거
    document.querySelectorAll('[data-agent-id]').forEach(el =>
      el.removeAttribute('data-agent-id')
    );

    let counter = 0;
    const selector = [
      'button:not([disabled])',
      'a[href]',
      'input:not([disabled]):not([type="hidden"])',
      'label[for]',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[role="button"]:not([disabled])',
      '[role="link"]',
      '[role="tab"]',
      '[role="menuitem"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="switch"]',
      '[role="row"]',
      '[role="gridcell"]',
      // 커스텀 드롭다운 — listbox/combobox/option
      '[role="option"]',
      '[role="listbox"]',
      '[role="combobox"]:not([disabled])',
      // collapse/accordion 트리거 — 버튼이 아닌 요소에 aria-expanded가 붙는 경우
      '[aria-expanded]:not(button):not(a):not([role="button"]):not([disabled])',
      // jqGrid 행
      'tr[tabindex]',
      'tr.jqgrow',
      'tr.ui-widget-content',
      // jsTree 앵커 (노드 텍스트 클릭)
      'a.jstree-anchor',
      // jsTree 토글 버튼 (펼치기/닫기)
      'i.jstree-ocl',
      // onclick 속성이 직접 붙은 비인터랙티브 요소 (div/span 카드 등)
      // 자식에 이미 캡처되는 요소가 있으면 제외 — 부모+자식 중복 방지
      '[onclick]:not(button):not(a):not(input):not(select):not(textarea):not(:has(a[href])):not(:has(button)):not([data-agent-id])',
      // tabindex로 포커스 가능한 요소
      // a[href]/button/input 등 이미 위 선택자로 잡히는 태그는 제외
      // 또한 클릭 가능한 자식 요소(a, button)를 이미 포함하는 li/div는 제외 —
      // 부모+자식이 동시에 노출되면 AI가 같은 항목을 두 번 클릭하는 오동작 발생
      '[tabindex="0"]:not(body):not(a):not(button):not(input):not(select):not(textarea):not(:has(a[href])):not(:has(button)):not([data-agent-id])',
    ].join(', ');

    document.querySelectorAll(selector).forEach(el => {
      const rect = el.getBoundingClientRect();
      const inViewport = rect.width > 0 && rect.height > 0 &&
        rect.top < globalThis.innerHeight + 200 &&
        rect.bottom > -200;

      if (inViewport) {
        el.setAttribute('data-agent-id', `el-${String(++counter).padStart(3, '0')}`);
      }
    });

    return counter;
  }

  // ─── DOM 상태 읽기 ────────────────────────────────

  function getTableRowText(el) {
    const cells = Array.from(el.querySelectorAll('td, th'))
      .map(td => td.textContent.trim().replaceAll(/\s+/g, ' '))
      .filter(t => t.length > 0);
    return cells.join(' | ').slice(0, 120);
  }

  function getJsTreeToggleText(el) {
    const liNode = el.closest('li[role="treeitem"]');
    const anchor = liNode?.querySelector('a.jstree-anchor');
    const nodeText = anchor ? anchor.textContent.trim().replaceAll(/\s+/g, ' ') : '';
    const isLeaf = liNode?.classList.contains('jstree-leaf');
    const isOpen = liNode?.classList.contains('jstree-open');
    if (isLeaf) return `[toggle-leaf] ${nodeText}`;
    if (isOpen) return `[collapse] ${nodeText}`;
    return `[expand] ${nodeText}`;
  }

  function getJsTreeNodeText(el) {
    const liNode = el.closest('li[role="treeitem"]');
    const isOpen     = liNode?.classList.contains('jstree-open');
    const isLeaf     = liNode?.classList.contains('jstree-leaf');
    const isSelected = liNode?.classList.contains('jstree-clicked');
    const nodeText   = el.textContent.trim().replaceAll(/\s+/g, ' ');
    let state;
    if (isOpen)     state = 'open';
    else if (isLeaf) state = 'leaf';
    else             state = 'closed';
    const selectedSuffix = isSelected ? '-selected' : '';
    return `[treenode${selectedSuffix}-${state}] ${nodeText}`;
  }

  function getCheckboxContextText(el) {
    const row = el.closest('tr');
    if (!row) return '[checkbox]';

    const rowName = row.dataset.name ||
      row.querySelector('.name')?.textContent?.trim() || '';
    const rowSummary = getTableRowText(row);
    const hiddenTexts = Array.from(row.querySelectorAll('span.hidden'))
      .map(node => (node.textContent || '').trim().replaceAll(/\s+/g, ' '))
      .filter(Boolean);
    const titleHints = Array.from(row.querySelectorAll('[title]'))
      .map(node => (node.getAttribute('title') || '').trim().replaceAll(/\s+/g, ' '))
      .filter(Boolean);

    const labelParts = [rowName, rowSummary, ...hiddenTexts, ...titleHints]
      .filter(Boolean)
      .filter((text, idx, arr) => arr.indexOf(text) === idx);
    const label = labelParts.join(' | ');
    return label ? `[checkbox] ${label}` : '[checkbox]';
  }

  function getCheckboxInputFromLabel(el) {
    if (!el || el.tagName?.toLowerCase() !== 'label') return null;
    const targetId = el.getAttribute('for');
    if (!targetId) return null;
    const target = document.getElementById(targetId);
    if (target?.tagName?.toLowerCase() !== 'input' || target.type !== 'checkbox') return null;
    return target;
  }

  function getElementText(el, tag, cls) {
    if (tag === 'tr')                             return getTableRowText(el);
    if (tag === 'input' && el.type === 'checkbox') return getCheckboxContextText(el);
    if (tag === 'textarea') {
      return (el.value || el.textContent || '').trim().replaceAll(/\s+/g, ' ').slice(0, 160);
    }
    if (tag === 'label') {
      const checkbox = getCheckboxInputFromLabel(el);
      if (checkbox) return getCheckboxContextText(checkbox);
    }
    if (tag === 'i' && cls.includes('jstree-ocl')) return getJsTreeToggleText(el);
    if (tag === 'a' && cls.includes('jstree-anchor')) return getJsTreeNodeText(el);
    return (el.textContent || el.innerText || '').trim().replaceAll(/\s+/g, ' ').slice(0, 80);
  }

  function getDOMState() {
    const count = injectIds();

    const elements = Array.from(
      document.querySelectorAll('[data-agent-id]')
    ).map(el => {
      const tag = el.tagName.toLowerCase();
      const cls = el.className || '';
      return {
        id:           el.dataset.agentId,
        tag,
        type:         el.getAttribute('type') || '',
        placeholder:  el.getAttribute('placeholder') || '',
        title:        el.getAttribute('title') || '',
        ariaLabel:    el.getAttribute('aria-label') || '',
        name:         el.getAttribute('name') || el.getAttribute('id') || '',
        href:         (el.getAttribute('href') || '').slice(0, 100),
        role:         el.getAttribute('role') || tag,
        value:        el.value || '',
        checked:      (el.type === 'checkbox' || el.type === 'radio') ? el.checked : null,
        text:         getElementText(el, tag, cls),
        disabled:     el.disabled || el.getAttribute('aria-disabled') === 'true',
        isTableRow:   tag === 'tr',
        isJsTreeToggle: tag === 'i' && cls.includes('jstree-ocl'),
        isJsTreeNode:   tag === 'a' && cls.includes('jstree-anchor'),
        isJqGridCheckbox: isJqGridCheckboxElement(el),
      };
    });

    // innerText는 브라우저 레이아웃을 기준으로 텍스트를 수집하므로
    // display:none / visibility:hidden 요소는 자동으로 제외된다.
    // textContent(클론 DOM)는 숨겨진 요소도 포함해 AI 검증 판단을 흔들 수 있다.
    const visibleText = (document.body.innerText || '')
      .replaceAll(/\s+/g, ' ').trim().slice(0, 1500);

    // 검증용: label-value 쌍 및 읽기 전용 필드값 추출
    // 시나리오에서 "X가 Y인지 확인" 같은 검증 시 AI가 실제값을 참조할 수 있도록 한다
    const fieldValues = [];

    // <label> + 연결된 input/select/textarea 값
    document.querySelectorAll('label').forEach(label => {
      const forId = label.getAttribute('for');
      const ctrl = forId
        ? document.getElementById(forId)
        : label.querySelector('input, select, textarea');
      if (!ctrl) return;
      const labelText = label.textContent.trim().replaceAll(/\s+/g, ' ');
      const val = ctrl.value ?? ctrl.textContent.trim();
      if (labelText && val !== undefined && val !== '') {
        fieldValues.push(`${labelText}: "${val}"`);
      }
    });

    // <th>/<td> 쌍 (상세 페이지의 key-value 테이블)
    document.querySelectorAll('tr').forEach(row => {
      const cells = row.querySelectorAll('th, td');
      if (cells.length === 2) {
        const key = cells[0].textContent.trim().replaceAll(/\s+/g, ' ');
        const val = cells[1].textContent.trim().replaceAll(/\s+/g, ' ');
        if (key && val) fieldValues.push(`${key}: "${val}"`);
      }
    });

    // [data-label] 또는 dl/dt+dd 패턴
    document.querySelectorAll('dl').forEach(dl => {
      const dts = dl.querySelectorAll('dt');
      dts.forEach(dt => {
        const dd = dt.nextElementSibling;
        if (dd?.tagName === 'DD') {
          const key = dt.textContent.trim().replaceAll(/\s+/g, ' ');
          const val = dd.textContent.trim().replaceAll(/\s+/g, ' ');
          if (key && val) fieldValues.push(`${key}: "${val}"`);
        }
      });
    });

    return {
      url: globalThis.location.href,
      title: document.title,
      elementCount: count,
      elements,
      visibleText,
      fieldValues: fieldValues.slice(0, 40),
    };
  }

  // ─── 액션 실행 ────────────────────────────────────

  function dispatchMouseEvents(el, events, coords) {
    events.forEach(name => {
      el.dispatchEvent(new MouseEvent(name, {
        bubbles: true, cancelable: true, ...coords,
      }));
    });
  }

  function clickJqGridRow(el) {
    const rect = el.getBoundingClientRect();
    const coords = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    dispatchMouseEvents(el, ['mousedown', 'mouseup', 'click'], coords);
    // fire click on first td as well for older jqGrid versions
    const firstTd = el.querySelector('td');
    if (firstTd) {
      const tdRect = firstTd.getBoundingClientRect();
      const tdCoords = { clientX: tdRect.left + tdRect.width / 2, clientY: tdRect.top + tdRect.height / 2 };
      firstTd.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...tdCoords }));
    }
  }

    function isJqGridCheckboxElement(el) {
      if (!el || el.tagName?.toLowerCase() !== 'input' || el.type !== 'checkbox') return false;
      if (!el.closest('tr.jqgrow')) return false;
      return !!el.closest('.ui-jqgrid');
    }

  // jqGrid 체크박스 셀 클릭 — 체크박스 input에 직접 click을 전달한다
  function clickJqGridCheckbox(el) {
    // el은 체크박스 input 자체
    const newChecked = !el.checked;
    el.checked = newChecked;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    // jqGrid API로도 선택 상태를 동기화한다
    const row = el.closest('tr');
    if (!row) return;
    const rowId = row.id;
    try {
      const gridEl = el.closest('.ui-jqgrid-bdiv')
        ?.closest('.ui-jqgrid')
        ?.querySelector('.ui-jqgrid-btable');
      if (gridEl && globalThis.$) {
        if (newChecked) {
          globalThis.$(gridEl).jqGrid('setSelection', rowId);
        } else {
          globalThis.$(gridEl).jqGrid('resetSelection', rowId);
        }
      }
    } catch { /* jqGrid API 없으면 직접 click으로만 처리 */ }
  }

  function clickJsTreeToggle(el) {
    const liNode = el.closest('li[role="treeitem"]');
    let apiUsed = false;
    try {
      const tree = globalThis.$?.jstree?.reference(el);
      if (tree && liNode) { tree.toggle_node(liNode); apiUsed = true; }
    } catch { /* jsTree API unavailable — fall back to direct click */ }
    if (!apiUsed) dispatchMouseEvents(el, ['mousedown', 'mouseup', 'click'], {});
  }

  function clickJsTreeNode(el) {
    const liNode = el.closest('li[role="treeitem"]');
    let apiUsed = false;
    try {
      const tree = globalThis.$?.jstree?.reference(el);
      if (tree && liNode) { tree.select_node(liNode); apiUsed = true; }
    } catch { /* jsTree API unavailable — fall back to direct click */ }
    if (!apiUsed) {
      el.click();
      dispatchMouseEvents(el, ['mousedown', 'mouseup', 'click'], {});
    }
  }

  function clickElement(el) {
    const tag = el.tagName.toLowerCase();
    const cls = el.className || '';
    if (tag === 'tr')                                 return clickJqGridRow(el);
    if (tag === 'i' && cls.includes('jstree-ocl'))   return clickJsTreeToggle(el);
    if (tag === 'a' && cls.includes('jstree-anchor')) return clickJsTreeNode(el);
    // jqGrid 체크박스: 실제 jqGrid 컨텍스트의 체크박스만 특수 처리
    if (isJqGridCheckboxElement(el))
      return clickJqGridCheckbox(el);

    // <a> 태그: el.click()은 페이지 핸들러 내부에서 javascript: URL을 실행하려 할 때
    // CSP 위반을 유발한다. 마우스 이벤트만 dispatch해 핸들러를 실행한다.
    // 실제 URL로의 이동은 SPA 라우터 또는 기본 click 동작이 처리하도록 맡긴다.
    if (tag === 'a') {
      dispatchMouseEvents(el, ['mousedown', 'mouseup', 'click'], {});
      return;
    }

    // el.click()이 click 이벤트를 발생시키므로 dispatchMouseEvents에는 포함하지 않는다.
    // 'click'을 중복 포함하면 토글 버튼(즐겨찾기 등)이 ON→OFF로 되돌아가는 문제가 생긴다.
    el.click();
    dispatchMouseEvents(el, ['mousedown', 'mouseup'], {});
  }

  function executeAction(action) {
    const selector = `[data-agent-id="${action.elementId}"]`;

    switch (action.type) {
      case 'click': {
        const el = document.querySelector(selector);
        if (!el) return { success: false, error: `element not found: ${action.elementId}` };
        showHighlight(el);
        setTimeout(hideHighlight, 1500);
        el.focus();
        clickElement(el);
        return { success: true };
      }

      case 'fill': {
        const el = document.querySelector(selector);
        if (!el) return { success: false, error: `element not found: ${action.elementId}` };

        showHighlight(el);
        setTimeout(hideHighlight, 1500);

        el.focus();

        // Native value setter for React compatibility
        // Use the matching prototype setter to avoid Illegal invocation
        // (e.g., calling HTMLInputElement setter on a textarea element).
        let nativeValueSetter = null;
        if (el instanceof globalThis.HTMLTextAreaElement) {
          nativeValueSetter = Object.getOwnPropertyDescriptor(
            globalThis.HTMLTextAreaElement.prototype, 'value'
          )?.set;
        } else if (el instanceof globalThis.HTMLInputElement) {
          nativeValueSetter = Object.getOwnPropertyDescriptor(
            globalThis.HTMLInputElement.prototype, 'value'
          )?.set;
        }

        if (nativeValueSetter) {
          nativeValueSetter.call(el, action.value || '');
        } else if ('value' in el) {
          el.value = action.value || '';
        } else {
          return { success: false, error: `fill not supported for element: ${action.elementId}` };
        }

        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));

        return { success: true };
      }

      case 'clear': {
        const el = document.querySelector(selector);
        if (!el) return { success: false, error: `element not found: ${action.elementId}` };
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return { success: true };
      }

      case 'select': {
        const el = document.querySelector(selector);
        if (!el) return { success: false, error: `element not found: ${action.elementId}` };
        el.value = action.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true };
      }

      default:
        return { success: false, error: `unknown action: ${action.type}` };
    }
  }

  // ─── 메시지 리스너 ────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      switch (message.type) {
        case 'PING':
          sendResponse({ alive: true });
          break;

        case 'GET_DOM':
          sendResponse({ success: true, data: getDOMState() });
          break;

        case 'INJECT_IDS': {
          const count = injectIds();
          sendResponse({ success: true, count });
          break;
        }

        case 'EXECUTE': {
          const result = executeAction(message.action);
          sendResponse(result);
          break;
        }

        case 'HIGHLIGHT': {
          const el = document.querySelector(`[data-agent-id="${message.elementId}"]`);
          if (el) {
            showHighlight(el);
            setTimeout(hideHighlight, 2000);
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'element not found' });
          }
          break;
        }

        case 'HIDE_HIGHLIGHT':
          hideHighlight();
          sendResponse({ success: true });
          break;

        case 'SCROLL_TO': {
          const el = document.querySelector(`[data-agent-id="${message.elementId}"]`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          sendResponse({ success: true });
          break;
        }

        default:
          sendResponse({ success: false, error: `unknown message type: ${message.type}` });
      }
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
    return true; // 비동기 응답 유지
  });

  console.log('[Page Agent] ✓ content script ready');
})();
