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

**장소 후보 추천은 프런트엔드 배포 전에 `0017_place_recommendations.sql`까지 적용하고 `suggest-meeting-plan`, `complete-meeting` Edge Function을 함께 배포해야 합니다.** 추천 전용 컬럼·확정 차단과 일정 독립 체크인을 추가합니다. DB → Edge Function → 프런트엔드 순서로 적용하고, 방장·일반 멤버 두 계정에서 후보 추천·재접속·Realtime·상호 만남 완료를 확인하세요.

`db push`는 `supabase/migrations/` 의 마이그레이션을 0015까지 순서대로 적용합니다 (테이블·RLS·Realtime publication·RPC 포함).


## 3. Edge Function 배포

비밀값 등록 (값은 셸 히스토리에 남지 않게 주의):

```bash
# OpenAI 키는 Dashboard → Edge Functions → Secrets에 OPENAI_API_KEY로 등록한다.
# 모델은 _shared/openai.ts의 gpt-5.4-mini로 고정되어 있다.
npx supabase secrets set DEMO_RESET_TOKEN=<길고 무작위인 문자열>
npx supabase secrets set DEMO_LOGIN_SECRET=<길고 무작위인 다른 문자열>
```

권장 — 장소 후보를 **실재하는 장소로 검증**하는 카카오 로컬 API 키 (https://developers.kakao.com → 앱 만들기 → **REST API 키**). 없으면 GPT 장소 추천을 생략하고 검색 실패 안내를 제공합니다:

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

## 6. OpenAI 확인 (발표 전날·당일 — 모임·장소 추천)

- Supabase Dashboard → Edge Functions → Secrets에 사용자 소유 키를 `OPENAI_API_KEY`로 등록합니다. 채팅·소스·셸 명령에 실제 키를 적지 않습니다. 기존 `OPENROUTER_API_KEY`와 `OPENROUTER_MODEL`은 두 추천 함수에서 사용하지 않습니다.
- OpenAI 프로젝트의 사용 한도와 `gpt-5.4-mini` 호출 권한을 확인하고, 위 §3 절차로 `recommend-meetings`와 `suggest-meeting-plan`을 배포합니다. 키 등록만으로 코드가 배포되지는 않습니다.
- 매칭 응답의 `model: gpt-5.4-mini`, `fallback: false`를 확인합니다. 같은 입력은 서버 인스턴스 내 60초 캐시를 사용할 수 있습니다.
- 카카오 REST 키를 등록하고 후보 카드의 실제 장소·좌표와 `fallback: false`를 확인합니다. 검색 결과가 없으면 GPT를 호출하지 않습니다.
- 키 누락·401·429·시간 초과가 발생하면 기본 결과로 대체됩니다. `ai_recommendation_runs`의 `model`, `fallback`, `error_type`, `latency_ms`와 함수 로그의 토큰 수를 확인합니다.
- 요청은 `store: false`이며 사용자 프로필의 실명·사번은 넣지 않습니다. 대화 본문 자체에 적힌 개인정보는 자동 제거되지 않으므로 실제 임직원 데이터 사용 전 별도 검토가 필요합니다.

## 7. 발표 전 회귀 체크리스트 (375×812, 실제 아이폰 권장)

1. QR 접속 → 입장 화면에서 잘못된 코드 → 한국어 오류 문구 확인
2. 올바른 코드 + 계열사 + 사번 + 이름 + 닉네임 → 홈 탭 진입, 새로고침 후에도 세션·프로필 유지
2-1. **다른 기기**에서 같은 계열사·사번·이름으로 로그인 → 같은 프로필·참가 모임·채팅이 복원되는지, 같은 사번에 **다른 이름**을 넣으면 "사번과 이름이 일치하지 않아요"가 나오는지
3. 매칭 탭 → 로딩 후 추천 카드가 뜨고 모임 상세에서 **개인화된 추천 이유**가 보임. API 오류 시 기본 순서 안내 확인
4. 모임 `참가` → 채팅 탭에 방 생성, 두 번째 기기로 같은 모임 참가 후 양방향 메시지 수신
5. 채팅방 `AI 장소 추천` → 후보별 이유·지도·상세 비교 → `이곳 어때요?` → 초안 수정·전송 → 재추천 → 홈 가이드 완료 확인
6. `＋` 메뉴 `만남 완료` → 베일 애니메이션 → 실명·계열사 표시, 사진첩 열림
7. 홈 탭 → 행성 점등·연결된 동료 수 증가. 만남 완료를 한 번 더 눌러도 중복 증가 없음
8. 프로필 탭에서 선호 지역 변경 → 매칭 탭 재요청 시 순서 변화
9. `?admin=1` → 발표 데이터 초기화 → 토큰 입력 → 초기 상태 복귀
10. 비행기 모드로 잠깐 끊었을 때 빈 화면이 아니라 "네트워크 오류 · 다시 시도" 안내가 나오는지

## 8. 발표 후 정리

- `reset-demo`로 발표 데이터를 비우거나, 발표용 프로젝트를 일시 정지(Pause)합니다. `reset-demo`는 프로필·채팅은 지우지만 Auth 계정(`계열사.사번@demo.moonlight.local`)은 남깁니다. 계정까지 지우려면 Dashboard → Authentication → Users에서 삭제합니다. 남아 있어도 다음 로그인 때 자동으로 재사용됩니다.
- 입장 코드를 만료(`update demo_access_codes set active=false`)시킵니다.
- 파일럿으로 넘어갈 때는 별도 프로젝트(`moonlight-pilot`)와 별도 OpenAI 키를 사용하고, 실행 계획 Task 8의 동의·삭제 절차를 먼저 붙입니다.

## 장소 추천 회귀 확인

`npm test`는 후보 요청·오류·초안·XSS·가이드 완료와 PGlite DB의 확정 차단·참여 권한·상호 체크인을 검증합니다. 이전 마이그레이션 계약 테스트는 데이터 이력 확인용으로 남겨 둡니다.

모바일(375×812)과 웹(1440×1000)에서 참가 → 후보 요청 → 추천 이유 읽기 → 의견 초안 수정·전송 → 재추천을 확인합니다. 검색 실패·빈 결과·지도 SDK 실패에도 목록과 재시도가 동작해야 합니다. 데모는 실제 장소를 검증하지 않으므로 운영에서는 카카오 상세 링크와 주소, 두 계정의 접근 권한도 별도로 확인합니다.

브라우저 검증 재현(선택): Python Playwright와 Chromium·WebKit을 설치하고 저장소 루트에서 `python3 -m http.server 8766 --bind 127.0.0.1`을 실행한 뒤 `python3 tests/manual/place-recommendations-browser.py`, `python3 tests/manual/place-recommendations-states.py`를 실행합니다. 첫 스크립트는 네트워크 없는 데모 흐름을, 두 번째는 모의 서버 응답으로 320·375·768·1440px의 5개 후보, 키보드 선택, 지도 SDK 실패, 검색 실패·빈 결과·재시도를 검사합니다. 운영 API 품질 검증을 대신하지 않습니다.
