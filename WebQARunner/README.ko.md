# WebQA Runner

DOM 상태를 분석하고 AI가 각 단계를 결정하며 시나리오별 최종 스크린샷을 캡처하는 백그라운드 E2E 테스트 자동화 도구입니다. 윈도우 작업 스케줄러를 통해 무인 실행하도록 설계되었습니다.

---

## 주요 기능

- **헤드리스 실행** — Playwright Chromium을 통해 백그라운드에서 조용히 동작
- **AI 기반 스텝 결정** — Azure OpenAI가 직렬화된 DOM을 읽고 각 액션(클릭, 입력, 이동, 대기) 결정
- **현재 날짜/시간 프롬프트 주입** — AI 호출마다 오늘 날짜를 포함하여 날짜 기반 검증이 정확하게 동작
- **단일 브라우저 세션** — 모든 시나리오가 하나의 컨텍스트를 공유하여 로그인 상태 유지
- **DOM 안정화 대기** — AI 호출 전 페이지가 안정될 때까지 element 수 폴링
- **클릭·이동 후 완전 대기** — click/navigate 액션은 항상 `networkidle` + DOM 안정화 대기
- **elementId 유효성 검사** — AI가 elementId 없이 click/fill을 반환하면 실행 건너뜀 + 오류 힌트 주입
- **무한 루프 감지** — 동일 액션이 3회 연속 반복되면 자동으로 시나리오 실패 처리
- **시나리오별 최종 스크린샷** — 각 시나리오 종료 시 전체 페이지 스크린샷 1장 캡처
- **단독 HTML 리포트** — base64 인라인 스크린샷, 클릭 확대, 다크 테마
- **작업 스케줄러 지원** — `run.bat` / `run.ps1` 진입점 포함

---

## 실행 환경

- Python 3.10 이상
- Windows 10 / 11

---

## 설치

```powershell
cd D:\src\WebQAToolkit\WebQARunner

# 가상환경 생성
python -m venv .venv
.venv\Scripts\Activate.ps1

# 패키지 설치
pip install -r requirements.txt

# Playwright 브라우저 설치
playwright install chromium
```

---

## 설정

실행 전 `config.json`을 편집하세요:

```json
{
  "azure": {
    "endpoint": "https://YOUR_RESOURCE.openai.azure.com",
    "api_key": "YOUR_API_KEY",
    "deployment": "gpt-4o",
    "api_version": "2024-02-01",
    "temperature": 0
  },
  "browser": {
    "type": "chromium",
    "headless": true,
    "proxy": null,
    "viewport": { "width": 1280, "height": 800 }
  },
  "runner": {
    "max_steps": 20,
    "dom_stable_ms": 600,
    "dom_max_wait_ms": 8000,
    "navigation_timeout_ms": 10000,
    "action_timeout_ms": 10000,
    "screenshot_full_page": true
  },
  "base_url": "https://your-app.example.com",
  "scenarios_file": "scenarios/scenarios.json",
  "report_dir": "reports"
}
```

| 항목 | 설명 |
|---|---|
| `azure.endpoint` | Azure OpenAI 리소스 엔드포인트 |
| `azure.api_key` | Azure OpenAI API 키 |
| `azure.deployment` | 배포 이름 (예: `gpt-4o`) |
| `azure.temperature` | 샘플링 온도 — `0`으로 설정하면 결정론적 응답 |
| `browser.type` | 브라우저 엔진 (`chromium`, `firefox`, `webkit`) |
| `browser.headless` | 백그라운드 실행 시 `true`, 브라우저를 보려면 `false` |
| `browser.proxy` | 프록시 서버 URL 문자열, 없으면 `null` |
| `browser.viewport` | 뷰포트 크기 — 스크린샷 크기와는 별개 (`screenshot_full_page` 참고) |
| `runner.max_steps` | 시나리오당 최대 스텝 수 (초과 시 incomplete 처리) |
| `runner.dom_stable_ms` | 이 시간(ms) 동안 DOM 변화가 없으면 페이지 안정됐다고 판단 |
| `runner.dom_max_wait_ms` | DOM 안정화 대기의 하드 타임아웃 |
| `runner.navigation_timeout_ms` | 페이지 이동 및 `networkidle` 대기 타임아웃 |
| `runner.action_timeout_ms` | click / fill 엘리먼트 상호작용 타임아웃 |
| `runner.screenshot_full_page` | `true`면 전체 스크롤 페이지 캡처, `false`면 뷰포트만 캡처 |
| `base_url` | 모든 시나리오 실행 전 최초 1회 이동하는 시작 URL |

---

## 시나리오 작성

시나리오는 `scenarios/scenarios.json`에 정의합니다.

모든 시나리오는 **단일 브라우저 세션을 공유**합니다. SC-001에서 로그인했다면 SC-002는 로그인된 상태에서 그대로 시작합니다. 브라우저는 시작 시 `base_url`로 한 번 이동하고, 이후 각 시나리오는 이전 시나리오가 끝난 화면에서 이어서 실행됩니다.

