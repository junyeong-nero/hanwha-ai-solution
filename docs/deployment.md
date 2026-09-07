# 배포 절차와 발표 체크리스트

MoonLight Hanwha를 GitHub Pages + Supabase + OpenRouter 조합으로 배포하는 순서입니다. 설계 근거는 [백엔드 설계 문서](superpowers/specs/2026-09-02-supabase-openrouter-backend-design.md), 작업 단위는 [실행 계획](superpowers/plans/2026-09-02-supabase-openrouter-backend-plan.md)을 참고합니다.

> **원칙:** GitHub Pages(`src/`)에는 Supabase URL과 publishable/anon 키만 들어갑니다. Supabase secret key, OpenRouter API 키, 초기화 토큰은 **Edge Function 비밀값에만** 둡니다. `CONFIG`가 비어 있으면 앱은 네트워크 없이 로컬 데모 모드로 동작하므로, 아래 절차가 끝나지 않아도 발표 데모는 깨지지 않습니다.

## 빠른 방법 — 스크립트 한 번

§1의 프로젝트 생성만 대시보드에서 마친 뒤, **저장소 루트(`hanwha-ai-solution` 폴더) 안에서** 실행합니다. 상위 폴더에서 실행하면 "-File 매개 변수에 대한 인수 ... 이(가) 없습니다" 오류가 납니다.

```bash
cd C:\Users\user\AI\Games\hanwha-ai-solution
```

```bash
powershell -ExecutionPolicy Bypass -File scripts\deploy-supabase.ps1 -ProjectRef <프로젝트 ref>
```

`-ProjectRef`를 생략하면 실행 중에 물어봅니다.

프로젝트 ref와 OpenRouter 키(화면에 안 보임)를 물어본 뒤 §2~§3(로그인·연결·마이그레이션·비밀값·함수 배포)을 순서대로 실행합니다. 끝나면 초기화 토큰을 한 번 보여주고 남은 수동 단계(§2 시드, §4 입장 코드, §5 `CONFIG`)를 안내합니다. 아래는 같은 내용을 손으로 할 때의 절차입니다.

## 0. 준비물

- Supabase 계정 (무료 플랜으로 충분)
- OpenRouter 계정과 API 키 (`sk-or-v1-...`) — **소액 크레딧 충전 권장** (무료 모델 일일 한도가 낮아 리허설로 소진될 수 있음)
- Supabase CLI: `npx --yes supabase` 사용
- 이 저장소의 `main` 브랜치가 GitHub Pages로 배포 중: `https://junyeong-nero.github.io/hanwha-ai-solution/src/`

## 1. Supabase 프로젝트 만들기 (발표용)

1. https://supabase.com/dashboard → **New project** → 이름 `moonlight-demo`, 리전 `Northeast Asia (Seoul)`.
2. 생성 후 **Project Settings → API**에서 두 값을 메모합니다.
   - `Project URL` → `SUPABASE_URL`
   - `publishable` key (`sb_publishable_...`) 또는 레거시 `anon` 키 → `SUPABASE_ANON_KEY`
   - `service_role` / `secret` key → `SUPABASE_SECRET_KEY` (**브라우저에 절대 넣지 않음**)
3. **Authentication → Providers → Email**이 켜져 있는지 확인합니다(기본값 켜짐). 계정은 `demo-login` 함수가 서버에서 만들고 바로 확인 처리하므로 확인 메일 설정은 상관없습니다. 익명 로그인은 쓰지 않으니 꺼 두어도 됩니다.
4. (선택) Authentication → Rate Limits에서 로그인(token) 한도를 발표 인원(예: 시간당 300)에 맞게 조정합니다.

파일럿 단계에서는 같은 절차로 `moonlight-pilot` 프로젝트를 하나 더 만들어 데이터를 분리합니다.

## 2. 스키마·시드 적용

로컬에서 저장소 루트 기준:

```bash
npx supabase login
npx supabase link --project-ref <프로젝트 ref>
npx supabase db push
```

