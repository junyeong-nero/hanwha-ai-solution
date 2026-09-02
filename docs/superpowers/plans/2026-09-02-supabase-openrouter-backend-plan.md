# Supabase·OpenRouter 백엔드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> 2026-09-02 검토 반영본. 변경 요지: 우선순위(P0/P1/P2) 신설, 이중 모드 제약, 발표 단계 사번 미수집, Deno 테스트를 Node 24 type-stripping으로 실행, 운영 디테일(익명 로그인·publication·CORS·유니크 제약·레이트리밋 테이블) 각 태스크에 반영, 사진 업로드 제외, AI 전송 고지를 Task 6으로 이동, 삭제된 파일 관련 제약 정리.

**Goal:** 기존 단일 HTML 데모에 공용 QR·임시 입장 코드, Supabase 데이터/실시간 기능, OpenRouter LLM 매칭·약속 추천을 연결하고 25명 파일럿으로 확장 가능한 기반을 만든다. 백엔드 설정이 없으면 기존 로컬 데모가 그대로 동작해야 한다.

**Architecture:** GitHub Pages의 `src/index.html`은 Supabase의 publishable/anon 키로 Auth·Database·Realtime만 호출한다. 비밀 키와 OpenRouter API 키를 사용하는 모든 검증·LLM 호출은 Supabase Edge Function에서 수행하며, RLS와 `security definer` RPC가 사용자별 데이터 접근을 제한한다. 발표 환경과 파일럿 환경은 설정값과 Supabase 프로젝트를 분리한다.

**Tech Stack:** HTML/CSS/JavaScript(기존 단일 파일) + supabase-js UMD(CDN, 백엔드 모드에서만 동적 로드), Supabase Postgres/Auth/Realtime/Edge Functions(Deno), OpenRouter OpenAI 호환 Chat Completions API, Node 24 내장 테스트 러너(`node --test`, `.ts` 순수 모듈 직접 import)

**Spec:** `docs/superpowers/specs/2026-09-02-supabase-openrouter-backend-design.md`

## 진행 현황 (2026-09-02)

- **코드·테스트:** Task 1~7 구현 완료. `node --test tests/*.mjs` 53개 통과. 로컬 데모 모드 회귀(참가→AI 약속→베일 벗기기→행성 점등) 브라우저 확인 완료.
- **미완(배포 의존):** Supabase 프로젝트 생성·마이그레이션 적용(`supabase db push`)·Edge Function 배포·OpenRouter 키 등록·실기기 검증. 절차는 [docs/deployment.md](../../deployment.md).
- **Task 8(파일럿):** 제출 후 진행.

## 우선순위

| 우선순위 | 태스크 | 판단 |
| --- | --- | --- |
| **P0 — 발표 필수** | Task 1~4 | LLM 매칭을 실제 호출로 시연하는 최소 범위 |
| **P1 — 발표 권장** | Task 5~7 | 실시간 채팅·AI 약속·안정화. 코드는 작성하고 배포는 시간에 따라 |
| **P2 — 제출 후** | Task 8 | 25명 파일럿. 평가와 무관 |

코드 작성은 P0·P1을 한 번에 진행해도 되지만, Supabase 프로젝트 배포와 라이브 검증은 P0 → P1 순서로 한다.

## Global Constraints

