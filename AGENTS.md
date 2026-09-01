# AGENTS.md — MoonLight Hanwha

AI 코딩 에이전트를 위한 저장소 안내 문서입니다.

## 프로젝트가 무엇인가

**MoonLight Hanwha** — 한화 신입사원 AI 실습 과제(Assignment 05/05, 자유주제)로 만드는 **사내 네트워킹 모바일 웹앱 프로토타입**입니다. AI가 프로필 설정을 기반으로 모임을 추천하고, 익명 채팅에서 시작해 실제 만남(베일 벗기기)까지 이어지는 경험을 시연합니다.

- 핵심 은유: 우주와 달빛 — 계열사는 행성, 만남 성사는 행성의 점등
- 제출 마감: **2026-09-08(화) 22:00**
- 평가 핵심: AI 도구 활용(50점) · 문제 해결력(30점) · 현업 적용 가능성(20점) — 상세는 README.md 평가표 참고

## 문서 읽는 순서

| 문서 | 역할 |
| --- | --- |
| [docs/features.md](docs/features.md) | **현재 기능 명세의 단일 기준(SSOT).** 4탭 구조와 모든 기능 정의 |
| [docs/background.md](docs/background.md) | 문제 정의와 데이터 근거(설문·연구 인용) — 여전히 유효 |
| [docs/overview.md](docs/overview.md) | 초기 방향("달빛한화") 문서 — **피벗 이전 내용**이므로 기능 판단 기준으로 쓰지 말 것 |
| README.md | 과제 제출 안내·평가표·TODO |

기능 관련 판단이 충돌하면 **features.md가 우선**합니다.

## 저장소 구조

```
├── AGENTS.md               ← 이 문서
├── README.md               ← 과제 안내·평가표
├── assets/
│   ├── fonts/PretendardVariable.woff2
│   └── 한화 AI 솔루션 챌린지 프로젝트 과제 안내.pdf (스캔본, 텍스트 추출 불가)
├── docs/                   ← 기획 문서
└── src/
    ├── index.html          ← 프로토타입 본체 (단일 파일)
    └── 달빛한화_PeerLink_v5.html  ← 피벗 이전 탐색 버전 (참고용, 수정 금지)
```

## 개발 규칙

### 아키텍처
- **`src/index.html` 단일 파일** — HTML/CSS/JS 전부 포함, 외부 라이브러리·빌드 도구·네트워크 요청 없음 (폰트만 `../assets/fonts/` 상대 경로 참조)
- 데모 상태는 전역 `S` 객체 하나에 저장, 새로고침 시 초기화. 백엔드·localStorage 없음 (의도된 설계)
- 데이터는 `COMPANIES` / `PEOPLE` / `MEETINGS` / `PLANS` 상수에 하드코딩
- 화면 전환은 섹션 show/hide 방식 (SPA 라우터 없음)

### iOS Safari 대응 (수정 시 반드시 유지)
- `viewport-fit=cover` + `env(safe-area-inset-*)` 패딩 — 노치·홈 인디케이터 대응
- `100dvh` 사용 (`100vh` 금지 — 주소창 버그)
- 입력 요소 폰트 **16px 이상** (미만이면 포커스 시 강제 확대)
- 터치 타겟 최소 **44px**, `:hover` 의존 금지
- `apple-mobile-web-app-capable` 메타 유지 — 홈 화면 추가 시 standalone 실행
- `prefers-reduced-motion` 지원 유지

### 스타일
- UI 텍스트·주석·문서·커밋 메시지 모두 **한국어**
- 브랜드 컬러: 한화 주황 `--orange: #F37321` (아는 사람 비율 띠 등 핵심 시그널에 사용)
- 다크 우주 테마 고정 (라이트 모드 없음)
- 폰트: Pretendard (시스템 폰트 폴백 포함)

## 실행·확인 방법

빌드 불필요. 브라우저에서 `src/index.html`을 열면 동작합니다.

- 모바일 뷰포트(375×812)로 확인할 것 — 이 앱은 휴대폰 화면 기준으로 설계됨
- 핵심 데모 흐름으로 회귀 확인:
  1. 매칭 탭 → 모임 `참가` → 채팅 탭에 방 생성
  2. 채팅방 `＋` → `AI 추천 약속 잡기` → `이 약속으로 확정`
  3. 상단 배너 `만남 완료 (데모)` → 베일 벗기기 애니메이션 → 익명→실명 전환, 사진첩 개방
  4. 홈 탭 → 해당 계열사 행성 점등·연결 동료 수 증가 확인
  5. 프로필 설정 변경(선호 지역·관계 방향) → 매칭 탭 정렬 변화 확인

## 배포

- **GitHub Pages** — `main` 브랜치 root 배포
- 접속 주소: `https://junyeong-nero.github.io/hanwha-ai-solution/src/`
- `main`에 push하면 자동 재배포되므로, **push = 배포**임을 인지하고 동작 확인 후 push할 것

## Git 규칙

- 브랜치: `main` 직접 push (과제용 소규모 저장소)
- 커밋 메시지: 한국어, `feat:` / `docs:` / `fix:` 프리픽스 사용
- `src/달빛한화_PeerLink_v5.html`과 `assets/` 안내 PDF는 수정·삭제하지 말 것
