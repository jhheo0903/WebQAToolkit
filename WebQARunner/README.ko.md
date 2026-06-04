# WebQA Runner

DOM 상태를 분석하고 AI가 각 단계를 결정하며 스크린샷을 캡처하는 백그라운드 E2E 테스트 자동화 도구입니다. 윈도우 작업 스케줄러를 통해 무인 실행하도록 설계되었습니다.

---

## 주요 기능

- **헤드리스 실행** — Playwright를 통해 백그라운드에서 조용히 동작
- **AI 기반 스텝 결정** — Azure OpenAI가 각 액션(클릭, 입력, 이동, 대기) 결정
- **DOM 안정화 대기** — 다음 스텝 진행 전 페이지가 안정될 때까지 element 수 폴링
- **스텝별 스크린샷** — 모든 액션의 실행 전/후 이미지 캡처
- **단독 HTML 리포트** — base64 인라인 스크린샷, 클릭 확대, 다크 테마
- **작업 스케줄러 지원** — `run.bat` / `run.ps1` 진입점 포함
- **간결한 시나리오 포맷** — 자연어 한 줄로 테스트 시나리오 정의

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
    "api_version": "2024-02-01"
  },
  "browser": {
    "headless": true,
    "viewport": { "width": 1280, "height": 800 }
  },
  "runner": {
    "max_steps": 20,
    "dom_stable_ms": 600,
    "dom_max_wait_ms": 8000,
    "screenshot_on_each_step": true
  },
  "scenarios_file": "scenarios/scenarios.json",
  "report_dir": "reports"
}
```

| 항목 | 설명 |
|---|---|
| `azure.endpoint` | Azure OpenAI 리소스 엔드포인트 |
| `azure.api_key` | Azure OpenAI API 키 |
| `azure.deployment` | 배포 이름 (예: `gpt-4o`) |
| `browser.headless` | 백그라운드 실행 시 `true`, 브라우저를 보려면 `false` |
| `browser.proxy` | 프록시 서버 URL 문자열, 없으면 `null` |
| `runner.max_steps` | 시나리오당 최대 스텝 수 |
| `runner.dom_stable_ms` | DOM 변화가 없어야 하는 시간(ms) — 이 시간이 지나면 페이지가 안정됐다고 판단 |
| `runner.dom_max_wait_ms` | DOM 안정화 대기의 하드 타임아웃 |
| `base_url` | 시나리오에 URL이 없을 때 사용하는 기본 시작 URL |

---

## 시나리오 작성

시나리오는 `scenarios/scenarios.json`에 정의합니다.

```json
[
  {
    "id": "SC-001",
    "title": "로그인 테스트",
    "url": "http://intranet.example.com/login",
    "scenario": "admin@company.com 계정으로 로그인하고 대시보드 제목이 표시되는지 확인해"
  },
  {
    "id": "SC-002",
    "title": "사용자 목록 조회",
    "url": "http://intranet.example.com",
    "scenario": "사용자 관리 메뉴로 이동해서 사용자 목록 테이블이 표시되는지 확인해"
  }
]
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `id` | 아니오 | 시나리오 ID (생략 시 `SC-001`, `SC-002`, … 자동 부여) |
| `title` | 아니오 | 리포트에 표시되는 이름 |
| `url` | 아니오 | 시작 URL (없으면 config의 `base_url` 사용) |
| `scenario` | 예 | 테스트 내용을 자연어로 기술 |

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
└── 2026-06-04_09-00-00\
    ├── report.html              ← 단독 HTML 리포트 (브라우저로 열기)
    ├── report.json              ← 기계 판독용 결과 (base64 미포함)
    └── screenshots\
        ├── SC-001_step_01_before.png
        ├── SC-001_step_01_after.png
        └── ...