- UI 텍스트·주석·문서·커밋 메시지는 한국어로 작성한다.
- **이중 모드:** `src/index.html`의 `CONFIG.SUPABASE_URL`이 비어 있으면 기존 로컬 데모 모드로 동작하고 네트워크 요청을 하지 않는다. 모든 백엔드 연동은 `BACKEND` 플래그로 분기하며 기존 함수 이름(`joinMeet`, `sendMsg`, `openRoom`, `aiPlan`, `confirmPlan`, `doReveal`)을 유지한다.
- `src/index.html`의 모바일 UI와 전역 `S` 상태 흐름을 유지하고, 기존 기능 명세의 4개 탭을 제거하지 않는다.
- `viewport-fit=cover`, `env(safe-area-inset-*)`, `100dvh`, 입력 폰트 16px 이상, 터치 타겟 44px 이상, `prefers-reduced-motion` 지원을 유지한다.
- 브라우저에는 Supabase publishable/anon 키만 포함한다. Supabase secret key와 OpenRouter API 키는 Edge Function 비밀 환경변수에만 둔다.
- supabase-js는 백엔드 모드에서만 jsDelivr CDN `<script>`를 동적으로 삽입해 로드한다. 다른 외부 라이브러리·빌드 도구는 도입하지 않는다.
- 사번·본명·이메일·전화번호·사진 URL을 LLM 프롬프트에 포함하지 않는다. **발표 단계에서는 사번을 수집하지 않는다.**
- 발표용 QR은 공용 주소 하나를 사용하고, 입장 코드는 서버에서 만료 시간·활성 상태·호출 횟수·레이트리밋을 확인한다.
- LLM은 후보 모임 중에서만 선택하도록 하고, 서버가 `meeting_id`를 검증한다.
- LLM JSON 파싱 실패는 1회 재시도 후 결정적 기본 추천으로 대체한다.
- Edge Function의 순수 로직(`_shared/`)은 `Deno` 전역을 쓰지 않아 Node 24에서도 그대로 import·테스트할 수 있어야 한다. `Deno.env` 접근은 각 함수의 `index.ts`에서만 한다.
- `assets/` 안내 PDF와 기존 폰트 파일은 수정하지 않는다.
- 모든 작업은 작은 커밋으로 남기며 커밋 메시지는 `feat:`, `fix:`, `docs:` 중 하나로 시작한다.

## 파일 구조와 책임

계획에서 새로 만드는 파일은 다음 책임만 갖는다.

- `supabase/config.toml`: 로컬 Supabase·Edge Function 설정
- `supabase/migrations/0001_initial.sql`: 테이블·인덱스·유니크 제약·RLS 정책·Realtime publication·RPC 함수
- `supabase/seed.sql`: 발표용 더미 계열사·모임 데이터와 로컬 개발용 입장 코드
- `supabase/functions/_shared/cors.ts`: CORS 헤더와 프리플라이트 응답
- `supabase/functions/_shared/supabase.ts`: 호출자 스코프 클라이언트·서비스 클라이언트 생성
- `supabase/functions/_shared/auth.ts`: 코드 해시, 만료·레이트리밋 판정 (순수 함수)
- `supabase/functions/_shared/llm.ts`: OpenRouter 호출, 타임아웃, 1회 재시도
- `supabase/functions/_shared/recommendation.ts`: 매칭 프롬프트 생성·응답 파서·결정적 fallback 정렬 (순수 함수)
- `supabase/functions/_shared/chat.ts`: 채팅 익명화·약속 프롬프트 생성·응답 파서 (순수 함수)
- `supabase/functions/demo-login/index.ts`: 입장 코드 검증 + (계열사, 사번, 이름) 결정적 계정 로그인 (JWT 불필요)
- `supabase/migrations/0002_employee_identity.sql`: `(company_id, employee_no)` 유니크 인덱스
- `supabase/functions/recommend-meetings/index.ts`: 후보 필터링, LLM 호출, 응답 검증
- `supabase/functions/suggest-meeting-plan/index.ts`: 최근 채팅 기반 약속 추천, `meeting_plans` 저장
- `supabase/functions/complete-meeting/index.ts`: `complete_meeting_tx` 호출
- `supabase/functions/reset-demo/index.ts`: 관리 토큰 검증 후 발표 데이터 초기화
- `src/index.html`: 기존 화면에 인증·원격 데이터·Realtime 호출을 연결하는 유일한 프론트엔드 파일
- `tests/backend-contract.test.mjs`: 브라우저에 비밀 키가 노출되지 않는지와 클라이언트 호출 계약을 검사
- `tests/edge-functions.test.mjs`: `_shared/` 순수 함수(입장 코드, JSON 검증, 익명화)와 마이그레이션 스키마 검사. Node 24로 실행
- `.env.example`: 필요한 공개 설정 키 이름만 문서화하고 실제 값은 넣지 않음
- `docs/deployment.md`: Supabase 프로젝트·Edge Function·GitHub Pages 배포 절차와 발표 체크리스트

---

### Task 1: Supabase 골격·환경 설정·규칙 문서 갱신

**Files:**
- Create: `supabase/config.toml`
- Create: `.env.example`
- Create: `tests/backend-contract.test.mjs`
- Modify: `.gitignore`
- Modify: `AGENTS.md`, `README.md` (외부 라이브러리 규칙을 이중 모드 기준으로 갱신, 삭제된 v5 파일 언급 제거)

