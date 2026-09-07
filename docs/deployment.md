# 배포 절차와 발표 체크리스트

MoonLight Hanwha를 GitHub Pages + Supabase + OpenAI 조합으로 배포하는 순서입니다. 설계 근거는 [백엔드 설계 문서](superpowers/specs/2026-09-02-supabase-openrouter-backend-design.md), 작업 단위는 [실행 계획](superpowers/plans/2026-09-02-supabase-openrouter-backend-plan.md)을 참고합니다.

> **원칙:** GitHub Pages(`src/`)에는 Supabase URL과 publishable/anon 키만 들어갑니다. Supabase secret key, OpenAI API 키, 초기화 토큰은 **Edge Function 비밀값에만** 둡니다. `CONFIG`가 비어 있으면 앱은 네트워크 없이 로컬 데모 모드로 동작하므로, 아래 절차가 끝나지 않아도 발표 데모는 깨지지 않습니다.

## 빠른 방법 — 스크립트 한 번

§1의 프로젝트 생성만 대시보드에서 마친 뒤, **저장소 루트(`hanwha-ai-solution` 폴더) 안에서** 실행합니다. 상위 폴더에서 실행하면 "-File 매개 변수에 대한 인수 ... 이(가) 없습니다" 오류가 납니다.

```bash
cd C:\Users\user\AI\Games\hanwha-ai-solution
```

```bash
powershell -ExecutionPolicy Bypass -File scripts\deploy-supabase.ps1 -ProjectRef <프로젝트 ref>
```

`-ProjectRef`를 생략하면 실행 중에 물어봅니다.

프로젝트 ref와 OpenAI 키(화면에 안 보임)를 물어본 뒤 §2~§3(로그인·연결·마이그레이션·비밀값·함수 배포)을 순서대로 실행합니다. 끝나면 초기화 토큰을 한 번 보여주고 남은 수동 단계(§2 시드, §4 입장 코드, §5 `CONFIG`)를 안내합니다. 아래는 같은 내용을 손으로 할 때의 절차입니다.

## 0. 준비물

