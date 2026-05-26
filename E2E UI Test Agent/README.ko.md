# E2E UI Test Agent

Chrome/Edge에서 동작하는 AI 기반 브라우저 E2E 테스트 확장 프로그램입니다.
자연어 시나리오를 작성하면 에이전트가 현재 DOM을 읽고 단계별로 액션을 실행합니다.

[한국어](README.ko.md) | [English](README.md)

## 개요

- 테스트 코드를 직접 작성하지 않아도 UI 테스트 수행 가능
- 대부분의 웹앱에서 별도 사이트별 설정 없이 사용 가능
- Claude, OpenAI, Azure OpenAI, Ollama, GitHub Copilot 지원
- 실행 로그와 PASS/FAIL 결과를 카드 형태로 확인 가능
- 개별 실행 + 전체 실행(Run All) 모두 지원

## 동작 방식

1. 시나리오를 선택하거나 직접 입력합니다.
2. 확장 프로그램이 페이지 DOM과 상호작용 가능한 요소를 수집합니다.
3. 페이지 상태와 시나리오를 선택한 AI 모델에 전달합니다.
4. 모델이 다음 단일 액션(`click`, `fill`, `navigate`, `wait`, `done`)을 반환합니다.
5. 액션을 현재 활성 탭에서 실행합니다.
6. `done` 또는 최대 스텝 도달 시 종료합니다.

## 주요 기능

- 자연어 기반 시나리오 실행
- `.json` 시나리오 파일 불러오기
- 목록에서 시나리오 개별 실행
- 불러온 시나리오 전체 순차 실행(`Run All`)
- 스텝별 토큰 사용량 표시
- 대상 요소 하이라이트 오버레이
- iframe DOM 전용 모드(옵션)
- 복잡한 컴포넌트 특화 처리
  - jqGrid 행/체크박스
  - jsTree 펼침/선택
- 한국어/영어 UI 자동 적용

## 전체 실행 (Run All)

`Run All`은 불러온 시나리오를 순서대로 실행합니다.
개별 실행 동작은 그대로 유지하면서, 여러 시나리오를 한 번에 돌릴 수 있습니다.

- 기존 개별 실행 흐름 유지
- 각 시나리오는 독립적으로 실행
- 시나리오 텍스트가 비어 있으면 `SKIP` 처리
- 최종 요약에서 `PASS / FAIL / SKIP` 집계 표시
- `Stop` 클릭 시 현재 스텝 종료 후 안전하게 중지

## 설치

### 요구사항

- Chrome 114+ 또는 Edge 114+
- 최소 1개 이상의 AI 제공자 설정

### 압축해제 확장 로드

1. `chrome://extensions` 또는 `edge://extensions` 접속
2. 개발자 모드 활성화
3. **압축해제된 확장 프로그램 로드** 클릭
4. `E2E UI Test Agent` 폴더 선택

## 빠른 시작

1. 테스트 대상 웹사이트를 엽니다.
2. 확장 아이콘을 눌러 사이드패널을 엽니다.
3. 설정에서 AI 제공자를 선택하고 인증 정보를 입력합니다.
4. 시나리오 JSON 파일을 불러오거나 직접 입력합니다.
5. 단일 실행은 `Run Agent`, 일괄 실행은 `Run All`을 클릭합니다.
6. 로그와 결과 카드를 확인합니다.

## 시나리오 JSON 형식

```json
[
  {
    "id": "TC-001",
    "title": "검색 스모크 테스트",
    "description": "검색 결과 노출 확인",
    "scenario": "검색 입력창에 'hello'를 입력하고 검색 버튼을 클릭한 뒤 결과가 보이는지 확인한다."
  },
  {
    "id": "TC-002",
    "title": "상세 이동 테스트",
    "description": "목록에서 상세 이동 확인",
    "scenario": "목록의 첫 번째 항목을 클릭하고 상세 페이지가 열리는지 확인한다."
  }
]
```

초기 템플릿은 [scenarios.example.json](scenarios.example.json)을 참고하세요.

## AI가 반환하는 액션 타입

- `click`
- `fill`
- `navigate`
- `wait`
- `done` (pass/fail 포함)

## 제공자 설정

- Claude: API Key
- OpenAI: API Key
- Azure OpenAI: API Key + Endpoint + Deployment (+ API Version)
- Ollama: 로컬 Endpoint + Model
- GitHub Copilot: OAuth Device 로그인

## 개인정보/보안 유의사항

- 확장 프로그램은 활성 페이지의 가시 DOM 정보를 읽습니다.
- 시나리오 텍스트와 추출된 페이지 컨텍스트가 선택한 AI 제공자로 전송됩니다.
- 민감정보 페이지에서는 내부 보안 정책에 맞게 사용하세요.

## 트러블슈팅

- 페이지 응답 없음:
  - 페이지 새로고침 후 다시 실행하세요.
- 잘못된 요소 클릭:
  - 시나리오를 더 구체적으로 작성하세요(라벨/버튼명/기대 결과 포함).
- iframe 제어 실패:
  - 설정에서 iframe DOM 전용 모드를 켜세요.
- 전체 실행 중단:
  - 로그에서 중지 요청, 제공자 오류, 시나리오 형식 문제를 확인하세요.

## 라이선스

MIT