**Interfaces:**
- Browser config block: `const CONFIG={SUPABASE_URL:'',SUPABASE_ANON_KEY:'',DEMO_MODE:true}` and `const BACKEND=!!(CONFIG.SUPABASE_URL&&CONFIG.SUPABASE_ANON_KEY)`.
- Edge Function secret names set manually: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `DEMO_RESET_TOKEN`. `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform (`SUPABASE_` prefixed secrets cannot be set manually); `_shared/supabase.ts` reads `SUPABASE_SECRET_KEY` first and falls back to the injected service role key.

- [x] **Step 1: Write the failing contract test**

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('브라우저 설정에는 OpenRouter 비밀 키가 없다', () => {
  const html = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /OPENROUTER_API_KEY|SUPABASE_SECRET_KEY|service_role/);
});

test('환경 예시는 공개 키와 함수 설정을 구분한다', () => {
  const env = fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  assert.match(env, /SUPABASE_ANON_KEY/);
  assert.match(env, /OPENROUTER_MODEL/);
  assert.doesNotMatch(env, /sk-or-v1-[A-Za-z0-9]/);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/backend-contract.test.mjs`
Expected: FAIL because `.env.example` does not exist.

- [x] **Step 3: Add configuration files**

Create `.env.example` with empty placeholders only:

```dotenv
SUPABASE_URL=
SUPABASE_ANON_KEY=
OPENROUTER_MODEL=openrouter/free
DEMO_MODE=true
```

Create `supabase/config.toml` with the minimal project config (functions keep JWT verification enabled by default; `reset-demo` sets `verify_jwt = false` because it authenticates with its own token).

- [x] **Step 4: Update ignore rules, AGENTS.md, README.md**

Add `.env`, `.env.local`, `supabase/.temp/` and `supabase/.branches/` to `.gitignore`. In `AGENTS.md` and `README.md`, replace "외부 라이브러리·네트워크 요청 없음" with the 이중 모드 rule and remove references to the deleted `src/달빛한화_PeerLink_v5.html`. Run `node --test tests/backend-contract.test.mjs`; expected result is PASS.

- [x] **Step 5: Commit**

```bash
git add .gitignore .env.example supabase/config.toml tests/backend-contract.test.mjs AGENTS.md README.md
git commit -m "feat: Supabase 실행 골격과 환경 설정 추가"
```

### Task 2: 데이터베이스 스키마·시드·RLS·RPC

**Files:**
- Create: `supabase/migrations/0001_initial.sql`
- Create: `supabase/seed.sql`
- Create: `tests/edge-functions.test.mjs`

**Interfaces:**
- `profiles` stores private `real_name` (and nullable `employee_no` for pilot only) and public matching fields.
- `companies`, `meetings`, `meeting_members`, `messages`, `meeting_plans`, `connections`, `albums`, `demo_access_codes`, `demo_sessions`, `demo_entry_attempts`, `ai_recommendation_runs` match the design spec (12 tables).
- RPC: `my_connections()`, `room_members(p_meeting_id)`, `room_summaries()`, `complete_meeting_tx(p_meeting_id)`.
- RLS guarantees: users can read/update their own profile; members can read/write messages in joined meetings; only a function/service role changes demo codes and connections.

- [x] **Step 1: Write schema assertions**

In `tests/edge-functions.test.mjs`, read `supabase/migrations/0001_initial.sql` and assert `create table` statements for all twelve tables, `enable row level security` for user data tables, the Realtime publication line for `messages` and `meeting_plans`, the ordered-pair unique constraint on `connections`, and the four RPC function names.

- [x] **Step 2: Run the schema test to verify it fails**

Run: `node --test tests/edge-functions.test.mjs`
Expected: FAIL because the migration file does not exist.

- [x] **Step 3: Write the migration**

Create UUID primary keys where records are user-facing, use `auth.users(id)` for `profiles.user_id`, use `timestamptz` defaults of `now()`, and add indexes on `meeting_members.user_id`, `messages.meeting_id`, `connections.user_a_id`, and `connections.user_b_id`. Add `check (user_a_id < user_b_id)` and `unique (user_a_id, user_b_id)` on `connections`. Add `check (char_length(body) <= 500)` on `messages`.

Add RLS policies with these exact rules:

```sql
create policy "프로필 본인 조회" on public.profiles
for select using (auth.uid() = user_id);

create policy "프로필 본인 수정" on public.profiles
for update using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "참가 모임 메시지 조회" on public.messages
for select using (
  exists (select 1 from public.meeting_members mm
          where mm.meeting_id = messages.meeting_id
            and mm.user_id = auth.uid())
);
```