- Supabase 계정 (무료 플랜으로 충분)
- 사용자 소유 OpenAI API 키와 `gpt-5.4-mini` 호출이 가능한 API 프로젝트
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
# OpenAI 키는 Dashboard → Edge Functions → Secrets에 OPENAI_API_KEY로 등록한다.
# 모델은 _shared/openai.ts의 gpt-5.4-mini로 고정되어 있다.
npx supabase secrets set DEMO_RESET_TOKEN=<길고 무작위인 문자열>
npx supabase secrets set DEMO_LOGIN_SECRET=<길고 무작위인 다른 문자열>
```

권장 — 약속 후보지를 **실재하는 장소로 검증**하는 카카오 로컬 API 키 (https://developers.kakao.com → 앱 만들기 → **REST API 키**). 없으면 GPT 장소 추천을 생략하고 검색 실패 안내와 기본 카드를 제공합니다:

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

호출 제한 설정과 배포 전 검증은 [입장 시도 제한](login-rate-limit.md)을 확인합니다.

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

## 6. OpenAI 확인 (발표 전날·당일 — 모임·약속 추천)

- Supabase Dashboard → Edge Functions → Secrets에 사용자 소유 키를 `OPENAI_API_KEY`로 등록합니다. 채팅·소스·셸 명령에 실제 키를 적지 않습니다. 기존 `OPENROUTER_API_KEY`와 `OPENROUTER_MODEL`은 두 추천 함수에서 사용하지 않습니다.
- OpenAI 프로젝트의 사용 한도와 `gpt-5.4-mini` 호출 권한을 확인하고, 위 §3 절차로 `recommend-meetings`와 `suggest-meeting-plan`을 배포합니다. 키 등록만으로 코드가 배포되지는 않습니다.
- 매칭 응답의 `model: gpt-5.4-mini`, `fallback: false`를 확인합니다. 같은 입력은 서버 인스턴스 내 60초 캐시를 사용할 수 있습니다.
- 카카오 REST 키를 등록하고 약속 카드의 실제 장소·좌표와 `fallback: false`를 확인합니다. 검색 결과가 없으면 GPT를 호출하지 않습니다.
- 키 누락·401·429·시간 초과가 발생하면 기본 결과로 대체됩니다. `ai_recommendation_runs`의 `model`, `fallback`, `error_type`, `latency_ms`와 함수 로그의 토큰 수를 확인합니다.
- 요청은 `store: false`이며 사용자 프로필의 실명·사번은 넣지 않습니다. 대화 본문 자체에 적힌 개인정보는 자동 제거되지 않으므로 실제 임직원 데이터 사용 전 별도 검토가 필요합니다.

## 7. 발표 전 회귀 체크리스트 (375×812, 실제 아이폰 권장)

1. QR 접속 → 입장 화면에서 잘못된 코드 → 한국어 오류 문구 확인
2. 올바른 코드 + 계열사 + 사번 + 이름 + 닉네임 → 홈 탭 진입, 새로고침 후에도 세션·프로필 유지
2-1. **다른 기기**에서 같은 계열사·사번·이름으로 로그인 → 같은 프로필·참가 모임·채팅이 복원되는지, 같은 사번에 **다른 이름**을 넣으면 "사번과 이름이 일치하지 않아요"가 나오는지
3. 매칭 탭 → 로딩 후 추천 카드가 뜨고 모임 상세에서 **개인화된 추천 이유**가 보임. API 오류 시 기본 순서 안내 확인
4. 모임 `참가` → 채팅 탭에 방 생성, 두 번째 기기로 같은 모임 참가 후 양방향 메시지 수신
5. `＋` → `약속 잡기 · 시간과 장소` → 날짜 범위 설정 → 장소 추천 → 시간표 드래그·장소 선택·저장 → 다른 기기 응답 → 방장 비교·최종 확정 → 채팅 반영
6. 상단 배너 `만남 완료 (데모)` → 베일 애니메이션 → 실명·계열사 표시, 사진첩 열림
7. 홈 탭 → 행성 점등·연결된 동료 수 증가. 만남 완료를 한 번 더 눌러도 중복 증가 없음
8. 프로필 탭에서 선호 지역 변경 → 매칭 탭 재요청 시 순서 변화
9. `?admin=1` → 발표 데이터 초기화 → 토큰 입력 → 초기 상태 복귀
10. 비행기 모드로 잠깐 끊었을 때 빈 화면이 아니라 "네트워크 오류 · 다시 시도" 안내가 나오는지

## 8. 발표 후 정리

- `reset-demo`로 발표 데이터를 비우거나, 발표용 프로젝트를 일시 정지(Pause)합니다. `reset-demo`는 프로필·채팅은 지우지만 Auth 계정(`계열사.사번@demo.moonlight.local`)은 남깁니다. 계정까지 지우려면 Dashboard → Authentication → Users에서 삭제합니다. 남아 있어도 다음 로그인 때 자동으로 재사용됩니다.
- 입장 코드를 만료(`update demo_access_codes set active=false`)시킵니다.
- 파일럿으로 넘어갈 때는 별도 프로젝트(`moonlight-pilot`)와 별도 OpenAI 키를 사용하고, 실행 계획 Task 8의 동의·삭제 절차를 먼저 붙입니다.

## 기존 가능 시간 조율 (#33) 배포·검증 (이전 흐름)

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


### 시간표 통합 변경 적용

- `0016_unified_scheduling.sql`까지 DB 마이그레이션을 적용한 뒤 `suggest-meeting-plan` Edge Function과 프런트엔드를 함께 배포합니다. 기본 모임의 방장 권한 처리에 필요합니다.
- 러닝 모임에서 “오늘은 뛰지 말고 닭발 먹자”라는 대화를 보내고, 새 약속에서 실제 닭발 식당 후보가 나오는지 확인합니다. 의도 분석 실패 시 일반 식당·카페 안내가 표시되는지도 확인합니다.
- 모바일에서 시간표 드래그 → 장소 선택·저장 → 다른 참여자 응답 → 방장 비교·확정 → 채팅의 만남 완료 순서로 검증합니다. 실제 LLM 의미 판단과 카카오 결과는 배포 환경의 키·데이터에 따라 확인해야 합니다.

모바일 통합 검증은 Playwright와 Chromium을 준비하고 저장소 루트에서 `python3 -m http.server 8047` 실행 후 `node tests/manual/scheduling-browser.mjs`로 재현합니다.