```

HTML 리포트 구성:
- 요약 바 — PASS / FAIL / SKIP 수, 총 소요 시간
- 시나리오별 아코디언 (상태 뱃지 포함)
- 스텝별 액션 설명, AI 판단 근거, 전/후 스크린샷
- 스크린샷 클릭 시 라이트박스 확대

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
│  2. JS 주입 → DOM 직렬화 ──────────────────→ 프롬프트 구성  │
│     { elements, visibleText,                  후 Azure AI    │
│       fieldValues, url ... }                  호출           │
│                                                    │         │
│  3. 액션 실행  ←───────────────────────────────────┘         │
│    .click()       {"action": {"type": "click",               │
│    .fill()                    "elementId": "el-007"}}        │
│    .goto()                                                   │
│                                                              │
│  4. DOM 안정화 대기 + After 스크린샷                          │
│  5. 다음 스텝 → 2번으로 반복                                  │
└──────────────────────────────────────────────────────────────┘
```

한 스텝의 코드 흐름:

```python
# Playwright가 현재 DOM 상태를 읽어서
dom_state = await get_dom_state(page)       # JS 주입 → 요소 목록 반환

# 텍스트 프롬프트로 만들어 AI에게 전달
prompt = _build_prompt(dom_state, scenario_text, history)
response, _ = ai_client.call(prompt)        # Azure OpenAI 호출

# AI가 "el-007을 클릭해" 라고 답하면 Playwright가 실행
action = response["action"]                 # {"type": "click", "elementId": "el-007"}
await page.locator('[data-webqa-id="el-007"]').click()

# 다음 스텝에서 변경된 DOM을 다시 AI에게 전달 → 반복
```

---

## 동작 원리

```
작업 스케줄러 → run.bat
    └── runner.py
         ├── config.json + scenarios.json 로드
         ├── Playwright 헤드리스 Chromium 실행
         └── 각 시나리오:
              ├── 시작 URL 이동
              └── 스텝 루프 (최대 20회):
                   ├── Before 스크린샷 캡처
                   ├── JS 주입 → DOM 요소 + 필드 값 직렬화
                   ├── 프롬프트 구성 (페이지 상태 + 요소 + 이력 + 시나리오)
                   ├── Azure OpenAI 호출 → JSON 액션 파싱
                   ├── 액션 실행 (click / fill / navigate / wait)
                   ├── DOM 안정화 대기 (element 수 폴링)
                   ├── After 스크린샷 캡처
                   └── "done" 액션 → pass/fail 기록 후 루프 종료
              └── report.html + report.json 생성
```

### DOM 안정화 대기 전략

액션 실행 후 200ms 간격으로 `document.querySelectorAll('*').length`를 폴링합니다. `dom_stable_ms`(기본 600ms) 동안 변화가 없으면 페이지가 안정됐다고 판단합니다. 실시간 업데이트가 있는 대시보드에서 무한 대기하지 않도록 `dom_max_wait_ms`(기본 8초) 하드 타임아웃을 적용합니다.

navigate 액션 후에는 `networkidle` 대기를 먼저 수행하고, 이후 폴링 대기를 보조로 실행합니다.

---

## 프로젝트 구조

```
WebQARunner\
├── runner.py                  메인 진입점
├── requirements.txt           Python 의존성
├── config.json                설정 템플릿
├── run.bat                    작업 스케줄러용 배치 진입점
├── run.ps1                    PowerShell 진입점
├── scenarios\
│   └── scenarios.json         테스트 시나리오 정의
├── reports\                   실행 시 자동 생성되는 리포트 폴더
└── modules\
    ├── dom_analyzer.py        DOM 상태 추출용 JS 주입
    ├── wait_helper.py         DOM 안정화 폴링 헬퍼
    ├── ai_client.py           Azure OpenAI 클라이언트
    ├── scenario_runner.py     시나리오 실행 루프
    └── report_generator.py    HTML 리포트 빌더
```

---

## 의존 패키지

| 패키지 | 용도 |
|---|---|
| `playwright` | 헤드리스 브라우저 제어, 스크린샷 |
| `openai` | Azure OpenAI API 클라이언트 (`AzureOpenAI` 클래스) |