Add equivalent insert policies for a joined member, allow members to update `meeting_plans.confirmed`, and deny direct browser writes to `connections`, `albums`, `demo_access_codes`, `demo_sessions`, `demo_entry_attempts`, and `ai_recommendation_runs`.

Add `alter publication supabase_realtime add table public.messages, public.meeting_plans;`.

Add the four `security definer` RPC functions with `set search_path = public` and explicit membership checks. `complete_meeting_tx` marks the meeting completed, upserts one ordered `connections` row per participant pair with `on conflict do nothing`, upserts one `albums` row per meeting, and returns `{connection_count, album_id}` so repeated calls return the same result.

- [x] **Step 4: Add deterministic seed data**

Insert the existing `COMPANIES`, `MEETINGS` and `PLANS` values as Korean seed rows using stable UUIDs. Add one active demo code with a short expiry only for local development; production codes are inserted through the Dashboard and never committed.

- [ ] **Step 5: Run schema and local database checks** _(코드·Node 테스트 완료 · Supabase 배포 후 라이브 검증 필요)_

Run: `node --test tests/edge-functions.test.mjs`; expected PASS. When Supabase CLI is available, run `supabase db reset` and confirm the migration applies without SQL errors and seeded companies/meetings are visible in the local Table Editor. Confirm the **Email** provider is enabled in the Dashboard (Authentication → Providers, default on); anonymous sign-ins are not used.

- [x] **Step 6: Commit**

```bash
git add supabase/migrations/0001_initial.sql supabase/seed.sql tests/edge-functions.test.mjs
git commit -m "feat: 네트워킹 데이터 스키마와 RLS 추가"
```

### Task 3: 사번 기반 발표 로그인과 프로필 저장

> 2026-09-02 변경: 익명 세션 + 본명·닉네임 방식은 동명이인을 구분하지 못하고 다른 기기에서 이어 쓸 수 없어, **입장 코드 + 계열사 + 사번 + 이름**으로 결정적 계정에 로그인하는 방식으로 바꿨다. 사번은 본인 행에만 저장되고 다른 사용자·LLM에 노출되지 않는다 (spec §2.1).

**Files:**
- Create: `supabase/functions/_shared/cors.ts`
- Create: `supabase/functions/_shared/supabase.ts` (`callerClient`, `anonClient`, `serviceClient`, `requireUser`)
- Create: `supabase/functions/_shared/auth.ts`
- Create: `supabase/functions/demo-login/index.ts`
- Create: `supabase/migrations/0002_employee_identity.sql` (`(company_id, employee_no)` 유니크 인덱스)
- Modify: `src/index.html`
- Modify: `tests/backend-contract.test.mjs`, `tests/edge-functions.test.mjs`

**Interfaces:**
- `POST /functions/v1/demo-login` request: `{ code, company_id, employee_no, real_name, nickname? }`; no JWT (function deployed with `--no-verify-jwt`).
- Success response: `{ session: { access_token, refresh_token }, is_new: boolean, expires_at: string }`.
- Error response: `{ error_code: "INVALID_CODE" | "EXPIRED_CODE" | "CODE_EXHAUSTED" | "NAME_MISMATCH" | "RATE_LIMITED" | "BAD_REQUEST" }` with HTTP 401/429/400.
- Pure helpers in `_shared/auth.ts`: `hashCode`, `evaluateCode`, `isRateLimited`, `sessionExpiry`, `normalizeEmployeeNo`, `normalizeName`, `syntheticEmail(company_id, employee_no)`, `derivePassword(secret, email)` (HMAC-SHA256).
- Browser functions: `enterDemo()` → `callFn('demo-login')` → `sb.auth.setSession(session)` → `loadProfile()` → `afterLogin()`; `saveProfile()`, `loadProfile()`.

- [x] **Step 1: Add failing contract tests**

Extend `tests/backend-contract.test.mjs` to require `src/index.html` to call `demo-login` and `setSession`, to have inputs for 입장 코드·계열사(select)·사번·이름·닉네임, to lock the profile company select in backend mode, and to show Korean messages for expired code and name mismatch; assert `signInAnonymously` is absent. Extend `tests/edge-functions.test.mjs` with `normalizeEmployeeNo`/`normalizeName`/`syntheticEmail`/`derivePassword` cases.

- [x] **Step 2: Run the test to verify it fails**

Run: `node --test tests/backend-contract.test.mjs tests/edge-functions.test.mjs`
Expected: FAIL because the login function and entry screen do not exist.

