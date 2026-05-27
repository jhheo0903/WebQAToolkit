// sidepanel.js
'use strict';

let currentProvider = 'claude';
let loadedScenarios = [];    // 불러온 시나리오 목록
let selectedScenario = null; // 현재 선택된 시나리오
let lastLoadedFileText = null; // 마지막으로 읽은 파일 내용 (새로고침 폴백용)
let fileHandle = null;        // FileSystemFileHandle — 파일 재읽기(새로고침)용
let iframeOnlyMode = false;   // true면 서브 iframe DOM만 대상으로 동작
let stopRequested = false;
let isBatchRunning = false;

// 시나리오 인덱스 → 'pass' | 'fail' 결과 보존 (파일 재로드 전까지 유지)
const scenarioResults = new Map();

// ─── 초기화 ──────────────────────────────────────────

(async function init() {
  applyI18n();
  renderProviderTabs();
  await loadConfig();
  await updateTabInfo();

  // ── 실행 버튼 ──
  document.getElementById('runBtn').addEventListener('click', startAgent);
  document.getElementById('runAllBtn').addEventListener('click', startAllScenarios);
  document.getElementById('clearBtn').addEventListener('click', clearLog);
  document.getElementById('stopBtn').addEventListener('click', requestStopAgent);

  // ── 설정 저장 ──
  document.getElementById('saveBtn').addEventListener('click', saveProviderConfig);

  // iframe 전용 모드: 체크 즉시 전역 저장
  document.getElementById('iframeOnlyCheckbox').addEventListener('change', onIframeOnlyModeChange);

  // ── 파일 불러오기 / 새로고침 ──
  document.getElementById('loadBtn').addEventListener('click', openFileAndLoad);
  document.getElementById('jsonFileInput').addEventListener('change', loadScenariosFallback);
  document.getElementById('refreshKeepBtn').addEventListener('click', () => reloadScenarios(true));
  document.getElementById('refreshResetBtn').addEventListener('click', () => reloadScenarios(false));

  // ── 설정 오버레이 ──
  document.getElementById('settingsBtn').addEventListener('click', toggleSettings);
  document.addEventListener('click', (e) => {
    if (!e.target.isConnected) return; // 클릭 시 DOM에서 제거된 요소는 무시
    const overlay = document.getElementById('settingsOverlay');
    const btn = document.getElementById('settingsBtn');
    if (overlay && btn && !overlay.contains(e.target) && !btn.contains(e.target)) {
      closeSettings();
    }
  });

  // ── 탭 전환 ──
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // ── Ctrl+Enter 실행 ──
  document.getElementById('scenarioInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) startAgent();
  });

  // ── 브라우저 탭 변경 감지 ──
  chrome.tabs.onActivated.addListener(updateTabInfo);
  chrome.tabs.onUpdated.addListener((id, info) => {
    if (info.status === 'complete') updateTabInfo();
  });

  updateRunButtons();
})();

// ─── splitter (시나리오 목록 ↕ 실행 도크) ───────────

(function initSplitter() {
  const DOCK_MIN = 160;  // run-dock 최솟값 — textarea 1줄 + 버튼 여유
  const DOCK_MAX = 340;  // run-dock 최댓값 — 리스트가 너무 좁아지지 않도록
  const STORAGE_KEY = 'splitDockHeight';

  const handle = document.getElementById('splitHandle');
  const dock   = document.getElementById('runDock');

  function clamp(val) {
    return Math.min(Math.max(val, DOCK_MIN), DOCK_MAX);
  }

  // 저장된 높이 복원
  const saved = Number.parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
  if (saved >= DOCK_MIN) dock.style.height = `${clamp(saved)}px`;

  let dragging = false;
  let startY   = 0;
  let startH   = 0;

  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    startY   = e.clientY;
    startH   = dock.offsetHeight;
    handle.classList.add('dragging');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const delta = startY - e.clientY;
    dock.style.height = `${clamp(startH + delta)}px`;
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    localStorage.setItem(STORAGE_KEY, String(dock.offsetHeight));
  });
})();

// ─── i18n DOM 적용 ───────────────────────────────────

function applyI18n() {
  const { t } = globalThis.i18n;

  // data-i18n: textContent 교체
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (typeof t[key] === 'string') el.textContent = t[key];
  });

  // data-i18n-placeholder: placeholder 교체
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.dataset.i18nPlaceholder;
    if (typeof t[key] === 'string') el.placeholder = t[key];
  });

  // data-i18n-html: innerHTML 교체 (줄바꿈 포함 텍스트용)
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const key = el.dataset.i18nHtml;
    if (typeof t[key] === 'string') el.innerHTML = t[key].replaceAll('\n', '<br>');
  });

  // data-i18n-title: title 속성 교체 (툴팁 다국어 처리)
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.dataset.i18nTitle;
    if (typeof t[key] === 'string') el.title = t[key];
  });

  // settingsBtn title
  document.getElementById('settingsBtn').title = t.settingsTitle;
}

// ─── 설정 오버레이 ───────────────────────────────────

function toggleSettings() {
  const overlay = document.getElementById('settingsOverlay');
  const btn = document.getElementById('settingsBtn');
  const isOpen = overlay.classList.toggle('open');
  btn.classList.toggle('active', isOpen);
}

function closeSettings() {
  document.getElementById('settingsOverlay').classList.remove('open');
  document.getElementById('settingsBtn').classList.remove('active');
}

// ─── 탭 전환 ─────────────────────────────────────────

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === `pane${tab.charAt(0).toUpperCase() + tab.slice(1)}`);
  });
  // 로그 탭에서는 splitter 숨김 (run-dock도 숨김)
  document.getElementById('mainSplit').classList.toggle('log-active', tab === 'log');
  document.getElementById('runDock').style.display = tab === 'log' ? 'none' : '';
}

// ─── 시나리오 JSON 불러오기 (로컬 파일) ─────────────

function applyScenarioText(text, reset) {
  const { t } = globalThis.i18n;
  try {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : data.scenarios || [];
    if (list.length === 0) throw new Error(t.loadErrEmpty);

    if (reset) {
      scenarioResults.clear();
      deselectScenario();
    }
    loadedScenarios = list;
    renderScenarioList();
    setLoadStatus(t.loadOk(list.length), 'ok');
    document.getElementById('refreshKeepBtn').hidden = false;
    document.getElementById('refreshResetBtn').hidden = false;
  } catch (err) {
    setLoadStatus(t.loadErrParse(err.message), 'err');
    renderScenarioListEmpty(t.parseFail(err.message));
  }
}

// ── File System Access API 파일 열기 ─────────────────────
async function openFileAndLoad() {
  const { t } = globalThis.i18n;
  if (window.showOpenFilePicker) {
    try {
      [fileHandle] = await window.showOpenFilePicker({
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
        multiple: false,
      });
      await readFromFileHandle(true);
    } catch (err) {
      if (err.name !== 'AbortError') {
        setLoadStatus(`${t.loadErrRead}: ${err.message}`, 'err');
      }
    }
  } else {
    // 폴백: 숨겨진 input[type=file] 사용
    document.getElementById('jsonFileInput').click();
  }
}