**의견 제출 기능(#32)은 프런트엔드 반영 전에 `0014_meeting_responses.sql`까지 적용해야 합니다.** 새 Edge Function이나 비밀 키는 필요하지 않습니다. 기존 `meeting_plans`와 `messages`의 Realtime publication을 그대로 사용합니다. 의견 테이블은 직접 접근을 막고 인증된 RPC로만 조회·저장합니다. 배포 확인 시 방장·참여자 두 계정으로 링크 재접속, 응답 수정, 방장 확정과 다른 기기 채팅의 즉시 반영을 확인하세요.

`db push`는 `supabase/migrations/` 의 마이그레이션을 0015까지 순서대로 적용합니다 (테이블·RLS·Realtime publication·RPC 포함).

> **선택 — 지난 약속 자동 확정 주기 실행**
> 약속 시간이 지난 카드는 멤버가 채팅방을 열 때 `settle_due_plans` 가 확정합니다. 아무도 방을 열지 않아도 정리되게 하려면
> `pg_cron` 확장을 켠 뒤 SQL Editor에서 아래를 한 번 실행하세요(서비스 역할 전용 함수라 브라우저에서는 호출되지 않습니다).
>
> ```sql
> select cron.schedule('settle-due-plans', '*/10 * * * *', $$select public.settle_all_due_plans()$$);
> ```

시드 데이터(계열사 25개, 모임 7개)는 Dashboard → **SQL Editor**에서 `supabase/seed.sql` 내용을 붙여 넣어 실행합니다. 시드에 들어 있는 로컬용 입장 코드 `123456`은 **발표에서 쓰지 말고** 아래 4단계에서 새 코드를 만듭니다.

확인: Table Editor에서 `companies` 25행, `meetings` 7행이 보이면 됩니다.

## 3. Edge Function 배포

비밀값 등록 (값은 셸 히스토리에 남지 않게 주의):

```bash
npx supabase secrets set OPENROUTER_API_KEY=<sk-or-v1-...>
npx supabase secrets set OPENROUTER_MODEL=openrouter/free
npx supabase secrets set DEMO_RESET_TOKEN=<길고 무작위인 문자열>
npx supabase secrets set DEMO_LOGIN_SECRET=<길고 무작위인 다른 문자열>
```

권장 — 약속 후보지를 **실재하는 장소로 검증**하는 카카오 로컬 API 키 (https://developers.kakao.com → 앱 만들기 → **REST API 키**). 없으면 OpenRouter 웹 검색 플러그인(요청당 약 $0.02, 크레딧 필요)을, 그것도 안 되면 검색 없이 진행합니다(후보지는 "검색 미확인"으로 표시됩니다):

```bash
npx supabase secrets set KAKAO_REST_KEY=<카카오 REST API 키>
```

> **키 두 개를 구분하세요 (이슈 #34).**
> - **REST API 키 = 서버 전용.** 장소 검색에만 쓰이며 Edge Function 비밀값으로만 둡니다. 브라우저·저장소에 들어가면 안 됩니다 (`npm test` 의 `plan-map` 테스트가 `KakaoAK`·`KAKAO_REST_KEY=` 노출을 잡습니다).
> - **JavaScript 키 = 공개용.** 지도를 그리는 데만 쓰며 `src/js/config.js` 의 `CONFIG.KAKAO_JS_KEY` 에 넣습니다. 같은 콘솔의 **앱 설정 → 플랫폼 → Web** 에 배포 도메인(`https://junyeong-nero.github.io`)과 로컬 주소를 등록해 다른 사이트에서 쓰지 못하게 막습니다.
>
> `KAKAO_JS_KEY` 가 비어 있으면 지도는 좌표를 상대 위치로 환산한 placeholder 로 그려지고, 후보 비교·선택은 그대로 동작합니다.

`DEMO_LOGIN_SECRET`은 사번 기반 계정의 비밀번호를 파생하는 서버 비밀키입니다. 유출되면 사번만으로 남의 세션을 만들 수 있으니 32자 이상 무작위 값을 쓰고 저장소에 넣지 않습니다.

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`는 Supabase가 Edge Function에 **자동으로 주입**합니다. `SUPABASE_` 접두사는 `secrets set`으로 등록할 수 없으니 직접 넣지 않습니다 (코드는 `SUPABASE_SECRET_KEY`가 없으면 자동 주입된 `SUPABASE_SERVICE_ROLE_KEY`를 사용합니다).

함수 배포:

```bash
npx supabase functions deploy demo-login --no-verify-jwt
npx supabase functions deploy recommend-meetings
npx supabase functions deploy suggest-meeting-plan
npx supabase functions deploy complete-meeting
npx supabase functions deploy reset-demo --no-verify-jwt
```

`demo-login`은 로그인 전에 호출되므로 JWT 검증을 끄고 입장 코드·레이트리밋으로 보호합니다. `reset-demo`는 자체 토큰 헤더(`x-demo-reset-token`)로 보호합니다. 나머지 세 함수는 로그인 세션의 JWT가 필요합니다.

## 4. 발표용 입장 코드 만들기

Dashboard → SQL Editor에서 실행 (코드는 발표 직전에 새로 만들고, 저장소에 커밋하지 않습니다):

```sql
insert into public.demo_access_codes (code_hash, expires_at, max_uses)
values (encode(extensions.digest('482913', 'sha256'), 'hex'), now() + interval '6 hours', 200);
```

`482913` 자리에 원하는 6자리 숫자를 넣습니다. 발표 화면에는 이 숫자를 크게 띄웁니다. 만료되면 같은 SQL로 새 코드를 넣으면 됩니다.

## 5. 프론트엔드 연결과 QR

1. `src/js/config.js` 상단의 `CONFIG`를 채웁니다. `KAKAO_JS_KEY`는 도메인을 등록한 **JavaScript 키**이며, 비워 두면 지도만 placeholder로 대체됩니다.
   ```js
   const CONFIG={SUPABASE_URL:'https://<ref>.supabase.co',SUPABASE_ANON_KEY:'<anon 키>',KAKAO_JS_KEY:'<카카오 JavaScript 키>',DEMO_MODE:true};
   ```
2. Node.js 24 이상에서 `npm test`가 통과하는지 확인합니다 (비밀 키가 HTML에 들어가면 `backend-contract` 테스트가 실패합니다). Node 24 미만이면 테스트 명령이 원인을 한국어로 안내하고 종료합니다.
3. 커밋·푸시하면 GitHub Pages가 자동 재배포됩니다 (1~2분).
4. 공용 주소 `https://junyeong-nero.github.io/hanwha-ai-solution/src/`로 QR을 만듭니다 (아무 QR 생성기나 가능). 관리자용 주소는 `.../src/?admin=1` 입니다.

## 6. OpenRouter 확인 (발표 전날·당일 — 약속 추천 전용)

- https://openrouter.ai/models 에서 `OPENROUTER_MODEL`에 넣은 모델 ID가 아직 유효한지 확인합니다. `openrouter/free`가 불안정하면 가용한 특정 `:free` 모델 ID로 secret을 바꾸고 함수를 재배포합니다.
- https://openrouter.ai/settings/credits 에서 크레딧과 남은 한도를 확인합니다. 무료 한도만으로는 리허설 + 본방을 버티기 어렵습니다.
- **실측 (2026-09-03):** 크레딧 없는 계정에서 `google/gemma-4-31b-it:free`는 첫 호출만 성공(18초)하고 연속 호출은 곧바로 `HTTP 429`(분당 한도)로 fallback이 났습니다. `openrouter/free` 라우터는 약속 추천에 24초 만에 성공했습니다. 발표 중 카드마다 20초 안팎이 걸리므로 **크레딧을 충전하고 유료 모델(예: `google/gemini-2.5-flash`)로 바꾸는 것이 가장 확실**합니다. 모델 변경은 `npx supabase secrets set OPENROUTER_MODEL=<모델 ID>` 한 줄이며 재배포는 필요 없습니다.
- `response_format`이나 system 역할을 지원하지 않는 모델이 400을 내면 함수가 자동으로 호환 모드(둘 다 제거)로 한 번 더 시도합니다. 그래도 실패하면 fallback 추천이 뜹니다.
- https://openrouter.ai/settings/privacy 에서 프롬프트 로깅이 꺼져 있는지, 가능하면 학습 거부(ZDR) 제공자만 쓰도록 설정합니다.
- OpenRouter 는 이제 **약속 추천(`suggest-meeting-plan`)에서만** 씁니다. 모임 추천(`recommend-meetings`)은 규칙 엔진이라 키·크레딧·모델 상태와 무관하게 즉시 응답하고 fallback 도 없습니다.
- 약속 카드 응답에 `fallback: true`가 자주 나오면 채팅방에 "기본 제안" 배지가 붙습니다. 이 상태로 발표하면 "AI 활용" 시연이 약해지므로 사전에 잡습니다.

## 7. 발표 전 회귀 체크리스트 (375×812, 실제 아이폰 권장)

1. QR 접속 → 입장 화면에서 잘못된 코드 → 한국어 오류 문구 확인
2. 올바른 코드 + 계열사 + 사번 + 이름 + 닉네임 → 홈 탭 진입, 새로고침 후에도 세션·프로필 유지
2-1. **다른 기기**에서 같은 계열사·사번·이름으로 로그인 → 같은 프로필·참가 모임·채팅이 복원되는지, 같은 사번에 **다른 이름**을 넣으면 "사번과 이름이 일치하지 않아요"가 나오는지
3. 매칭 탭 → 추천 카드가 **대기 없이 바로** 뜨고 **추천 이유**가 보임 (추천은 규칙 엔진이라 LLM 지연·fallback 안내가 없음)
4. 모임 `참가` → 채팅 탭에 방 생성, 두 번째 기기로 같은 모임 참가 후 양방향 메시지 수신
5. `＋` → `AI 추천 약속 잡기` → 카드 도착 (다른 기기에도 Realtime으로 표시) → 후보지 지도에 Marker 여러 개, 목록 카드를 누르면 Marker가 함께 강조되는지 → `이 장소로 정하기` 를 누르면 다른 기기의 만남 장소도 같이 바뀌는지 → `이 약속으로 확정`
5-1. 후보지가 비거나(검색 결과 없음) 카카오 할당량이 걸리면 카드 아래에 이유와 대체 검색어 안내가 뜨는지 (지도 없이도 약속 카드는 그대로 동작)
6. 상단 배너 `만남 완료 (데모)` → 베일 애니메이션 → 실명·계열사 표시, 사진첩 열림
7. 홈 탭 → 행성 점등·연결된 동료 수 증가. 만남 완료를 한 번 더 눌러도 중복 증가 없음
8. 프로필 탭에서 선호 지역 변경 → 매칭 탭 재요청 시 순서 변화
9. `?admin=1` → 발표 데이터 초기화 → 토큰 입력 → 초기 상태 복귀
10. 비행기 모드로 잠깐 끊었을 때 빈 화면이 아니라 "네트워크 오류 · 다시 시도" 안내가 나오는지

## 8. 발표 후 정리

- `reset-demo`로 발표 데이터를 비우거나, 발표용 프로젝트를 일시 정지(Pause)합니다. `reset-demo`는 프로필·채팅은 지우지만 Auth 계정(`계열사.사번@demo.moonlight.local`)은 남깁니다. 계정까지 지우려면 Dashboard → Authentication → Users에서 삭제합니다. 남아 있어도 다음 로그인 때 자동으로 재사용됩니다.
- 입장 코드를 만료(`update demo_access_codes set active=false`)시킵니다.
- 파일럿으로 넘어갈 때는 별도 프로젝트(`moonlight-pilot`)와 별도 OpenRouter 키를 사용하고, 실행 계획 Task 8의 동의·삭제 절차를 먼저 붙입니다.

## 가능 시간 조율 (#33) 배포·검증

1. `0013_plan_availability.sql` 마이그레이션을 먼저 적용합니다.
2. 방장 ID 응답이 추가된 `suggest-meeting-plan` Edge Function을 배포한 뒤 프런트엔드를 배포합니다.
3. 서로 다른 사용자로 같은 약속을 열어 가능 시간을 각각 저장하고, 실시간 집계·방장 후보 선택·전원 확정을 확인합니다. 운영 Supabase에서 이 확인은 별도로 필요합니다.

기본 순수 함수 회귀는 `npm test`에 포함됩니다. SQL과 모바일 통합 검증을 재현하려면 임시 개발 패키지(`npm install --no-save --package-lock=false playwright @electric-sql/pglite`)와 Chromium(`npx playwright install chromium`)을 준비합니다. SQL 검증은 `node tests/manual/availability-sql.mjs`, 모바일 검증은 저장소 루트에서 `python3 -m http.server 8033`을 실행한 뒤 `node tests/manual/availability-browser.mjs`입니다. SQL 검증은 최소 Auth·약속 스키마에 실제 마이그레이션을 적용하는 PGlite 테스트이며, 운영 RLS·네트워크 Realtime 검증을 대신하지 않습니다.
### 안 읽은 메시지 배지 (#12)

프런트엔드 배포 전에 `0012_room_unread.sql` 마이그레이션을 적용합니다. `meeting_members.last_read_at`, `mark_room_read` RPC와 `room_summaries.unread_count`가 함께 필요합니다. 기존 회원은 참가 이후 받은 메시지부터 안 읽은 것으로 집계됩니다.

두 계정으로 같은 모임에 참가한 뒤, 한 계정은 방을 닫고 다른 계정에서 메시지를 보내 목록 미리보기·방 배지·하단 합계가 갱신되는지 확인합니다. 방을 열면 읽음이 저장되고, 새로고침해도 유지되어야 합니다. 앱을 숨긴 채 받은 메시지와 재연결 중 받은 메시지도 확인합니다.

### UX 후속 마이그레이션 (0015)

모임 나가기·확정 투표 취소·멤버 관심사는 `0015_leave_unvote_member_interests.sql` 적용이 필요합니다. 기존 `0012_room_unread.sql`과 번호가 겹치지 않도록 0015로 정리했습니다. 프론트엔드 머지와 별도로 `npx supabase db push`로 적용합니다.

### 다른 Supabase 프로젝트로 새로 설정하기

기존 데이터 이전 없이 시작할 때는 새 프로젝트를 만든 계정으로 `npx --yes supabase login`한 뒤 다음 명령을 실행합니다. DB 비밀번호만으로는 함수 배포·비밀값 등록 권한을 대신할 수 없습니다.

```bash
npx --yes supabase link --project-ref <새-project-ref>
npx --yes supabase db push --dry-run --include-seed
npx --yes supabase db push --include-seed
npx --yes supabase functions deploy --project-ref <새-project-ref> --use-api
```

함수 호출 전에 새 프로젝트의 Secrets에 OpenRouter 키·모델과 별도로 생성한 `DEMO_LOGIN_SECRET`·`DEMO_RESET_TOKEN`을 등록합니다. 카카오 REST 키를 사용한다면 함께 등록합니다. 시드의 공개 개발용 입장 코드는 비활성화하고 새 입장 코드를 만듭니다. `src/js/config.js`의 URL과 공개 키를 함께 바꾼 뒤 실제 로그인·추천·채팅을 확인하고 push합니다. `.env`만 바꿔서는 정적 앱의 연결이 변경되지 않습니다.

현재 연결 대상은 `vcmlqiovovflrkkjbzlt`입니다. 기존 프로젝트의 계정·대화는 자동 복사하지 않습니다. 새 프로젝트 테스트는 `?demo=1`이 없는 URL로 진행해야 합니다.