- [x] **Step 3: Implement server login**

In `demo-login`: respond to `OPTIONS`; rate-limit by IP hash via `demo_entry_attempts` (20 per 10 min → 429); validate `company_id` against `companies`; verify the code hash and `evaluateCode`; look up the existing profile by `(company_id, employee_no)` and reject `NAME_MISMATCH` if the stored `real_name` differs; `consume_demo_code`; build `syntheticEmail` and `derivePassword(DEMO_LOGIN_SECRET, email)`; create the auth user with `auth.admin.createUser({ email_confirm: true })` or update the existing user's password; sign in server-side with `anonClient().auth.signInWithPassword`; insert the profile on first login; insert `demo_sessions`; return the session tokens.

- [x] **Step 4: Add the entry screen without changing existing tab markup**

Add an initial overlay in `src/index.html` (shown only when `BACKEND` and no stored session/profile) with QR 안내 문구, 6자리 코드 input, 계열사 select, 사번·이름·닉네임 inputs, and a 48px CTA. On success, `setSession`, load the profile into `S.profile`, hide the overlay, and call `afterLogin()`. Show `is_new`-dependent welcome toast. Lock the profile tab's company select in backend mode and show "이름 · 계열사 (로그인 정보)".

- [ ] **Step 5: Run browser contract and manual flow checks** _(코드·Node 테스트 완료 · Supabase 배포 후 라이브 검증 필요)_

Run: `node --test tests/*.mjs`. Manual (after deployment): submit an invalid code, then a valid code with 계열사·사번·이름; refresh and confirm the session/profile are restored; log in from a second device with the same 3 values and confirm the same rooms appear; log in with the same 사번 but a different 이름 and confirm `NAME_MISMATCH`.

- [x] **Step 6: Commit** _(커밋 완료)_

```bash
git add src/index.html supabase/functions/demo-login supabase/functions/_shared supabase/migrations/0002_employee_identity.sql tests
git commit -m "feat: 사번 기반 발표 로그인으로 전환"
```

### Task 4: LLM 매칭 Edge Function

**Files:**
- Create: `supabase/functions/_shared/llm.ts`
- Create: `supabase/functions/_shared/recommendation.ts`
- Create: `supabase/functions/recommend-meetings/index.ts`
- Modify: `src/index.html`
- Modify: `tests/edge-functions.test.mjs`

**Interfaces:**
- `POST /functions/v1/recommend-meetings` request: `{}`; identity comes from the caller JWT.
- Success response: `{ recommendations: Recommendation[]; candidates: Candidate[]; model: string; fallback: boolean }`.
- `Recommendation`: `{ meeting_id: string; rank: number; reason: string; cautions: string[] }`.
- `Candidate`: `{ id, title, emoji, region, when_label, capacity, tags, member_count, known_count, joined }` — everything the card needs so the browser does not query meetings separately.
- Pure helper: `buildRecommendationPrompt(profile, candidates): {system, user}`.
- Pure helper: `parseRecommendations(raw, candidateIds): Recommendation[]` (throws `INVALID_LLM_OUTPUT`).
- Pure helper: `deterministicOrder(candidates, profile): Recommendation[]` (fallback).

- [x] **Step 1: Write failing pure-function tests**

Add tests for: prompt excludes `employee_no`/`real_name`; parser rejects unknown meeting IDs; parser removes duplicate ranks; parser accepts a valid Korean reason; malformed JSON throws `INVALID_LLM_OUTPUT`; deterministic fallback puts region matches first and respects `direction`.

- [x] **Step 2: Run tests to verify they fail**

Run: `node --test tests/edge-functions.test.mjs`
Expected: FAIL because `_shared/recommendation.ts` does not exist.

- [x] **Step 3: Implement prompt and parser**

Define the prompt input as sanitized profile fields (`company`, `region`, `age_band`, `interests`, `hobbies`, `group_size`, `matching_preferences`) and candidate summaries (`id`, `title`, `region`, `member_count`, `known_member_ratio`, `tags`). Require JSON only and instruct the model to rank every candidate and give a one-sentence Korean reason each.

`parseRecommendations` must parse the first JSON object, keep only candidate IDs, sort by ascending rank, re-number ranks from 1, and require a non-empty `reason` of at most 160 characters. Throw `INVALID_LLM_OUTPUT` when no valid recommendation remains.

- [x] **Step 4: Implement OpenRouter client**