async function readFromFileHandle(reset) {
  if (!fileHandle) return;
  const { t } = globalThis.i18n;
  try {
    const file = await fileHandle.getFile();
    document.getElementById('jsonPathInput').value = file.name;
    setLoadStatus('', '');
    const text = await file.text();
    lastLoadedFileText = text;
    applyScenarioText(text, reset);
  } catch (err) {
    setLoadStatus(t.loadErrRead, 'err');
    renderScenarioListEmpty(t.fileReadFail);
  }
}

async function reloadScenarios(keepResults) {
  if (fileHandle) {
    await readFromFileHandle(!keepResults);
  } else if (lastLoadedFileText) {
    applyScenarioText(lastLoadedFileText, !keepResults);
  }
}

// 폴백: input[type=file] 경유 로드 (showOpenFilePicker 미지원 환경)
function loadScenariosFallback(e) {
  const { t } = globalThis.i18n;
  const file = e.target.files?.[0];
  if (!file) return;

  fileHandle = null; // 파일 핸들 없음 — 새로고침 시 캐시 텍스트 사용
  document.getElementById('jsonPathInput').value = file.name;
  setLoadStatus('', '');

  const reader = new FileReader();
  reader.onload = ev => {
    lastLoadedFileText = ev.target.result;
    applyScenarioText(lastLoadedFileText, true);
  };
  reader.onerror = () => {
    setLoadStatus(t.loadErrRead, 'err');
    renderScenarioListEmpty(t.fileReadFail);
  };
  reader.readAsText(file, 'UTF-8');
  e.target.value = '';
}

function setLoadStatus(msg, type) {
  const el = document.getElementById('loadStatus');
  el.textContent = msg;
  el.className = `load-msg ${type}`;
}

// ─── 시나리오 목록 렌더링 ────────────────────────────