```json
[
  {
    "id": "SC-001",
    "title": "장바구니 담기",
    "description": "상품을 장바구니에 추가할 수 있는지 확인.",
    "scenario": "전자제품 카테고리로 이동하여 첫 번째 상품을 열고 장바구니 담기를 클릭한 후, 장바구니 아이콘의 수량이 1로 표시되는지 확인한다."
  },
  {
    "id": "SC-002",
    "title": "주문 금액 합계",
    "description": "장바구니 합계 금액이 올바르게 계산되는지 확인.",
    "scenario": "장바구니 페이지를 열어 표시된 상품 금액의 합계와 최종 결제 금액이 일치하는지 확인한다."
  },
  {
    "id": "SC-003",
    "title": "주문 내역 조회",
    "description": "주문 내역 페이지에 과거 주문이 표시되는지 확인.",
    "scenario": "내 계정 > 주문 내역으로 이동하여 주문 목록에 1건 이상의 내역이 표시되는지 확인한다."
  }
]
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `id` | 아니오 | 시나리오 ID (생략 시 `SC-001`, `SC-002`, … 자동 부여) |
| `title` | 아니오 | 리포트에 표시되는 이름 |
| `description` | 아니오 | 시나리오에 대한 부가 설명 |
| `scenario` | 예 | 테스트 내용과 검증 조건을 자연어로 기술 |

---

## 실행

**직접 실행:**
```powershell
python runner.py
```

**옵션 지정:**
```powershell
python runner.py --scenarios path\to\other.json --report-dir D:\reports --log-level DEBUG
```

**배치 파일로 실행 (작업 스케줄러):**
```
run.bat
```

### CLI 옵션

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `--config` | `config.json` | 설정 파일 경로 |
| `--scenarios` | _(config 값)_ | 시나리오 파일 경로 덮어쓰기 |
| `--report-dir` | _(config 값)_ | 리포트 저장 경로 덮어쓰기 |
| `--log-level` | `INFO` | `DEBUG` / `INFO` / `WARNING` |

---

## 출력물

실행마다 `reports\` 하위에 타임스탬프 폴더가 생성됩니다:

```
reports\
└── 2026-06-07_09-00-00\
    ├── report.html              ← 단독 HTML 리포트 (브라우저로 열기)
    ├── report.json              ← 기계 판독용 결과 (base64 미포함)
    └── screenshots\
        ├── SC-001_final.png
        ├── SC-002_final.png
        └── ...
```

HTML 리포트 구성:
- 요약 바 — PASS / FAIL / SKIP / INCOMPLETE 수, 총 소요 시간
- 시나리오별 아코디언 (상태 뱃지, 소요 시간, 스텝 수)
- 스텝별 액션 설명 및 AI 판단 근거 (`thinking`)
- 시나리오별 최종 스크린샷 (base64 인라인, 클릭 시 라이트박스 확대)

---

## 윈도우 작업 스케줄러 등록

1. **작업 스케줄러** 열기 → **기본 작업 만들기**
2. 트리거 설정 (예: 매일 오전 9시)
3. 동작: **프로그램 시작**
   - 프로그램: `D:\src\WebQAToolkit\WebQARunner\run.bat`
   - 시작 위치: `D:\src\WebQAToolkit\WebQARunner`
4. **일반** 탭 → **"사용자의 로그온 여부에 관계없이 실행"** 체크
5. 대상 사이트 접근에 권한이 필요한 경우 **"최고 수준의 권한으로 실행"** 체크

---

## Playwright와 AI의 관계

Playwright는 **눈과 손**, AI는 **두뇌** 역할을 합니다. AI는 페이지를 직접 볼 수 없기 때문에 Playwright가 DOM을 텍스트로 변환해 전달하고, AI의 결정을 다시 Playwright가 실제 브라우저 동작으로 실행합니다.

```
┌──────────────────────────────────────────────────────────────┐
│  Playwright (눈 + 손)                 AI (두뇌)              │
│                                                              │
│  1. 페이지 열기                                              │
│  2. JS 주입 → DOM 직렬화 ──────────────────→ 프롬프트 구성:  │
│     { elements, visibleText,                  - 현재 날짜    │
│       fieldValues, url ... }                  - 페이지 상태  │
│                                               - 시나리오     │
│                                               - 이전 액션    │
│                                               Azure AI 호출  │
│                                                    │         │
│  3. 액션 실행  ←───────────────────────────────────┘         │
│    .click()       {"action": {"type": "click",               │
│    .fill()                    "elementId": "el-007"}}        │
│    .goto()                                                   │
│                                                              │
│  4. 대기: networkidle + DOM 안정화 (click/navigate)           │
│           DOM 안정화만 (fill/wait)                           │
│  5. 다음 스텝 → 2번으로 반복                                  │
└──────────────────────────────────────────────────────────────┘
```

한 스텝의 코드 흐름:

```python
# Playwright가 현재 DOM 상태를 읽어서
dom_state = await get_dom_state(page)       # JS 주입 → 요소 목록 반환