Use `fetch('https://openrouter.ai/api/v1/chat/completions')` with `Authorization: Bearer ${apiKey}`, the model passed in from `index.ts` (`Deno.env.get('OPENROUTER_MODEL') ?? 'openrouter/free'`), `temperature: 0.2`, `response_format: {type:'json_object'}`, and a 20-second `AbortController` timeout. Retry once on timeout/HTTP 5xx/429. Do not log prompts, responses, API keys, or profile names.

- [x] **Step 5: Implement the function and fallback**

Fetch the caller profile, prior connections (service client), and open meetings. Filter out full/cancelled meetings and enforce the profile’s region-first ordering, scope, and group-size constraints. Call the LLM once, retry once on invalid JSON, then fall back to `deterministicOrder`. Store only model, status, fallback, latency, and returned IDs in `ai_recommendation_runs`.

- [x] **Step 6: Connect the matching tab**

In backend mode, `renderMatch()` calls `loadRecommendations()` and renders `candidates` in `recommendations` order. Keep the existing orange known-member bar and show the LLM `reason` in the existing AI 추천 이유 box. While waiting, disable duplicate calls; on `fallback:true`, show a small Korean 안내 문구 without breaking the cards. Local demo mode keeps the current local sort.

- [ ] **Step 7: Run tests and local function checks** _(코드·Node 테스트 완료 · Supabase 배포 후 라이브 검증 필요)_

Run: `node --test tests/*.mjs`; expected PASS. After deployment: call `recommend-meetings` with a valid session and confirm the response matches the JSON contract. Test invalid output with a stubbed OpenRouter response and confirm fallback is returned.

- [x] **Step 8: Commit**

```bash
git add supabase/functions/_shared supabase/functions/recommend-meetings src/index.html tests/edge-functions.test.mjs
git commit -m "feat: OpenRouter LLM 매칭 추천 연결"
```

### Task 5: 모임 참가·Realtime 익명 채팅

**Files:**
- Modify: `src/index.html`
- Create: `supabase/functions/_shared/chat.ts` (익명화 helper는 Task 6과 공유)
- Modify: `tests/backend-contract.test.mjs`

**Interfaces:**
- Browser `joinMeet(id)` in backend mode inserts `meeting_members` (duplicate = no-op) and refreshes rooms.
- Browser `subscribeRoom(meetingId)` subscribes to `postgres_changes` on `messages` and `meeting_plans` filtered by `meeting_id`.
- Browser `sendMsg()` inserts a message after trimming to 500 characters.
- RPC `room_members(p_meeting_id)` returns nickname/avatar/company and `real_name` only when connected or the meeting is completed.

- [x] **Step 1: Write failing static contracts**