function renderScenarioList() {
  const { t } = globalThis.i18n;
  const container = document.getElementById('scenarioList');
  container.innerHTML = '';

  document.getElementById('scenarioCount').textContent = loadedScenarios.length;

  loadedScenarios.forEach((sc, idx) => {
    const item = document.createElement('div');
    item.dataset.idx = idx;

    const result = scenarioResults.get(idx);
    item.className = result ? `scenario-item sc-done-${result}` : 'scenario-item';

    const id = sc.id || `SC-${String(idx + 1).padStart(3, '0')}`;
    const title = sc.title || sc.name || `scenario ${idx + 1}`;
    const desc = sc.description || sc.scenario || '';
    let badge = '';
    if (result === 'pass')      badge = '<span class="sc-result-badge sc-result-pass">✓</span>';
    else if (result === 'fail') badge = '<span class="sc-result-badge sc-result-fail">✗</span>';

    item.innerHTML = `
      <span class="sc-id">${id}</span>
      <div class="sc-info">
        <div class="sc-title">${title}${badge}</div>
        <div class="sc-desc">${desc.slice(0, 60)}${desc.length > 60 ? '...' : ''}</div>
      </div>
      <button class="sc-run" data-idx="${idx}">${t.btnRun}</button>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('sc-run')) return;
      selectScenario(idx);
    });

    item.querySelector('.sc-run').addEventListener('click', (e) => {
      e.stopPropagation();
      forceSelectScenario(idx);
      startAgent();
    });

    container.appendChild(item);
  });
}

// ─── 시나리오 결과 마킹 ──────────────────────────────

// 실행 완료 후 해당 시나리오 아이템에 pass/fail 시각 표시
function markScenarioResult(pass) {
  const idx = loadedScenarios.indexOf(selectedScenario);
  if (idx === -1) return;

  const result = pass ? 'pass' : 'fail';
  scenarioResults.set(idx, result);

  const item = document.querySelector(`.scenario-item[data-idx="${idx}"]`);
  if (!item) return;

  item.classList.remove('sc-done-pass', 'sc-done-fail');
  item.classList.add(`sc-done-${result}`);

  const titleEl = item.querySelector('.sc-title');
  if (titleEl) {
    // 기존 배지 제거 후 재삽입
    titleEl.querySelectorAll('.sc-result-badge').forEach(el => el.remove());
    const badge = document.createElement('span');
    badge.className = `sc-result-badge sc-result-${result}`;
    badge.textContent = pass ? '✓' : '✗';
    titleEl.appendChild(badge);
  }
}

function renderScenarioListEmpty(msg) {
  document.getElementById('scenarioList').innerHTML =
    `<div class="scenario-empty">${msg}</div>`;
}

document.getElementById('scenarioList').addEventListener('click', (e) => {
  if (!e.target.closest('.scenario-item')) {
    deselectScenario();
  }
});

// ─── 시나리오 선택 ───────────────────────────────────

function forceSelectScenario(idx) {
  const sc = loadedScenarios[idx];
  if (!sc) return;
  selectedScenario = sc;

  document.querySelectorAll('.scenario-item').forEach(el => {
    el.classList.toggle('selected', parseInt(el.dataset.idx) === idx);
  });

  const scenarioText = sc.scenario || sc.description || sc.steps || '';
  document.getElementById('scenarioInput').value = scenarioText;

  const id = sc.id || `SC-${String(idx + 1).padStart(3, '0')}`;
  const title = sc.title || sc.name || scenarioText.slice(0, 30);
  document.getElementById('runSelected').innerHTML = `
    <span class="run-selected-badge">${id}</span>
    <span class="run-selected-title">${title}</span>
  `;
}

function selectScenario(idx) {
  const sc = loadedScenarios[idx];
  if (!sc) return;

  const alreadySelected = selectedScenario === sc;
  if (alreadySelected) {
    deselectScenario();
    return;
  }

  selectedScenario = sc;

  document.querySelectorAll('.scenario-item').forEach(el => {
    el.classList.toggle('selected', Number.parseInt(el.dataset.idx) === idx);
  });

  const scenarioText = sc.scenario || sc.description || sc.steps || '';
  document.getElementById('scenarioInput').value = scenarioText;

  const id = sc.id || `SC-${String(idx + 1).padStart(3, '0')}`;
  const title = sc.title || sc.name || scenarioText.slice(0, 30);
  document.getElementById('runSelected').innerHTML = `
    <span class="run-selected-badge">${id}</span>
    <span class="run-selected-title">${title}</span>
  `;
}

// ─── 선택 해제 ───────────────────────────────────────

function deselectScenario() {
  const { t } = globalThis.i18n;
  selectedScenario = null;
  document.querySelectorAll('.scenario-item').forEach(el => {
    el.classList.remove('selected');
  });
  document.getElementById('scenarioInput').value = '';
  document.getElementById('runSelected').innerHTML =
    `<span class="run-selected-empty">${t.noScenario}</span>`;
}

// ─── 탭 ID 가져오기 ──────────────────────────────────

async function getActiveTabId() {
  try {
    const { activeTabId } = await chrome.storage.session.get('activeTabId');
    if (activeTabId) {
      const tab = await chrome.tabs.get(activeTabId).catch(() => null);
      if (tab && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
        return activeTabId;
      }
    }
  } catch {
    // session storage unavailable — fall through to tab query
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && !tab.url?.startsWith('chrome://')) return tab.id;
  } catch {
    // query failed — try fallback
  }

  try {
    const tabs = await chrome.tabs.query({ active: true });
    const tab = tabs.find(t => t.url && !t.url.startsWith('chrome://'));
    return tab?.id || null;
  } catch {
    return null;
  }
}

// ─── 탭 통신 ─────────────────────────────────────────

async function pingTarget(tabId, frameId = 0) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'PING' }, { frameId });
    return res?.alive === true;
  } catch { return false; }
}

async function sendToTarget(tabId, message, frameId = 0) {
  const alive = await pingTarget(tabId, frameId);
  if (!alive) {
    try {
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ['content.js'] });
      await sleep(500);
    } catch (e) {
      const { t } = globalThis.i18n;
      throw new Error(t.errInjectFail(e.message));
    }
    if (!await pingTarget(tabId, frameId)) {
      const { t } = globalThis.i18n;
      throw new Error(t.errContentNoResp);
    }
  }
  return await chrome.tabs.sendMessage(tabId, message, { frameId });
}

// 기존 호출부와의 호환용 래퍼: 기본은 top frame
async function sendToTab(tabId, message) {
  return sendToTarget(tabId, message, 0);
}

async function readBestIframeDomState(t, tabId) {
  if (!chrome.webNavigation?.getAllFrames) {
    return { success: false, error: t.errIframeNoDom };
  }

  let frames = [];
  try {
    frames = await chrome.webNavigation.getAllFrames({ tabId });
  } catch {
    return { success: false, error: t.errIframeNoDom };
  }

  const childFrames = frames.filter(f => f.frameId !== 0);
  if (childFrames.length === 0) {
    return { success: false, error: t.errIframeNoDom };
  }

  let best = null;
  for (const frame of childFrames) {
    const resp = await sendToTarget(tabId, { type: 'GET_DOM' }, frame.frameId).catch(() => null);
    if (!resp?.success || !resp.data) continue;
    const count = resp.data.elementCount || 0;
    if (!best || count > best.count) {
      best = {
        frameId: frame.frameId,
        frameUrl: frame.url || resp.data.url,
        state: resp.data,
        count,
      };
    }
  }

  if (!best || best.count <= 0) {
    return { success: false, error: t.errIframeNoDom };
  }

  return {
    success: true,
    data: {
      ...best.state,
      frameId: best.frameId,
      frameUrl: best.frameUrl,
      isIframe: true,
    },
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    const fn = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(fn);
        setTimeout(resolve, 1000);
      }
    };
    chrome.tabs.onUpdated.addListener(fn);
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(fn); resolve(); }, 10000);
  });
}

// 클릭 후 탭 DOM이 안정될 때까지 대기
// - 탭 status가 complete로 바뀌면 즉시 완료 (전체 페이지 로드)
// - SPA 라우팅처럼 status 변화가 없으면 stableMs 동안 변화 없을 때 완료
// - maxMs 초과 시 강제 완료
async function waitForDomStable(tabId, { stableMs = 600, maxMs = 8000, frameId = 0 } = {}) {
  const deadline = Date.now() + maxMs;

  // 탭 status 변화 감지 (전통적인 페이지 이동)
  const tabLoadPromise = new Promise(resolve => {
    const fn = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(fn);
        resolve('tab-load');
      }
    };
    chrome.tabs.onUpdated.addListener(fn);
    // maxMs 후 자동 정리
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(fn); resolve('timeout'); }, maxMs);
  });

  // DOM 안정화 감지: content.js에 주기적으로 DOM 요소 수를 폴링해 변화가 없으면 안정됐다고 판단
  const stablePromise = (async () => {
    let prevCount = -1;
    let stableStart = 0;

    while (Date.now() < deadline) {
      if (stopRequested) return 'stopped';
      await sleep(200);
      try {
        const resp = await chrome.tabs.sendMessage(tabId, { type: 'PING' }, { frameId }).catch(() => null);
        if (!resp?.alive) continue;

        const domResp = await chrome.tabs.sendMessage(tabId, { type: 'INJECT_IDS' }, { frameId }).catch(() => null);
        const count = domResp?.count ?? -1;

        if (count !== prevCount) {
          prevCount = count;
          stableStart = Date.now();
        } else if (Date.now() - stableStart >= stableMs) {
          return 'stable';
        }
      } catch { break; }
    }
    return 'timeout';
  })();

  // 둘 중 먼저 완료되는 쪽 사용
  const reason = await Promise.race([tabLoadPromise, stablePromise]);

  // tab-load 완료면 추가 렌더링 여유시간
  if (reason === 'tab-load') await sleep(800);
  else await sleep(300);
}

// ─── 제공자 UI ───────────────────────────────────────

function renderProviderTabs() {
  const { PROVIDERS } = globalThis.AIProviders;
  const container = document.getElementById('providerTabs');
  container.innerHTML = '';

  Object.entries(PROVIDERS).forEach(([key, def]) => {
    const btn = document.createElement('button');
    btn.className = `provider-tab ${key === currentProvider ? 'active' : ''}`;
    btn.textContent = def.label;
    btn.dataset.provider = key;
    btn.addEventListener('click', () => selectProvider(key));
    container.appendChild(btn);
  });

  renderProviderFields();
}

function selectProvider(key) {
  currentProvider = key;
  document.querySelectorAll('.provider-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.provider === key);
  });
  renderProviderFields();
  loadFieldValues();
}

function renderProviderFields() {
  const { PROVIDERS } = globalThis.AIProviders;
  const def = PROVIDERS[currentProvider];
  const container = document.getElementById('providerFields');
  container.innerHTML = '';

  if (def.hasOAuthFlow) {
    renderGitHubCopilotSettings(container);
    return;
  }

  def.fields.forEach(field => {
    const row = document.createElement('div');
    row.className = 'field-row';

    const label = document.createElement('span');
    label.className = 'field-label';
    label.textContent = field.label;

    let input;
    if (field.type === 'select') {
      input = document.createElement('select');
      input.className = 'field-select';
      field.options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.value; o.textContent = opt.label;
        input.appendChild(o);
      });
    } else {
      input = document.createElement('input');
      input.type = field.type;
      input.className = 'field-input';
      input.placeholder = field.placeholder || '';
    }

    input.dataset.fieldKey = field.key;
    row.appendChild(label);
    row.appendChild(input);
    container.appendChild(row);
  });
}

// ─── GitHub Copilot 설정 UI ──────────────────────────

let _ghDeviceFlowActive = false;
let _ghDeviceFlowAbort  = false;

async function renderGitHubCopilotSettings(container) {
  const { t } = globalThis.i18n;
  const configs = (await chrome.storage.local.get('providerConfigs')).providerConfigs || {};
  const savedModel = configs.github_copilot?.model || '';
  const { githubCopilotAuth: auth } = await chrome.storage.local.get('githubCopilotAuth');

  const statusDiv = document.createElement('div');
  statusDiv.id = 'ghAuthStatus';
  statusDiv.className = 'gh-auth-status';
  container.appendChild(statusDiv);

  if (auth?.accessToken) {
    // ── 로그인 완료 상태 ──────────────────────────────
    statusDiv.innerHTML = `<span class="gh-logged-in-badge">✓ @${auth.username || 'GitHub 사용자'} ${t.ghLoggedIn}</span>`;

    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'btn-gh-logout';
    logoutBtn.textContent = t.ghLogout;
    logoutBtn.addEventListener('click', doGitHubLogout);
    statusDiv.appendChild(logoutBtn);

    // 모델 선택 (Copilot API에서 가져온 목록)
    const models = auth.models || [{ value: 'gpt-4o', label: 'GPT-4o' }];
    const modelRow = document.createElement('div');
    modelRow.className = 'field-row';
    const modelLabel = document.createElement('span');
    modelLabel.className = 'field-label';
    modelLabel.textContent = 'Model';
    const modelSelect = document.createElement('select');
    modelSelect.className = 'field-select';
    modelSelect.dataset.fieldKey = 'model';
    models.forEach(m => {
      const o = document.createElement('option');
      o.value = m.value; o.textContent = m.label;
      if (m.value === savedModel) o.selected = true;
      modelSelect.appendChild(o);
    });
    modelRow.appendChild(modelLabel);
    modelRow.appendChild(modelSelect);

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'btn-gh-copy';
    refreshBtn.title = t.ghRefreshModels;
    refreshBtn.textContent = '↻';
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.textContent = '…';
      refreshBtn.disabled = true;
      try {
        const { GithubCopilotAPI } = globalThis.AIProviders;
        const newModels = await GithubCopilotAPI.fetchModels(auth.sessionToken, auth.accessToken);
        const updated = { ...auth, models: newModels };
        await chrome.storage.local.set({ githubCopilotAuth: updated });
        renderProviderFields();
      } catch {
        refreshBtn.textContent = '↻';
        refreshBtn.disabled = false;
      }
    });
    modelRow.appendChild(refreshBtn);
    container.appendChild(modelRow);
  } else {
    // ── 미로그인 상태 ──────────────────────────────────
    const loginBtn = document.createElement('button');
    loginBtn.id = 'ghLoginBtn';
    loginBtn.className = 'btn-gh-login';
    loginBtn.textContent = t.ghLogin;
    loginBtn.addEventListener('click', () => startGitHubLogin(container));
    statusDiv.appendChild(loginBtn);
  }
}

async function startGitHubLogin(container) {
  const { t } = globalThis.i18n;
  const { GithubCopilotAPI } = globalThis.AIProviders;

  _ghDeviceFlowActive = true;
  _ghDeviceFlowAbort  = false;
  document.getElementById('ghLoginBtn')?.remove();

  let flow;
  try {
    showGhStatus(t.ghConnecting, 'info');
    flow = await GithubCopilotAPI.startDeviceFlow();
  } catch (e) {
    showGhStatus(`❌ ${e.message}`, 'error');
    _ghDeviceFlowActive = false;
    return;
  }

  renderDeviceCodeUI(container, flow);

  // 폴링
  let interval = flow.interval || 5;
  while (!_ghDeviceFlowAbort) {
    await new Promise(r => setTimeout(r, interval * 1000));
    if (_ghDeviceFlowAbort) break;

    let result;
    try {
      result = await GithubCopilotAPI.checkDeviceToken(flow.device_code);
    } catch { continue; }

    if (result.access_token) {
      await onGitHubLoginSuccess(result.access_token);
      return;
    }
    if (result.error === 'access_denied') { showGhStatus(`❌ ${t.ghDenied}`, 'error'); break; }
    if (result.error === 'expired_token') { showGhStatus(`❌ ${t.ghExpired}`, 'error'); break; }
    if (result.error === 'slow_down')     { interval += 5; }
    // authorization_pending → 계속 대기
  }

  _ghDeviceFlowActive = false;
}

function renderDeviceCodeUI(container, flow) {
  const { t } = globalThis.i18n;
  const statusDiv = document.getElementById('ghAuthStatus');
  statusDiv.innerHTML = '';

  const codeWrap = document.createElement('div');
  codeWrap.className = 'gh-device-code-wrap';

  const codeLabel = document.createElement('div');
  codeLabel.className = 'gh-device-code-label';
  codeLabel.textContent = t.ghDeviceCodeLabel;

  const codeRow = document.createElement('div');
  codeRow.className = 'gh-device-code-row';

  const codeVal = document.createElement('span');
  codeVal.className = 'gh-device-code-value';
  codeVal.textContent = flow.user_code;

  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn-gh-copy';
  copyBtn.textContent = t.ghCopy;
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(flow.user_code);
    copyBtn.textContent = '✓';
    setTimeout(() => { copyBtn.textContent = t.ghCopy; }, 1500);
  });

  const openBtn = document.createElement('button');
  openBtn.className = 'btn-gh-open';
  openBtn.textContent = t.ghOpenDevice;
  openBtn.addEventListener('click', () => chrome.tabs.create({ url: flow.verification_uri }));

  const spinner = document.createElement('div');
  spinner.className = 'gh-spinner';
  spinner.textContent = t.ghWaiting;

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-gh-cancel';
  cancelBtn.textContent = t.ghCancel;
  cancelBtn.addEventListener('click', () => {
    _ghDeviceFlowAbort = true;
    renderProviderFields();
  });

  codeRow.appendChild(codeVal);
  codeRow.appendChild(copyBtn);
  codeWrap.appendChild(codeLabel);
  codeWrap.appendChild(codeRow);
  codeWrap.appendChild(openBtn);
  codeWrap.appendChild(spinner);
  codeWrap.appendChild(cancelBtn);
  statusDiv.appendChild(codeWrap);
}

async function onGitHubLoginSuccess(accessToken) {
  const { t } = globalThis.i18n;
  const { GithubCopilotAPI } = globalThis.AIProviders;

  try {
    showGhStatus(t.ghFetchingToken, 'info');
    // getCopilotSessionToken이 null을 반환하면 GitHub Models API 모드로 동작
    const sessionResult = await GithubCopilotAPI.getCopilotSessionToken(accessToken);
    const sessionToken  = sessionResult?.token    || null;
    const sessionExpiry = sessionResult?.expiresAt || 0;

    const username = await GithubCopilotAPI.getUsername(accessToken);
    showGhStatus(t.ghFetchingModels, 'info');
    const models = await GithubCopilotAPI.fetchModels(sessionToken, accessToken);

    await chrome.storage.local.set({
      githubCopilotAuth: { accessToken, username, sessionToken, sessionExpiry, models },
    });

    _ghDeviceFlowActive = false;
    renderProviderFields();
  } catch (e) {
    showGhStatus(`❌ ${e.message}`, 'error');
    _ghDeviceFlowActive = false;
  }
}

async function doGitHubLogout() {
  await chrome.storage.local.remove('githubCopilotAuth');
  renderProviderFields();
}

function showGhStatus(msg, type = 'info') {
  const el = document.getElementById('ghAuthStatus');
  if (!el) return;
  const span = el.querySelector('.gh-status-msg') || (() => {
    const s = document.createElement('div');
    s.className = 'gh-status-msg';
    el.appendChild(s);
    return s;
  })();
  span.textContent = msg;
  span.className = `gh-status-msg gh-status-${type}`;
}

// ─── 설정 저장/로드 ──────────────────────────────────

async function loadConfig() {
  const result = await chrome.storage.local.get(['selectedProvider', 'providerConfigs', 'agentOptions']);
  if (result.selectedProvider) currentProvider = result.selectedProvider;
  iframeOnlyMode = result.agentOptions?.iframeOnlyMode === true;
  renderProviderTabs();
  loadFieldValues(result.providerConfigs);
  const iframeOnlyCheckbox = document.getElementById('iframeOnlyCheckbox');
  if (iframeOnlyCheckbox) iframeOnlyCheckbox.checked = iframeOnlyMode;
}

function loadFieldValues(configs) {
  if (!configs) {
    chrome.storage.local.get('providerConfigs').then(r => loadFieldValues(r.providerConfigs));
    return;
  }
  const config = configs?.[currentProvider] || {};
  document.querySelectorAll('[data-field-key]').forEach(el => {
    const val = config[el.dataset.fieldKey];
    if (val !== undefined) el.value = val;
  });
}

async function saveProviderConfig() {
  const { t } = globalThis.i18n;
  const result = await chrome.storage.local.get('providerConfigs');
  const all = result.providerConfigs || {};
  const config = {};
  document.querySelectorAll('[data-field-key]').forEach(el => {
    config[el.dataset.fieldKey] = el.value.trim();
  });
  const iframeOnlyCheckbox = document.getElementById('iframeOnlyCheckbox');
  iframeOnlyMode = iframeOnlyCheckbox?.checked === true;
  all[currentProvider] = config;
  await chrome.storage.local.set({
    providerConfigs: all,
    selectedProvider: currentProvider,
    agentOptions: { iframeOnlyMode },
  });

  const status = document.getElementById('saveStatus');
  status.textContent = t.saveOk;
  status.className = 'save-status ok';
  setTimeout(() => { status.textContent = ''; }, 2000);
}

function getCurrentConfig() {
  const config = {};
  document.querySelectorAll('[data-field-key]').forEach(el => {
    config[el.dataset.fieldKey] = el.value.trim();
  });
  return config;
}

function isIframeOnlyModeEnabled() {
  const iframeOnlyCheckbox = document.getElementById('iframeOnlyCheckbox');
  if (iframeOnlyCheckbox) return iframeOnlyCheckbox.checked === true;
  return iframeOnlyMode;
}

async function onIframeOnlyModeChange(e) {
  iframeOnlyMode = e.target.checked === true;
  const result = await chrome.storage.local.get('agentOptions');
  const prev = result.agentOptions || {};
  await chrome.storage.local.set({
    agentOptions: {
      ...prev,
      iframeOnlyMode,
    },
  });
}

// ─── 탭 정보 ─────────────────────────────────────────

async function updateTabInfo() {
  try {
    const tabId = await getActiveTabId();
    if (tabId) {
      const tab = await chrome.tabs.get(tabId);
      const url = new URL(tab.url);
      document.getElementById('tabInfo').textContent = url.hostname;
    }
  } catch (e) {}
}

// ─── 로그 ────────────────────────────────────────────

let isFirstLog = true;

function clearLog() {
  const { t } = globalThis.i18n;
  document.getElementById('logBody').innerHTML = `
    <div class="log-empty">
      <div class="log-empty-icon">◈</div>
      <div>${t.logEmptyDesc.replaceAll('\n', '<br>')}</div>
    </div>`;
  document.getElementById('logCount').textContent = '0';
  isFirstLog = true;
}

function appendLog(html) {
  const body = document.getElementById('logBody');
  if (isFirstLog) { body.innerHTML = ''; isFirstLog = false; }
  const div = document.createElement('div');
  div.innerHTML = html;
  body.appendChild(div.firstChild || div);
  body.scrollTop = body.scrollHeight;

  const count = body.querySelectorAll('.log-step, .log-info, .log-error, .log-warn, .result-card').length;
  document.getElementById('logCount').textContent = count;
}

function showThinking(step) {
  const { t } = globalThis.i18n;
  removeThinking();
  const div = document.createElement('div');
  div.className = 'log-thinking'; div.id = 'thinkingNode';
  div.innerHTML = `<div class="dots"><span></span><span></span><span></span></div>
    <span class="thinking-txt">${t.infoThinking(step)}</span>`;
  const body = document.getElementById('logBody');
  if (isFirstLog) { body.innerHTML = ''; isFirstLog = false; }
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
}

function removeThinking() { document.getElementById('thinkingNode')?.remove(); }

// ─── 에이전트 상태 ───────────────────────────────────

let isRunning = false;
let startTime = null;

function updateRunButtons() {
  const { t } = globalThis.i18n;
  const runBtn = document.getElementById('runBtn');
  const runAllBtn = document.getElementById('runAllBtn');

  if (runBtn && !isRunning) runBtn.innerHTML = t.btnAgentRun;

  if (runAllBtn) {
    runAllBtn.disabled = isRunning || isBatchRunning;
    runAllBtn.textContent = isBatchRunning ? t.btnRunningAll : t.btnRunAll;
  }
}

function setRunning(running) {
  const { t } = globalThis.i18n;
  isRunning = running;
  const btn = document.getElementById('runBtn');
  const dot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const stopBtn = document.getElementById('stopBtn');
  if (running) {
    btn.disabled = true;
    btn.innerHTML = `<div class="spinner"></div> ${t.btnRunning}`;
    stopBtn.hidden = false;
    dot.className = 'status-indicator running';
    statusText.textContent = 'running';
    document.body.classList.add('agent-running');
    switchTab('log');
    startTime = Date.now();
  } else {
    btn.disabled = false;
    btn.innerHTML = t.btnAgentRun;
    stopBtn.hidden = true;
    statusText.textContent = '';
    document.body.classList.remove('agent-running');
  }

  updateRunButtons();
}

function setBatchRunning(running) {
  isBatchRunning = running;
  updateRunButtons();
}

function requestStopAgent() {
  if (!isRunning || stopRequested) return;
  const { t } = globalThis.i18n;
  stopRequested = true;
  appendLog(`<div class="log-warn">${t.infoStopRequested}</div>`);
}

// ─── 프롬프트 ────────────────────────────────────────

// [토큰 절약 — 엘리먼트 직렬화 압축]
// 엘리먼트당 text / ariaLabel / placeholder / name / value 중 가장 의미 있는
// 레이블 하나만 선택하고 나머지 중복 속성을 생략한다.
// 기존 방식은 모든 속성을 나열해 엘리먼트 수가 많을수록 입력 토큰이 크게 늘었다.
function serializeElement(el) {
  // 우선순위: text > ariaLabel > title > placeholder > name > value
  const label = el.text || el.ariaLabel || el.title || el.placeholder || el.name || el.value || '';

  let line = `  [${el.id}] <${el.tag}${el.type ? ':' + el.type : ''}>`;

  if (el.isTableRow)        line += ' [table-row-clickable]';
  if (el.isJsTreeToggle)    line += ' [tree-toggle-btn]';
  if (el.isJsTreeNode)      line += ' [tree-node-select]';
  if (el.isJqGridCheckbox)  line += ` [jqgrid-checkbox checked=${el.checked}]`;
  else if (el.checked !== null) line += ` checked=${el.checked}`;

  if (label)                line += ` "${label.slice(0, 120)}"`;
  // 현재 입력값은 레이블과 다를 때만 추가 (중복 방지)
  if (el.value && el.value !== label) line += ` =${el.value.slice(0, 30)}`;
  if (el.href && !el.href.startsWith('#')) line += ` →${el.href.slice(0, 40)}`;

  return line;
}

// [토큰 절약 — 히스토리 압축]
// 스텝이 쌓일수록 히스토리 전체를 매번 전송해 토큰이 누적 증가하는 문제를 완화한다.
// 최근 HISTORY_RECENT 개 스텝은 AI 판단에 필요한 thinking까지 유지하고,
// 그보다 오래된 스텝은 액션과 URL 변화만 남겨 간략히 전달한다.
const HISTORY_RECENT = 1;

function serializeHistory(history) {
  if (history.length === 0) return '  none';

  const olderSteps = history.slice(0, -HISTORY_RECENT); // 압축 대상, 뒤에서 HISTORY_RECENT개 제외
  const recentSteps = history.slice(-HISTORY_RECENT);   // 상세 유지

  const lines = [];

  // 오래된 스텝: 액션 종류와 URL 변화만 (thinking 생략)
  olderSteps.forEach((h, i) => {
    const a = h.action;
    let s;
    if      (a.type === 'click')    s = `click(${a.elementId})`;
    else if (a.type === 'fill')     s = `fill(${a.elementId},"${(a.value || '').slice(0, 20)}")`;
    else if (a.type === 'navigate') s = `navigate(${a.url})`;
    else if (a.type === 'wait')     s = `wait(${a.ms}ms)`;
    else                            s = 'done';
    const urlChange = (h.urlAfter && h.urlAfter !== h.url)
      ? ` [url→${h.urlAfter.slice(0, 40)}]` : '';
    lines.push(`  ${i + 1}. ${s}${urlChange}`);
  });

  // 최근 스텝: 기존 상세 형식 유지 (thinking 포함)
  const offset = olderSteps.length;
  recentSteps.forEach((h, i) => {
    const a = h.action;
    let s;
    if      (a.type === 'click')    s = `click(${a.elementId})`;
    else if (a.type === 'fill')     s = `fill(${a.elementId},"${a.value}")`;
    else if (a.type === 'navigate') s = `navigate(${a.url})`;
    else if (a.type === 'wait')     s = `wait(${a.ms}ms)`;
    else                            s = 'done';
    // urlAfter: 해당 액션 실행 후 다음 스텝에서 읽힌 실제 URL
    const urlChange = (h.urlAfter && h.urlAfter !== h.url)
      ? ` [url-changed→${h.urlAfter.slice(0, 60)}]` : '';
    lines.push(`  ${offset + i + 1}. ${s}${urlChange} — ${h.thinking.slice(0, 60)}`);
  });

  return lines.join('\n');
}

function buildPrompt(state, scenario, history) {
  debugger;
  const elemText = state.elements.length === 0
    ? '  (no interactable elements)'
    : state.elements.map(serializeElement).join('\n');

  const histText = serializeHistory(history);

  const fieldValuesText = state.fieldValues?.length
    ? state.fieldValues.join('\n')
    : '  (none detected)';

  return `You are a web browser test agent.
Analyze the current page and decide the next single action to achieve the test scenario.

[CURRENT PAGE]
URL: ${state.url}
Title: ${state.title}
Body: ${state.visibleText.slice(0, 600)}

[FRAME CONTEXT]
Scope: ${state.isIframe ? 'iframe-only' : 'top-document'}
Frame URL: ${state.frameUrl || state.url}

[PAGE FIELD VALUES — label/key: "actual value" pairs extracted from the page]
${fieldValuesText}

[INTERACTABLE ELEMENTS (${state.elements.length})]
${elemText}

[TEST SCENARIO]
${scenario}

[PREVIOUS ACTIONS]
${histText}

[TABLE/GRID RULES]
- <tr> elements marked [table-row-clickable] are clickable data rows
- Row text is formatted as "col1 | col2 | col3"
- To click a specific row, use the tr ID that contains the matching text
- After search/filter triggers AJAX reload, use wait(2000) before re-reading DOM
- [jqgrid-checkbox checked=false/true] = checkbox in a jqGrid row; click it to select/deselect that row
- To check a jqGrid row checkbox: click the [jqgrid-checkbox] element whose row text matches the target row

[CHECKBOX RULES]
- If the scenario says "checkbox" or "체크박스", prefer <input:checkbox> elements first
- For checkbox scenarios, do NOT click <a> links unless the scenario explicitly asks to open/click a link
- When multiple checkboxes exist in a table, match by the row text/name closest to the checkbox

[jsTree RULES]
- [tree-toggle-btn] = toggle button to expand/collapse a node → use click
- [tree-node-select] = node text click → selects the item
- Node text format: [treenode(-selected)-open/leaf/closed] nodeName
- To expand a node: click its [tree-toggle-btn] ID
- To select a node: click its [tree-node-select] ID
- To see children of a closed node: click [tree-toggle-btn] → wait(1000) → re-read DOM
- [toggle-leaf] nodes have no children and cannot be expanded

[VERIFICATION RULES — for scenarios that check/confirm a value]
- If the scenario asks to verify/confirm/check a value (e.g. "confirm email is X"):
  1. Find the expected value in the scenario text
  2. Find the actual value in [PAGE FIELD VALUES] or [Body]
  3. If actual matches expected → done(pass:true, reason:"Expected '<expected>' — actual value is '<actual>'")
  4. If actual does NOT match → done(pass:false, reason:"Expected '<expected>' — actual value is '<actual>'")
  5. If the value cannot be found on the page → done(pass:false, reason:"Could not find '<field name>' on the page")
- Always quote both expected and actual values in the reason so the mismatch is explicit

[COMPLETION RULES — MUST FOLLOW]
1. If the PREVIOUS ACTIONS history shows [url-changed→...] after a click/fill → the action already succeeded → done(pass:true) immediately, do NOT repeat the action
2. If URL changed and the new URL is relevant to the scenario goal → done(pass:true)
3. Search scenario: after filling + submitting search and results page appears → done(pass:true)
4. If a fill+click already caused a page change → done(pass:true)
5. If the same action repeats 2+ times → done(pass:false, reason:"duplicate action")
6. If the current URL contains the scenario keyword → done(pass:true)

Respond ONLY in the following JSON format (no markdown):
{
  "thinking": "Brief analysis of current state and reason for next action (1-2 sentences)",
  "action": {
    "type": "click | fill | navigate | wait | done",
    "elementId": "el-XXX (for click/fill)",
    "value": "input value (for fill)",
    "url": "URL (for navigate)",
    "ms": milliseconds (for wait),
    "pass": true/false (for done),
    "reason": "REQUIRED for done — for verification: always include both expected and actual value (e.g. Expected 'jhheo0903@example.com' — actual value is 'other@example.com')"
  }
}`;
}

// ─── 에이전트 시작 전 유효성 검사 ───────────────────

async function validateAgentConfig(t, config) {
  if (!globalThis.AIProviders) {
    appendLog(`<div class="log-error">${t.errProviders}</div>`);
    return false;
  }
  if (currentProvider === 'claude' && !config.apiKey) {
    appendLog(`<div class="log-error">${t.errApiKeyClaude}</div>`);
    return false;
  }
  if (currentProvider === 'azure_openai' && (!config.apiKey || !config.endpoint || !config.deployment)) {
    appendLog(`<div class="log-error">${t.errApiKeyAzure}</div>`);
    return false;
  }
  if (currentProvider === 'openai' && !config.apiKey) {
    appendLog(`<div class="log-error">${t.errApiKeyOpenAI}</div>`);
    return false;
  }
  if (currentProvider === 'github_copilot') {
    const { githubCopilotAuth: auth } = await chrome.storage.local.get('githubCopilotAuth');
    if (!auth?.accessToken) {
      appendLog(`<div class="log-error">${t.errGitHubNotLoggedIn}</div>`);
      return false;
    }
  }
  return true;
}

// ─── 액션 문자열 변환 ────────────────────────────────

function elLabel(elementId, elements) {
  const el = elements?.find(e => e.id === elementId);
  if (!el) return elementId;
  const raw = el.text || el.ariaLabel || el.placeholder || el.name || elementId;
  return `"${raw.slice(0, 30)}"`;
}

function actionToString(a, elements) {
  if (a.type === 'click')    return `click ${elLabel(a.elementId, elements)}`;
  if (a.type === 'fill')     return `fill ${elLabel(a.elementId, elements)} ← "${(a.value || '').slice(0, 20)}"`;
  if (a.type === 'navigate') return `navigate → ${(a.url || '').slice(0, 40)}`;
  if (a.type === 'wait')     return `wait ${a.ms ?? ''}ms`;
  return `done → ${a.pass ? 'PASS' : 'FAIL'}`;
}

// ─── 결과 카드 출력 ──────────────────────────────────

function appendResultCard(t, pass, reason, step, providerLabel) {
  const cls = pass ? 'pass' : 'fail';
  const title = pass ? t.resultPass : t.resultFail;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const displayReason = reason || (pass ? 'Scenario completed.' : 'No reason provided.');
  appendLog(`
    <div class="result-card ${cls}">
      <div class="result-title ${cls}">${title}</div>
      <div class="result-reason ${cls}">${displayReason}</div>
      <div class="result-meta">${t.resultMeta(step, elapsed, providerLabel)}</div>
    </div>`);
  document.getElementById('statusDot').className = `status-indicator ${cls}`;
  markScenarioResult(pass);
}

// ─── 중복 액션 감지 ──────────────────────────────────

function detectDuplicate(t, history, a, step, providerLabel) {
  const repeatable = a.type !== 'done' && a.type !== 'wait' && a.type !== 'navigate';
  if (!repeatable) return false;

  const dupes = history.filter(h =>
    h.action.type === a.type &&
    h.action.elementId === a.elementId &&
    h.action.value === a.value
  );
  if (dupes.length < 2) return false;

  appendLog(`<div class="log-warn">${t.warnDuplicate}</div>`);
  appendResultCard(t, false, t.resultDuplicate, step, providerLabel);
  return true;
}

function resolveStepTerminalStatus(t, history, a, step, providerLabel) {
  if (detectDuplicate(t, history, a, step, providerLabel)) {
    return 'fail';
  }

  if (a.type === 'done') {
    appendResultCard(t, a.pass, a.reason, step, providerLabel);
    return a.pass ? 'pass' : 'fail';
  }

  return null;
}

// ─── 단일 스텝 DOM 읽기 + AI 호출 ───────────────────

async function runStep(t, tabId, config, scenario, history, step, providerLabel) {
  debugger;
  showThinking(step);

  let domResp;
  try {
    domResp = await fetchStepDomState(t, tabId);
  } catch (e) {
    removeThinking();
    appendLog(`<div class="log-error">${t.errDomFail(e.message)}</div>`);
    return null;
  }

  if (!domResp?.success) {
    removeThinking();
    appendLog(`<div class="log-error">${domResp?.error || t.errDomResp}</div>`);
    return null;
  }

  const state = domResp.data;
  if (state.isIframe) {
    appendLog(`<div class="log-info">${t.infoIframeTarget((state.frameUrl || '').slice(0, 70), state.elementCount || 0)}</div>`);
  }
  await updateTabInfo();

  // 직전 액션 실행 후 URL이 바뀌었으면 urlAfter를 업데이트한다.
  // buildPrompt 호출 전에 반영해야 AI가 "이미 URL이 바뀌었다"는 것을 인식한다.
  if (history.length > 0 && history.at(-1).urlAfter === null) {
    history.at(-1).urlAfter = state.url;
  }

  const prevUrl = history.length > 0 ? history.at(-1).url : null;
  if (prevUrl && prevUrl !== state.url) {
    appendLog(`<div class="log-info">${t.infoUrlChange(prevUrl.slice(0, 50), state.url.slice(0, 50))}</div>`);
  }

  let result, usage;
  try {
    const { callAI } = globalThis.AIProviders;
    ({ result, usage } = await callAI(currentProvider, config, buildPrompt(state, scenario, history)));
  } catch (e) {
    removeThinking();
    appendLog(`<div class="log-error">${t.errAI(providerLabel, e.message)}</div>`);
    return null;
  }

  removeThinking();
  if (usage && (usage.input || usage.output)) {
    appendLog(`<div class="log-tokens">↑ ${usage.input.toLocaleString()} · ↓ ${usage.output.toLocaleString()} tokens</div>`);
  }
  return { state, parsed: result };
}

async function fetchStepDomState(t, tabId) {
  if (isIframeOnlyModeEnabled()) {
    return readBestIframeDomState(t, tabId);
  }

  const domResp = await sendToTarget(tabId, { type: 'GET_DOM' }, 0);
  if (domResp?.success && domResp.data) {
    domResp.data.frameId = 0;
    domResp.data.frameUrl = domResp.data.url;
    domResp.data.isIframe = false;
  }
  return domResp;
}

// ─── 단일 스텝 액션 실행 ─────────────────────────────

async function executeStep(t, tabId, a, frameId = 0) {
  try {
    if (a.type === 'click') {
      await sendToTarget(tabId, { type: 'HIGHLIGHT', elementId: a.elementId }, frameId);
      await sleepWithStop(350);
      if (stopRequested) return;
      const r = await sendToTarget(tabId, { type: 'EXECUTE', action: a }, frameId);
      if (!r?.success) appendLog(`<div class="log-warn">${t.warnClickFail(r?.error)}</div>`);
      // 고정 sleep 대신 DOM 안정화까지 대기 — 페이지 로딩이 느린 경우 다음 스텝 오동작 방지
      await waitForDomStable(tabId, { frameId });
    } else if (a.type === 'fill') {
      await sendToTarget(tabId, { type: 'HIGHLIGHT', elementId: a.elementId }, frameId);
      await sleepWithStop(250);
      if (stopRequested) return;
      const r = await sendToTarget(tabId, { type: 'EXECUTE', action: a }, frameId);
      if (!r?.success) appendLog(`<div class="log-warn">${t.warnFillFail(r?.error)}</div>`);
      await sleepWithStop(400);
    } else if (a.type === 'navigate') {
      appendLog(`<div class="log-info">${t.infoNavigate(a.url)}</div>`);
      await chrome.tabs.update(tabId, { url: a.url });
      await waitForTabLoad(tabId);
      await sleepWithStop(500);
    } else if (a.type === 'wait') {
      appendLog(`<div class="log-info">${t.infoWait(a.ms)}</div>`);
      await sleepWithStop(a.ms || 2000);
    }
  } catch (e) {
    appendLog(`<div class="log-warn">${t.warnActionErr(e.message)}</div>`);
    await sleep(500);
  }
}

// ─── 스텝 로그 카드 출력 ────────────────────────────

function appendStepLog(step, a, thinking, providerLabel, elements) {
  // done 스텝은 reason이 핵심 정보이므로 기본 열림, 나머지는 기본 접힘
  const isDone = a.type === 'done';
  const reasonHtml = isDone && a.reason
    ? `<div class="log-step-reason">⚑ ${a.reason}</div>`
    : '';

  const card = document.createElement('div');
  card.className = isDone ? 'log-step' : 'log-step collapsed';
  card.innerHTML = `
    <div class="log-step-head" role="button" tabindex="0">
      <span class="badge-step">STEP ${step}</span>
      <span class="badge-action">${actionToString(a, elements)}</span>
      <span class="badge-provider">${providerLabel}</span>
      <span class="badge-toggle">▾</span>
    </div>
    <div class="log-step-body">
      <div class="log-step-thinking">${thinking}</div>
      ${reasonHtml}
    </div>`;

  // inline onclick 대신 addEventListener 사용 (MV3 CSP 준수)
  card.querySelector('.log-step-head').addEventListener('click', () => {
    card.classList.toggle('collapsed');
  });

  const body = document.getElementById('logBody');
  if (isFirstLog) { body.innerHTML = ''; isFirstLog = false; }
  body.appendChild(card);
  body.scrollTop = body.scrollHeight;

  const count = body.querySelectorAll('.log-step, .log-info, .log-error, .log-warn, .result-card').length;
  document.getElementById('logCount').textContent = count;
}

// ─── 에이전트 루프 본체 ──────────────────────────────

async function runAgentLoop(t, tabId, config, scenario, providerLabel) {
  const history = [];
  const MAX_STEPS = 20;
  let status = 'incomplete';

  for (let step = 1; step <= MAX_STEPS; step++) {
    if (stopRequested) break;

    const result = await runStep(t, tabId, config, scenario, history, step, providerLabel);
    if (!result) break;

    if (stopRequested) break;

    const { state, parsed } = result;
    const a = parsed.action;

    appendStepLog(step, a, parsed.thinking, providerLabel, state.elements);
    history.push({ step, thinking: parsed.thinking, action: a, url: state.url, urlAfter: null, frameId: state.frameId ?? 0 });

    const terminalStatus = resolveStepTerminalStatus(t, history, a, step, providerLabel);
    if (terminalStatus) {
      status = terminalStatus;
      break;
    }

    await executeStep(t, tabId, a, state.frameId ?? 0);
  }

  if (stopRequested && status === 'incomplete') {
    status = 'stopped';
  }

  return status;
}

// ─── 메인 에이전트 루프 ──────────────────────────────

async function startAgent(options = {}) {
  if (isRunning) return 'busy';
  const { t } = globalThis.i18n;
  stopRequested = false;

  if (options.switchToLog !== false) switchTab('log');

  const scenario = (options.scenarioText ?? document.getElementById('scenarioInput').value).trim();
  if (!scenario) {
    appendLog(`<div class="log-warn">${t.warnNoScenario}</div>`);
    return 'incomplete';
  }

  const config = getCurrentConfig();
  if (!await validateAgentConfig(t, config)) return 'incomplete';

  const { PROVIDERS } = globalThis.AIProviders;
  const providerLabel = PROVIDERS[currentProvider]?.label || currentProvider;

  const tabId = await getActiveTabId();
  if (!tabId) {
    appendLog(`<div class="log-error">${t.errNoTab}</div>`);
    return 'error';
  }

  if (options.clearLog !== false) clearLog();
  setRunning(true);

  const headerScenario = options.scenarioMeta ?? selectedScenario;
  const headerInfo = headerScenario?.id
    ? `${headerScenario.id} · ${headerScenario.title ?? ''} · `
    : '';
  appendLog(`<div class="log-info">${t.infoStart(headerInfo, providerLabel, tabId)}</div>`);

  let status = 'incomplete';
  try {
    status = await runAgentLoop(t, tabId, config, scenario, providerLabel);
  } catch (e) {
    removeThinking();
    appendLog(`<div class="log-error">${t.errFatal(e.message)}</div>`);
    status = 'error';
  }

  setRunning(false);
  return status;
}

async function startAllScenarios() {
  if (isRunning || isBatchRunning) return;

  const { t } = globalThis.i18n;
  if (loadedScenarios.length === 0) {
    appendLog(`<div class="log-warn">${t.warnNoScenariosLoaded}</div>`);
    return;
  }

  switchTab('log');
  clearLog();
  stopRequested = false;
  setBatchRunning(true);

  let passCount = 0;
  let failCount = 0;
  let skipCount = 0;

  appendLog(`<div class="log-info">${t.infoBatchStart(loadedScenarios.length)}</div>`);

  try {
    for (let idx = 0; idx < loadedScenarios.length; idx++) {
      if (stopRequested) break;

      const sc = loadedScenarios[idx];
      const scenarioText = (sc.scenario || sc.description || sc.steps || '').trim();
      const id = sc.id || `SC-${String(idx + 1).padStart(3, '0')}`;
      const title = sc.title || sc.name || scenarioText.slice(0, 30) || `scenario ${idx + 1}`;

      if (!scenarioText) {
        skipCount++;
        appendLog(`<div class="log-warn">${t.warnScenarioSkipped(id)}</div>`);
        continue;
      }

      forceSelectScenario(idx);
      appendLog(`<div class="log-info">${t.infoBatchProgress(idx + 1, loadedScenarios.length, id, title)}</div>`);

      const status = await startAgent({
        scenarioText,
        scenarioMeta: sc,
        clearLog: false,
        switchToLog: false,
      });

      if (status === 'pass') {
        passCount++;
      } else if (status === 'stopped') {
        break;
      } else {
        failCount++;
      }
    }

    if (stopRequested) {
      appendLog(`<div class="log-warn">${t.infoBatchStopped(passCount, failCount, skipCount)}</div>`);
      return;
    }

    const cls = failCount === 0 ? 'pass' : 'fail';
    const title = failCount === 0 ? t.resultPass : t.resultFail;
    appendLog(`
      <div class="result-card ${cls}">
        <div class="result-title ${cls}">${title}</div>
        <div class="result-reason ${cls}">${t.infoBatchDone(passCount, failCount, skipCount, loadedScenarios.length)}</div>
      </div>`);
  } finally {
    setBatchRunning(false);
  }
}

async function sleepWithStop(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (stopRequested) return;
    const remain = end - Date.now();
    await sleep(Math.min(remain, 120));
  }
}
