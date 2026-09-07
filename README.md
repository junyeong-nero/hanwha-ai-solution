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
| **채팅** | 모임별 익명 채팅방. `＋` 메뉴의 **AI 추천 약속 잡기**가 장소·시간·활동을 제안하고, 후보지를 지도와 목록에서 비교해 고릅니다 |
| **프로필** | 계열사·선호 지역·나이·관심사·취미와 매칭 성향. 변경 후 저장하면 매칭 정렬에 반영됩니다 |

핵심 흐름은 `매칭에서 참가 → 채팅방 → AI 약속 추천 → 확정 → 만남 완료 → 베일 벗기기(익명이 실명으로) → 홈 행성 점등`입니다.

## 기술 스택

| 영역 | 사용 기술 |
| --- | --- |
| 프론트엔드 | **빌드 도구 없는 정적 웹앱** — HTML · CSS · Vanilla JS. ES 모듈이 아닌 일반 `<script>`라 `file://`로 열어도 동작합니다 |
| UI | 다크 우주 테마 고정, Pretendard, `styles.css` 최상단 `:root` 디자인 토큰, iOS Safari 대응(`100dvh` · `safe-area-inset` · 44px 터치 타겟) |
| 인증 · DB · 실시간 | **Supabase** — Postgres + RLS + Realtime + Auth. 계열사·사번·이름 기반 데모 로그인으로 어느 기기에서든 프로필과 채팅이 복원됩니다 |
| 서버 로직 | **Supabase Edge Functions** (Deno · TypeScript) 5개 — `demo-login` · `recommend-meetings` · `suggest-meeting-plan` · `complete-meeting` · `reset-demo` |
| AI | 모임 추천은 **규칙 기반 점수 엔진**, 약속 추천은 **OpenRouter Chat Completions** (아래 참고) |
| 장소 검색 | 카카오 로컬 키워드 검색(REST · 서버 전용 키), REST 키가 없으면 OpenRouter 웹 검색 플러그인 사용 |
| 지도 | 카카오맵 JavaScript SDK (공개 JS 키 · 도메인 제한) |
| 테스트 | Node.js 24 내장 test runner — `npm test` |

`src/js`는 `config` → `app` → `home`/`match`/`chat`/`profile` → `map` → `backend` → `boot` 순서로 로드되며, 전역 스코프를 공유합니다. Edge Function의 `_shared/` 중 추천·채팅·검색 등 순수 모듈은 `Deno` 전역을 쓰지 않아 Node 테스트에서 그대로 검증합니다. 클라이언트 생성용 `supabase.ts`는 Deno 런타임 전용입니다.

## AI를 어디에, 왜 썼는가

### 1. 모임 추천 — LLM을 쓰지 않기로 한 자리

추천 순위는 `supabase/functions/_shared/recommendation.ts`의 **규칙 기반 점수 엔진**이 매깁니다. 관심사 겹침(0.34) · 관계 방향(0.22) · 희망 인원(0.16) · 같은 성별 비율(0.14) · 같은 계열사 비율(0.10) · 잔여석(0.04)을 가중 합산하고, 적용되지 않는 항목은 빼고 나머지를 다시 정규화합니다. 추천 이유 문장도 임계값(0.6)을 넘긴 항목에서만 만들어 근거 없는 설명이 나오지 않게 했습니다.

원래 이 자리도 LLM이었지만 교체했습니다. 순위 매기기는 **입력이 구조화되어 있고 결과가 재현 가능해야 하는** 작업이라, LLM은 대기 시간과 비결정성만 얹고 얻는 것이 없었기 때문입니다. 지금은 응답이 즉시 나오고, 같은 입력이면 항상 같은 순서가 나옵니다.

### 2. 약속 추천 — LLM이 맞는 자리

`suggest-meeting-plan`은 채팅 맥락을 읽어 장소·시간·활동·주변 맛집을 제안합니다. 자유 대화를 해석하는 일이라 LLM(OpenRouter)을 씁니다. 대신 네 가지 안전장치를 걸었습니다.

- **익명화** — 발신자 ID를 `참가자N`으로 바꾸고 최근 대화 30개를 메시지당 300자로 제한합니다. 프로필의 실명·사번은 별도로 넣지 않지만, 대화 본문에 직접 적힌 개인정보를 자동으로 제거하지는 않습니다 (`_shared/chat.ts`의 `anonymizeMessages`).
- **환각 차단** — LLM이 제안한 장소 이름을 그대로 쓰지 않습니다. `verifyPlan`은 검색 결과가 있으면 **결과와 일치하지 않는 장소를 후보에서 빼고**, 남은 후보의 주소·좌표·링크 등을 검색 값으로 채웁니다. 검색 결과가 없으면 LLM 후보를 `검색 미확인` 상태로 남기고 좌표는 비웁니다.
- **실패 대비** — 요청당 20초 타임아웃, 429·5xx 재시도, `response_format`을 거부하는 모델을 위한 compat 모드, 그래도 실패하면 정적 `fallbackPlan`. 장소 검색이 실패해도 약속 추천은 진행되고, 검색 결과 상태를 `quota` · `auth` · `error` · `empty` · `no_key`로 구분해 화면에 알립니다.
- **로그 위생** — 프롬프트·응답·API 키는 어떤 경로로도 로그에 남기지 않습니다.

### 3. 개발 과정에서의 AI

이 저장소 자체를 Claude Code 기반 에이전트 워크플로우로 만들었습니다. 설계 문서([docs/superpowers/specs](docs/superpowers/specs))로 합의하고 → 실행 계획([docs/superpowers/plans](docs/superpowers/plans))으로 쪼갠 뒤 → 브랜치와 PR 단위로 구현했습니다. [AGENTS.md](AGENTS.md)가 에이전트가 지켜야 할 저장소 규칙(이중 모드 아키텍처, 로드 순서, iOS Safari 요건, 디자인 토큰, 키 노출 경계)을 고정하고, 그 규칙이 실제로 지켜지는지는 `tests/`가 검사합니다.

## 배포

**프론트엔드 — GitHub Pages.** `main` 브랜치 root를 그대로 서빙합니다. 빌드 단계가 없어서 **push가 곧 배포**이므로, 동작을 확인한 뒤 push합니다.

**백엔드 — Supabase.** 마이그레이션(`npx supabase db push`) → 시드 → Edge Function 5개 배포 → 비밀값 등록(`supabase secrets set`) 순서입니다. 전체 절차와 발표 전 회귀 체크리스트는 [docs/deployment.md](docs/deployment.md)에 있고, `scripts/deploy-supabase.ps1`로 한 번에 실행할 수도 있습니다.

**키 경계.** 브라우저(`src/js/config.js`)에는 Supabase anon 키와 카카오맵 **JavaScript 키**(도메인 제한된 공개 키)만 들어갑니다. Supabase secret key · OpenRouter API 키 · 카카오 **REST 키**는 Edge Function 비밀값에만 두며, 이 경계가 무너지면 `tests/backend-contract.test.mjs`와 `tests/plan-map.test.mjs`가 실패합니다.

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