Assert that `src/index.html` contains `supabase.channel` (or `.channel(`), `meeting_members`, `room_members`, `room_summaries`, and a 500-character message limit. Assert that existing `joinMeet`, `sendMsg`, and `openRoom` remain present so the current demo controls continue to work.

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/backend-contract.test.mjs`
Expected: FAIL because the current functions only mutate `S`.

- [x] **Step 3: Connect join and room loading**

Make `joinMeet(id)` insert the authenticated user into `meeting_members`, handle a duplicate insert as a no-op, then call `renderRooms()`. Make `renderRooms()` call `room_summaries()` instead of only `S.joined`; preserve the existing empty-state copy.

- [x] **Step 4: Add Realtime subscription and message insert**

On `openRoom(id)`, fetch `room_members`, the last 50 messages, the latest plan, render them, and subscribe to `postgres_changes` for `public.messages` and `public.meeting_plans` filtered by `meeting_id=eq.${id}`. Remove the channel in `closeRoom()`. On send, trim whitespace, reject empty input, insert, clear the input, and render the inserted message exactly once (dedupe by message id).

- [x] **Step 5: Preserve anonymous naming rules**

Only `room_members` exposes `real_name`, and only for connected users or completed meetings. Never select `real_name` from `profiles` for other users in the browser.

- [x] **Step 6: Verify and commit** _(커밋 완료 · 배포 후 수동 검증 항목은 docs/deployment.md §7)_

Run: `node --test tests/*.mjs`. After deployment: open two browser windows with two demo sessions, join the same meeting, send messages in both directions, close/reopen the room, and confirm messages persist and rooms do not cross-talk.

```bash
git add src/index.html supabase/functions/_shared/chat.ts tests/backend-contract.test.mjs
git commit -m "feat: 모임 참가와 실시간 익명 채팅 연결"
```

### Task 6: AI 약속 추천과 만남 완료 상태

**Files:**
- Create: `supabase/functions/suggest-meeting-plan/index.ts`
- Create: `supabase/functions/complete-meeting/index.ts`
- Modify: `src/index.html`
- Modify: `tests/edge-functions.test.mjs`

**Interfaces:**
- `POST /functions/v1/suggest-meeting-plan` request: `{ meeting_id: string }`.
- Success response: `{ plan: { id, place, time, activity, nearby: string[] }, fallback: boolean }`; the plan is also inserted into `meeting_plans`.
- `POST /functions/v1/complete-meeting` request: `{ meeting_id: string }`.
- Success response: `{ revealed: true; connection_count: number; album_id: string }`.
- Pure helpers in `_shared/chat.ts`: `anonymizeMessages(messages, memberIds, {limit:30, maxLen:300})`, `buildPlanPrompt(meeting, anonymized)`, `parsePlan(raw)`.

- [x] **Step 1: Write failing tests for chat minimization**

Test that `anonymizeMessages` keeps only the latest 30 messages, truncates each to 300 characters, replaces sender IDs with `참가자1`… labels, and that `buildPlanPrompt` output never contains a sender UUID or the string `employee_no`. Test that `parsePlan` rejects missing fields.

- [x] **Step 2: Run tests to verify they fail**

Run: `node --test tests/edge-functions.test.mjs`
Expected: FAIL because the helpers do not exist.

- [x] **Step 3: Implement `suggest-meeting-plan`**

Verify the caller is a meeting member, fetch the latest 30 messages, build a Korean JSON-only prompt, call the shared OpenRouter client, validate all four fields, insert the plan into `meeting_plans`, and return it. Use a static fallback plan when both attempts fail. Never store raw chat content in `ai_recommendation_runs`.

- [x] **Step 4: Implement `complete-meeting`**

Verify the caller is a member, call `complete_meeting_tx(meeting_id)`, and return the resulting `connection_count` and `album_id`. Retrying the request returns the same values.

- [x] **Step 5: Connect existing UI controls and add the AI 전송 안내**

Make `aiPlan()` call `suggest-meeting-plan` and render the returned card (other members receive it via Realtime). Let `confirmPlan()` update `meeting_plans.confirmed`. Make the existing “만남 완료 (데모)” button call `complete-meeting`, then run the current veil animation, reload `room_members` (now with real names), open the album, and refresh home planet/connection counts through `my_connections()`. Add the notice **"AI 추천 약속 잡기를 누르면 최근 대화 일부가 익명 처리되어 외부 AI에 전송됩니다"** to the `＋` sheet item in both modes.

- [x] **Step 6: Verify and commit** _(커밋 완료 · 배포 후 수동 검증 항목은 docs/deployment.md §7)_

Run `node --test tests/*.mjs`. After deployment, manually complete the core flow: join → chat → AI plan → confirm → complete meeting → reveal → home planet lit. Repeat the completion click and confirm no duplicate satellites appear.

```bash
git add supabase/functions/suggest-meeting-plan supabase/functions/complete-meeting src/index.html tests/edge-functions.test.mjs
git commit -m "feat: AI 약속 추천과 만남 완료 연결"
```

### Task 7: 발표 모드 안정화와 데모 초기화

**Files:**
- Modify: `src/index.html`
- Create: `supabase/functions/reset-demo/index.ts`
- Create: `docs/deployment.md`
- Modify: `tests/backend-contract.test.mjs`

**Interfaces:**
- `POST /functions/v1/reset-demo` request: `{}` with header `x-demo-reset-token`; only the server-side `DEMO_RESET_TOKEN` may call it.
- Success response: `{ reset: true }`; 403 otherwise.
- Browser query parameter `?admin=1` reveals the reset control on the profile tab (backend mode only).

- [x] **Step 1: Add failure-mode tests**

Add Node tests for visible Korean messages when Supabase is unreachable, OpenRouter falls back, and the session expires. Add a test that no raw prompt is written to the frontend source.

- [x] **Step 2: Implement reset function**

Delete demo-created `messages`, `meeting_members`, `meeting_plans`, `connections`, `albums`, `demo_sessions`, and non-seed profiles; reset `meetings.status` to `open`; keep companies, meetings, and seed data. Require the reset token and return 403 for missing/invalid tokens.

- [x] **Step 3: Add loading, retry, and reset UI**

Add a global network error toast with "다시 시도" wording, session-expired handling that returns to the entry overlay, and a presentation-only reset control hidden unless `?admin=1` is present. Keep all controls at least 44px high.

- [x] **Step 4: Document deployment and QR creation**

In `docs/deployment.md`, document: create two Supabase projects, confirm the Email provider, apply migrations, seed only development data, set Edge Function secrets, deploy functions, fill `CONFIG` in `src/index.html`, create a QR for the public URL, create a short-lived demo code via SQL, charge OpenRouter credit and check model ID/limits, and perform the five-step regression flow from `AGENTS.md`. Explicitly state that no secret key belongs in GitHub Pages.

- [x] **Step 5: Verify and commit** _(커밋 완료 · 배포 후 수동 검증 항목은 docs/deployment.md §7)_

Run: `node --test tests/*.mjs`. After deployment, test the app with network throttling, expired sessions, and an invalid OpenRouter key; each case must show a recovery message rather than a blank screen.

```bash
git add src/index.html supabase/functions/reset-demo docs/deployment.md tests
git commit -m "feat: 발표 모드 오류 처리와 데모 초기화 추가"
```

### Task 8: 25명 파일럿 전환 점검 (P2 — 제출 후)

**Files:**
- Modify: `supabase/migrations/` (새 마이그레이션 파일 추가)
- Modify: `src/index.html`
- Modify: `docs/deployment.md`
- Create: `tests/pilot-security.test.mjs`

**Interfaces:**
- Pilot configuration uses `DEMO_MODE=false`, a separate Supabase project URL, a selected team-code or email-magic-link verifier, and the same `recommend-meetings` response contract.
- Public client continues to use only `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
- 사번(`employee_no`)은 이 단계에서만 인증 후 저장한다.

- [ ] **Step 1: Write security regression tests**

Test that `src/index.html` contains no secret key patterns, that profile queries do not select `real_name` for room lists, that LLM request builders omit employee numbers and names, and that `DEMO_MODE=false` hides the reset control.

- [ ] **Step 2: Tighten pilot RLS**

Add policies so a user can read only their own private profile fields, meeting members can read only the nickname/public profile projection of other members, and only completed meetings expose connection names. Verify policies with two separate local Auth users.

- [ ] **Step 3: Add consent and deletion controls**

Add a Korean consent step before the first AI request explaining that anonymized profile/chat excerpts are sent to an external LLM provider. Add a profile deletion action that removes the user’s profile, messages, memberships, albums, and connections through an authenticated Edge Function.

- [ ] **Step 4: Configure model/privacy limits**

Set the OpenRouter model ID through a secret, disable prompt/output logging, select providers consistent with the project’s retention requirements, and add a daily request counter per user. Use fallback recommendations when the free-model limit is reached.

- [ ] **Step 5: Verify pilot checklist and commit**

Run all Node tests. Perform a two-user privacy test, a 25-user seed load test, and a manual QR session test on iOS Safari and Android Chrome at 375×812. Record the result in `docs/deployment.md`.

```bash
git add supabase/migrations src/index.html docs/deployment.md tests/pilot-security.test.mjs
git commit -m "fix: 25명 파일럿 접근과 개인정보 정책 보강"
```

## 전체 완료 기준

- 백엔드 설정이 비어 있으면 기존 로컬 데모가 네트워크 요청 없이 그대로 동작한다.
- 공용 QR 하나로 여러 사용자가 동시에 발표용 세션을 만들 수 있다.
- 만료·잘못된 입장 코드는 세션을 만들지 않는다.
- 프로필 변경 후 LLM 추천 결과와 추천 이유가 갱신된다.
- LLM이 존재하지 않는 모임을 추천하지 않으며, 장애 시 fallback이 표시된다.
- 같은 모임의 채팅은 Realtime으로 전달되고 다른 모임에는 노출되지 않는다.
- AI 약속 추천·확정·만남 완료·베일 벗기기·사진첩·홈 행성 점등이 하나의 흐름으로 동작한다.
- 본명이 연결되지 않은 사용자 화면과 LLM 요청에 노출되지 않는다.
- 발표 프로젝트와 파일럿 프로젝트가 분리되고, GitHub Pages에 비밀 키가 없다.
- 기존 `tests/responsive-ui.test.mjs`와 새 계약·순수 함수 테스트가 모두 `node --test tests/*.mjs`로 통과한다.
