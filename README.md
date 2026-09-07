# MoonLight Hanwha

한화 그룹사 구성원을 위한 **사내 네트워킹 모바일 웹앱 프로토타입**입니다.
AI가 프로필에 맞는 소모임을 추천하고, 익명 채팅에서 시작한 대화가 실제 만남과 새로운 커넥션으로 이어지는 경험을 우주와 달빛의 은유로 표현합니다.

**데모:** [junyeong-nero.github.io/hanwha-ai-solution/src/](https://junyeong-nero.github.io/hanwha-ai-solution/src/) · 휴대폰 화면(375×812) 기준으로 설계했습니다.

**제출 자료:** [영상](assets/video.mp4) · [발표 슬라이드](assets/ppt.html) · [제출 보고서](assets/report.md)

`assets/`에는 제출용 3개 파일을 모았습니다. 영상은 1분 54초 자막판이며, 발표 HTML은 브라우저에서 열면 됩니다. 보고서는 제출 페이지의 필수·선택 항목에 맞춰 작성했습니다. 영상 제작 원본과 중간 산출물은 로컬 `outputs/`에 보존하고 Git에서 제외합니다.

## 무엇을 푸는가

회사에는 사람이 많지만 만나는 사람은 늘 비슷합니다. 부족한 것은 사람이 아니라 **서로를 알 수 있는 접점과 만나고 싶은 이유**입니다. 그래서 만남을 지정하는 대신, 관심사·생활권·관계 성향을 해석해 "이 모임이 왜 나에게 맞는지"를 설명하는 쪽을 택했습니다. 문제 정의와 데이터 근거는 [docs/introduction.md](docs/introduction.md)에 있습니다.

화면은 네 개의 탭으로 이루어집니다.

| 탭 | 하는 일 |
| --- | --- |
| **홈** | 계열사를 궤도 도는 행성으로 표현. 아는 사람이 생긴 계열사만 은하계에 합류하고, 만남이 성사되면 그 행성이 점등됩니다 |
| **매칭** | 프로필 기반 모임 추천. 카드의 한화 주황색 띠가 이미 만난 사람이 포함된 비율을 보여줍니다 |
| **채팅** | 모임별 익명 채팅방. `＋` 메뉴의 **약속 잡기 · 시간과 장소**에서 가능한 시간을 그리드에 칠하고, 대화 기반 장소 후보를 골라 방장이 확정합니다 |
| **프로필** | 계열사·선호 지역·나이·관심사·취미와 매칭 성향. 변경 후 저장하면 매칭 정렬에 반영됩니다 |

핵심 흐름은 `매칭에서 참가 → 채팅방 → AI 약속 추천 → 확정 → 만남 완료 → 베일 벗기기(익명이 실명으로) → 홈 행성 점등`입니다.

## 기술 스택

| 영역 | 사용 기술 |
| --- | --- |
| 프론트엔드 | **빌드 도구 없는 정적 웹앱** — HTML · CSS · Vanilla JS. ES 모듈이 아닌 일반 `<script>`라 `file://`로 열어도 동작합니다 |
| UI | 다크 우주 테마 고정, Pretendard, `styles.css` 최상단 `:root` 디자인 토큰, iOS Safari 대응(`100dvh` · `safe-area-inset` · 44px 터치 타겟) |
| 인증 · DB · 실시간 | **Supabase** — Postgres + RLS + Realtime + Auth. 계열사·사번·이름 기반 데모 로그인으로 어느 기기에서든 프로필과 채팅이 복원됩니다 |
| 서버 로직 | **Supabase Edge Functions** (Deno · TypeScript) 5개 — `demo-login` · `recommend-meetings` · `suggest-meeting-plan` · `complete-meeting` · `reset-demo` |
| AI | 모임·약속 추천은 **OpenAI Responses API · gpt-5.4-mini** (아래 참고) |
| 장소 검색 | 카카오 로컬 키워드 검색(REST · 서버 전용 키), 검색 실패 시 기본 카드 제공 |
| 지도 | 카카오맵 JavaScript SDK (공개 JS 키 · 도메인 제한) |
| 테스트 | Node.js 24 내장 test runner — `npm test` |

`src/js`는 `config` → `app` → `home`/`match`/`chat`/`profile` → `map` → `backend` → `boot` 순서로 로드되며, 전역 스코프를 공유합니다. Edge Function의 `_shared/` 중 추천·채팅·검색 등 순수 모듈은 `Deno` 전역을 쓰지 않아 Node 테스트에서 그대로 검증합니다. 클라이언트 생성용 `supabase.ts`는 Deno 런타임 전용입니다.

## AI를 어디에, 왜 썼는가

### 1. 모임 추천 — 규칙 후보를 GPT로 재정렬

선호 지역·정원으로 후보를 추리고, 기존 가중치 엔진으로 채점한 미참가 모임 상위 20개를 `gpt-5.4-mini`가 재정렬합니다. ‘러닝’과 ‘조깅’처럼 문자열이 다른 관심사의 의미를 해석하고 개인화된 추천 이유를 작성합니다. 후보 밖 ID·중복·누락을 검증하고, API 실패 시 규칙 추천을 제공합니다. 나머지 후보도 유지하며 이미 참가한 모임은 뒤에 둡니다.

### 2. 약속 추천 — 검색된 장소와 대화 맥락 결합

`suggest-meeting-plan`은 먼저 GPT가 최근 대화에서 음식·활동·지역 의도를 추출하고, 그 키워드로 카카오를 검색한 뒤 같은 대화와 실제 후보를 GPT에 전달해 장소를 추천합니다. 러닝 모임에서도 닭발을 먹자는 대화면 닭발 식당을 찾습니다. 시간은 날짜×시간 그리드로 조율하고 방장이 선택합니다. 발신자 ID는 `참가자N`으로 치환하고 호출자 참가 이후 대화만 사용합니다(최대 30개·각 300자). 대화 본문에 직접 적힌 개인정보를 자동 제거하지는 않습니다.

- **장소 검증** — 후보·만남 장소·주변 장소를 검색 결과와 대조하고 주소·좌표·링크는 검색 값으로 채웁니다. 검색 결과가 없으면 최종 추천 호출을 생략하고 다시 시도를 안내합니다.
- **오류 대응** — 의도 분석은 8초, 최종 추천은 20초로 제한합니다. 의도 분석 실패 시 식당·카페 검색으로, 최종 추천 실패 시 실제 검색 후보로 대체합니다.
- **키 관리** — 사용자 소유 `OPENAI_API_KEY`는 Supabase Secret에서만 읽습니다. API에는 `store: false`를 지정하고 프롬프트·응답·키 원문을 로그에 남기지 않습니다.

구조와 설정은 [docs/ai-usage.md](docs/ai-usage.md)를 참고하세요.

### 3. 개발 과정에서의 AI

이 저장소 자체를 Claude Code 기반 에이전트 워크플로우로 만들었습니다. 설계 문서([docs/superpowers/specs](docs/superpowers/specs))로 합의하고 → 실행 계획([docs/superpowers/plans](docs/superpowers/plans))으로 쪼갠 뒤 → 브랜치와 PR 단위로 구현했습니다. [AGENTS.md](AGENTS.md)가 에이전트가 지켜야 할 저장소 규칙(이중 모드 아키텍처, 로드 순서, iOS Safari 요건, 디자인 토큰, 키 노출 경계)을 고정하고, 그 규칙이 실제로 지켜지는지는 `tests/`가 검사합니다.

## 배포

**프론트엔드 — GitHub Pages.** `main` 브랜치 root를 그대로 서빙합니다. 빌드 단계가 없어서 **push가 곧 배포**이므로, 동작을 확인한 뒤 push합니다.

**백엔드 — Supabase.** 마이그레이션(`npx supabase db push`) → 시드 → Edge Function 5개 배포 → 비밀값 등록(`supabase secrets set`) 순서입니다. 전체 절차와 발표 전 회귀 체크리스트는 [docs/deployment.md](docs/deployment.md)에 있고, `scripts/deploy-supabase.ps1`로 한 번에 실행할 수도 있습니다.

**키 경계.** 브라우저(`src/js/config.js`)에는 Supabase anon 키와 카카오맵 **JavaScript 키**(도메인 제한된 공개 키)만 들어갑니다. Supabase secret key · OpenAI API 키 · 카카오 **REST 키**는 Edge Function 비밀값에만 두며, 이 경계가 무너지면 `tests/backend-contract.test.mjs`와 `tests/plan-map.test.mjs`가 실패합니다.

**이중 모드.** `CONFIG`가 비어 있으면 네트워크 요청 없이 하드코딩 데이터로 도는 로컬 데모 모드가 됩니다. 백엔드가 연결된 상태에서도 URL에 `?demo=1`을 붙이면 로컬 모드로 열려, 발표장 네트워크 장애에 대비할 수 있습니다.

## 실행 방법

빌드가 필요 없습니다. 저장소를 내려받아 브라우저에서 [`src/index.html`](src/index.html)을 열면 됩니다. 개발자 도구에서 약 375×812 뷰포트로 보는 것을 권장합니다.

테스트는 Node.js 24 이상에서 실행합니다.

```bash
npm test
```

## 문서

- [기능 명세](docs/features.md) — 4개 탭과 전체 사용자 흐름의 기준 문서(SSOT)
- [프로젝트 소개](docs/introduction.md) — 문제 정의·해결 방식·기대효과
- [배포 절차](docs/deployment.md) — Supabase·Pages 설정과 발표 전 체크리스트
- [AGENTS.md](AGENTS.md) — 저장소 아키텍처 규칙과 개발 가이드
- [문제 정의 원문](docs/background.md) · [초기 기획 원문](docs/overview.md) — 참고용 보존 문서

## 프로젝트 구조

```text
├── src/                    # 프로토타입 (로컬 데모 / 백엔드 이중 모드)
│   ├── index.html          # 마크업과 로드 순서
│   ├── styles.css          # 디자인 토큰과 전체 스타일
│   └── js/                 # config · app · home · match · chat · profile · map · backend · boot
├── supabase/
│   ├── migrations/         # 스키마 · RLS · RPC
│   ├── functions/          # Edge Functions (Deno) + _shared/ 순수 로직
│   └── seed.sql
├── tests/                  # npm test (Node.js 24+)
├── docs/                   # 기능 명세 · 소개 · 배포 절차 · 설계 문서
├── scripts/                # 배포 · Node 버전 검사
└── assets/                 # 제출용 video.mp4 · ppt.html · report.md / 폰트 · 과제 안내
```