# 오늘 날짜를 포함한 프롬프트를 만들어 AI에게 전달
prompt = _build_prompt(dom_state, scenario_text, history)
response, _ = ai_client.call(prompt)        # Azure OpenAI 호출

# AI가 "el-007을 클릭해" 라고 답하면 Playwright가 실행
action = response["action"]                 # {"type": "click", "elementId": "el-007"}
await page.locator('[data-webqa-id="el-007"]').click()

# 페이지가 안정될 때까지 대기 후 다음 스텝 반복
```

---

## AI 프롬프트 구성

매 스텝마다 Azure OpenAI에 다음 섹션을 전달합니다:

| 섹션 | 내용 |
|---|---|
| `[CURRENT DATETIME]` | 현재 날짜/시간 — "오늘", "today" 등 날짜 기반 검증에 사용 |
| `[CURRENT PAGE]` | URL, 페이지 제목, 가시 텍스트 (최대 600자) |
| `[PAGE FIELD VALUES]` | 폼 필드의 라벨-값 쌍 (최대 40개) |
| `[INTERACTABLE ELEMENTS]` | 클릭/입력 가능 요소 번호 목록 (`el-001` … `el-NNN`) |
| `[TEST SCENARIO]` | 자연어 시나리오 텍스트 |
| `[PREVIOUS ACTIONS]` | 직전 5개 액션 이력 (루프 방지용) |
| `[RESPONSE FORMAT]` | 필수 JSON 스키마 + 규칙 |

---

## 동작 원리

```
작업 스케줄러 → run.bat
    └── runner.py
         ├── config.json + scenarios.json 로드
         ├── Playwright 헤드리스 Chromium 실행
         ├── 브라우저 컨텍스트 1개 생성 (세션 공유)
         ├── base_url 이동 (최초 1회)
         │
         ├── [SC-001] 로그인 테스트
         │    └── 스텝 루프 (최대 20회):
         │         ├── JS 주입 → DOM 직렬화
         │         ├── Azure OpenAI 호출 → 액션 결정
         │         ├── elementId 유효성 검사 (없으면 건너뜀 + 힌트)
         │         ├── 액션 실행 (click / fill / navigate / wait)
         │         ├── 대기: networkidle + DOM 안정화 (click/navigate)
         │         │         DOM 안정화만 (fill/wait)
         │         ├── 무한 루프 감지 (3회 연속 동일 액션 → 실패)
         │         └── "done" → pass/fail 기록, 루프 종료
         │    └── 최종 스크린샷 캡처
         │
         ├── [SC-002] 다음 시나리오  ← 세션 그대로 유지
         │    └── 스텝 루프 ...
         │    └── 최종 스크린샷 캡처
         │
         └── report.html + report.json 생성
```

### DOM 안정화 대기 전략

액션 실행 후 200ms 간격으로 `document.querySelectorAll('*').length`를 폴링합니다. `dom_stable_ms`(기본 600ms) 동안 변화가 없으면 페이지가 안정됐다고 판단합니다. 실시간 업데이트가 있는 대시보드에서 무한 대기하지 않도록 `dom_max_wait_ms`(기본 8초) 하드 타임아웃을 적용합니다.

**click·navigate 액션**은 항상 `networkidle` 대기를 먼저 수행한 후 DOM 폴링을 보조로 실행합니다. 이를 통해 페이지 이동뿐 아니라 클릭으로 발생하는 AJAX 응답까지 완전히 처리된 후 다음 스텝으로 넘어갑니다.

**fill·wait 액션**은 네트워크 요청을 유발하지 않으므로 DOM 폴링만 수행합니다.

---

## 프로젝트 구조

```
WebQARunner\
├── runner.py                  메인 진입점
├── requirements.txt           Python 의존성
├── config.json                설정
├── run.bat                    작업 스케줄러용 배치 진입점
├── run.ps1                    PowerShell 진입점
├── scenarios\
│   └── scenarios.json         테스트 시나리오 정의
├── reports\                   실행 시 자동 생성되는 리포트 폴더
└── modules\
    ├── dom_analyzer.py        DOM 상태 추출 JS 주입 및 요소 직렬화
    ├── wait_helper.py         DOM 안정화 폴링 및 네비게이션 대기 헬퍼
    ├── ai_client.py           Azure OpenAI 클라이언트 (json_object 모드, temperature=0)
    ├── scenario_runner.py     시나리오 스텝 루프, 프롬프트 빌더, 액션 실행기
    └── report_generator.py    단독 HTML 리포트 빌더
```

---

## 의존 패키지

| 패키지 | 용도 |
|---|---|
| `playwright` | 헤드리스 브라우저 제어, JS 주입, 스크린샷 |
| `openai` | Azure OpenAI API 클라이언트 (`AzureOpenAI` 클래스) |
