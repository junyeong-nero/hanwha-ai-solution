# MoonLight Hanwha Supabase·OpenRouter 백엔드 설계

> 2026-09-02 검토 반영본. 변경 요지: 이중 모드(로컬 데모/백엔드) 원칙 추가, 발표 단계 사번 미수집, §5.1 순서 정정, supabase-js 로딩 방침, 사진 업로드 범위 제외, 무료 모델 한도 대응, AI 전송 고지 시점, 운영 체크리스트 신설.

## 1. 목적과 범위

현재 `src/index.html`은 전역 `S` 객체와 하드코딩된 상수로 동작하는 프론트엔드 데모다. 이 설계는 다음 두 단계의 백엔드 도입을 정의한다.

1. 발표 단계: 공용 QR로 접속하고, 화면에 표시한 임시 입장 코드로 발표용 세션을 만든다.
2. 파일럿 단계: 같은 화면 흐름을 유지하면서 약 25명의 팀원이 사용할 수 있도록 인증·보안·데이터 보존을 강화한다.

범위는 Supabase 기반 인증·데이터·실시간 채팅·사진첩 메타데이터와, Supabase Edge Function에서 OpenRouter LLM을 호출하는 AI 매칭 및 약속 추천이다. 기존 기능 명세(`docs/features.md`)의 4개 탭과 핵심 사용자 흐름을 유지한다.

### 1.1 이중 모드 원칙 (발표 안전장치)

- `src/index.html`은 **백엔드 설정이 비어 있으면 지금과 동일한 로컬 데모 모드**로 동작한다. 네트워크 요청이 없고 모든 데이터는 브라우저 안에서만 움직인다.
- 설정(`SUPABASE_URL`, `SUPABASE_ANON_KEY`)이 채워지면 **백엔드 모드**로 전환되어 Supabase·Edge Function·OpenRouter를 사용한다.
- 두 모드는 같은 화면·같은 상태 객체 `S`를 쓰고, 데이터 출처만 다르다. 백엔드 연결이 발표 전에 끝나지 않아도 데모는 깨지지 않는다.

## 2. 결정 사항

### 2.1 발표 인증

- 모든 사용자는 하나의 공용 QR로 GitHub Pages의 앱 주소에 접속한다.
- 발표 화면에 6자리 임시 입장 코드를 표시한다. 입장 코드는 서버에서 만료 시간·활성화 여부·사용 횟수·레이트리밋을 확인한다.
- 사용자는 **입장 코드 + 계열사 + 사번 + 이름**(처음이면 닉네임)을 입력한다. 익명 세션은 브라우저마다 다른 사용자가 되어 **동명이인을 구분할 수 없고 다른 기기에서 이어 쓸 수도 없으므로** 쓰지 않는다.
- `demo-login` Edge Function이 (계열사, 사번)으로 **결정적 계정**을 만들거나 찾는다. 로그인 이메일은 `계열사.사번@demo.moonlight.local`, 비밀번호는 서버 비밀키 `DEMO_LOGIN_SECRET`로 파생한 HMAC 값이라 클라이언트는 알 수 없다. 함수가 서버에서 대신 로그인해 세션(access/refresh token)만 내려주고, 클라이언트는 `setSession`으로 받는다.
- 같은 (계열사, 사번)이면 어느 기기·브라우저에서든 같은 계정이라 **프로필·참가 모임·채팅·연결 이력이 그대로 복원**된다.
- (계열사, 사번)에 이미 프로필이 있는데 입력한 이름이 다르면 `NAME_MISMATCH`로 거부한다. 사번만 아는 제3자가 남의 계정에 들어가는 것을 어느 정도 막는다.
- **사번 보호:** `profiles.employee_no`는 본인 행에만 저장되고 RLS로 본인만 조회한다. 다른 사용자에게 노출되는 RPC(`room_members`, `my_connections`)와 LLM 프롬프트에는 사번을 넣지 않는다. `(company_id, employee_no)` 유니크 인덱스로 한 사번에 프로필 하나만 대응한다.
- 이 방식은 발표용 접근 제어이지 사내 SSO 수준의 신원 인증은 아니다. 화면에 발표용 체험이라는 점과 사번의 용도(본인 확인·데이터 복원)를 명시한다.

### 2.2 파일럿 인증 확장

- 발표 UI를 바꾸지 않고 인증 검증부만 교체할 수 있도록 `demo`와 `pilot` 모드를 분리한다.
- 파일럿에서는 공용 QR 뒤에 팀 코드 또는 이메일 매직 링크를 추가한다.
- 25명 규모에서는 이메일 매직 링크가 가능하면 우선 사용하고, 이메일 운영이 어려우면 만료되는 팀 코드를 사용한다.

### 2.3 LLM 추천

- 지역, 인원 범위, 계열사 범위 등 하드 제약은 서버에서 먼저 필터링한다.
- Edge Function이 익명화된 프로필과 후보 모임 요약을 OpenRouter에 전달한다.
- LLM은 후보 중 순위, 추천 이유, 주의사항을 JSON으로 반환한다.
- 서버는 반환된 모임 ID가 실제 후보인지 검증하고, 실패 시 재시도하거나 기본 정렬 결과로 대체한다.
- 모델 ID는 환경변수로 관리한다. 개발 초기에는 `openrouter/free`를 사용하고, 발표 재현성이 필요하면 가용한 특정 `:free` 모델을 고정한다. **배포 전 OpenRouter 모델 목록에서 해당 ID가 유효한지 확인한다.**
- **무료 모델 한도 대응:** 무료 모델은 계정당 일일 요청 한도가 매우 낮아 리허설만으로 소진될 수 있다. 발표 전 OpenRouter에 소액 크레딧을 충전해 한도를 올리고, 발표 직전 남은 한도를 확인하는 절차를 배포 체크리스트에 포함한다. 한도 초과 시에는 fallback 추천이 표시되지만, 이 경우 "AI 활용" 시연 자체가 무너지므로 fallback에 의존하지 않는다.

### 2.4 supabase-js 로딩 방침

- 백엔드 모드에서만 `@supabase/supabase-js` UMD 번들을 CDN(jsDelivr) `<script>`로 **동적 삽입**한다. 로컬 데모 모드에서는 스크립트가 삽입되지 않아 "외부 네트워크 요청 없음"이 그대로 유지된다.
- 단일 HTML 파일 원칙은 유지한다. 빌드 도구는 도입하지 않는다.
- `AGENTS.md`와 `README.md`의 "외부 라이브러리 없음" 규칙은 "로컬 데모 모드에서는 없음, 백엔드 모드에서는 supabase-js CDN 1개"로 갱신한다.

## 3. 시스템 구성

```text
GitHub Pages의 단일 HTML  (설정이 비면 로컬 데모 모드로 동작)
  ├─ Supabase Auth 세션 (demo-login 이 발급한 이메일·비밀번호 계정 세션)
  ├─ Supabase Database 조회·변경 (RLS 적용)
  ├─ Supabase Realtime 채팅·약속 구독
  └─ supabase-js (백엔드 모드에서만 CDN 동적 로드)

Supabase Edge Functions
  ├─ demo-login             입장 코드 검증 + (계열사, 사번, 이름) 결정적 계정 로그인
  ├─ recommend-meetings     프로필 기반 LLM 매칭
  ├─ suggest-meeting-plan   채팅 기반 약속 추천
  ├─ complete-meeting       만남 성사·연결 이력·사진첩 처리
  └─ reset-demo             발표용 데이터 초기화 (관리 토큰 필요)

OpenRouter API
  └─ LLM 호출(키는 Edge Function 비밀값에만 보관)
```

백엔드 모드에서는 "외부 네트워크 요청 없음" 전제가 바뀐다. GitHub Pages에는 공개 가능한 Supabase URL과 publishable/anon 키만 두고, Supabase secret key와 OpenRouter 키는 브라우저에 포함하지 않는다.

## 4. 데이터 모델

모든 테이블은 `auth.users.id`를 사용자 식별자로 사용한다. 실명·사번은 일반 사용자에게 직접 조회되지 않도록 RLS 정책을 별도로 둔다.

- `profiles`: `user_id`, `employee_no`(nullable, 파일럿 전용), `real_name`, `nickname`, `avatar`, `company_id`, `region`, `age`(정수; LLM 프롬프트에는 서버가 `20대 후반` 같은 연령대로 변환해 넣는다), `gender`, `mbti`, `interests`, `hobbies`, `group_size_min`, `group_size_max`, `matching_preferences`(jsonb: balance/scope/direction)
- `companies`: 계열사 코드·이름·행성 표시 정보
- `meetings`: 모임 제목·이모지·태그·지역·시간대 라벨·정원·상태
- `meeting_members`: 모임과 사용자 연결, 참가 시각, 역할. `(meeting_id, user_id)` 유니크
- `messages`: 모임 ID, 발신자 ID, 메시지 내용(500자 제한), 생성 시각. **Realtime publication에 등록**
- `meeting_plans`: 모임 ID, 추천 장소·시간·활동·주변 장소, 확정 여부, 생성자. **Realtime publication에 등록**
- `connections`: 만남이 성사된 사용자 쌍, 최초 만남 시각, 만남 모임 ID. **`user_a_id < user_b_id`로 정렬해 저장하고 `(user_a_id, user_b_id)` 유니크 제약**으로 중복 행을 막는다
- `albums`: 모임별 사진첩 1개. 발표 단계에서는 플레이스홀더 항목만 담는다(§10 참고)
- `demo_access_codes`: 코드 해시, 만료 시각, 활성 여부, 사용 횟수, 최대 사용 횟수
- `demo_sessions`: 익명 사용자 ID, 입장 코드 ID, 세션 만료 시각, 생성 시각
- `demo_entry_attempts`: 레이트리밋용. 시도 키(IP 해시 또는 코드 해시), 시도 시각. Edge Function에 내장 레이트리밋이 없으므로 이 테이블로 "키당 10분에 20회"를 계산한다
- `ai_recommendation_runs`: 사용자 ID, 함수 이름, 모델 ID, 추천 모임 ID 목록, 성공 여부, fallback 여부, 지연 시간, 오류 유형. 원문 프롬프트와 원문 응답은 저장하지 않는다

### 4.1 데이터베이스 함수(RPC)

브라우저가 실명·계열사를 안전하게 읽을 수 있도록, RLS로 표현하기 어려운 조회는 `security definer` 함수로 제공한다.

- `my_connections()`: 나와 연결된 사용자의 `user_id`, `real_name`, `nickname`, `avatar`, `company_id` — 홈 탭 행성 점등·위성 표시용
- `room_members(meeting_id)`: 해당 모임 멤버의 `user_id`, `nickname`, `avatar`, `company_id`, 그리고 **나와 연결되었거나 모임이 완료된 경우에만** `real_name` — 채팅 라벨용. 호출자가 멤버가 아니면 빈 결과
- `room_summaries()`: 내가 참가한 모임의 요약과 마지막 메시지 — 채팅 목록용
- `complete_meeting_tx(meeting_id)`: 모임 완료·연결 쌍 upsert·앨범 생성을 한 트랜잭션으로 처리. 재호출해도 결과가 같다(멱등)

## 5. 주요 데이터 흐름

### 5.1 발표 입장

1. QR로 앱에 접속한다. 저장된 세션이 있으면 바로 프로필을 불러오고 입장 화면을 건너뛴다.
2. 클라이언트가 `demo-login`에 `{ code, company_id, employee_no, real_name, nickname? }`를 보낸다 (로그인 전이므로 JWT 없음, 함수는 `verify_jwt=false`).
3. 함수가 레이트리밋 → 계열사 존재 → 입장 코드(만료·활성·횟수) → 기존 프로필의 이름 일치 순으로 검사한다.
4. 함수가 `계열사.사번` 이메일과 서버 파생 비밀번호로 계정을 만들거나(`auth.admin.createUser`) 기존 계정의 비밀번호를 맞춘 뒤, 서버에서 `signInWithPassword`로 세션을 받는다. 처음 입장이면 프로필 행(사번·계열사·이름·닉네임)을 만든다.
5. 함수가 `demo_sessions`에 코드와 계정을 결합하고 `{ session, is_new, expires_at }`를 돌려준다.
6. 클라이언트가 `setSession`으로 세션을 설정하고 프로필·연결·채팅 목록을 불러온 뒤 홈 탭을 연다. 다른 기기에서 같은 정보로 로그인해도 같은 데이터가 복원된다.

### 5.2 AI 매칭

1. 클라이언트가 `recommend-meetings`를 현재 사용자 세션으로 호출한다.
2. 함수가 사용자 프로필, 과거 연결 이력, 공개 가능한 후보 모임 정보를 조회한다.
3. 지역·정원·참가 상태 등 하드 제약으로 후보를 줄인다.
4. 사용자와 후보를 `meeting_id` 중심의 JSON으로 변환한다. 프로필에서는 계열사·지역·연령대·관심사·취미·모임 규모·성향만 넣는다.
5. OpenRouter LLM에 한국어 시스템 지시와 JSON 출력 스키마를 전달한다.
6. 응답을 파싱하고 후보 목록에 없는 ID를 제거한다.
7. 추천 결과와 추천 이유, 카드 렌더링에 필요한 후보 요약(제목·태그·지역·인원·아는 얼굴 수)을 함께 반환하고, 성공·실패 메타데이터만 기록한다.

### 5.3 채팅·약속·만남

- 모임 참가 시 `meeting_members`를 추가하고 채팅방 목록에 노출한다.
- 메시지는 `messages`에 저장하고 Realtime `postgres_changes`로 해당 방 구독자에게 전달한다.
- `suggest-meeting-plan`은 최근 30개 메시지를 익명화·길이 제한한 뒤 장소·시간·활동·주변 장소 JSON을 요청하고, 결과를 `meeting_plans`에 저장한다. 같은 방의 다른 멤버는 Realtime으로 카드를 받는다.
- 채팅 화면에는 **"AI 추천 약속 잡기를 누르면 최근 대화 일부가 익명 처리되어 외부 AI에 전송됩니다"** 안내를 발표 단계부터 표시한다.
- `complete-meeting`은 `complete_meeting_tx`를 호출해 연결 이력과 사진첩을 만들고, 이후 실명 표시와 홈 행성 점등의 기준을 갱신한다.

## 6. LLM 계약과 장애 처리

LLM 응답은 다음 필드를 필수로 한다.

```json
{
  "recommendations": [
    {
      "meeting_id": "meeting_12",
      "rank": 1,
      "reason": "추천 이유",
      "cautions": ["주의사항"]
    }
  ]
}
```

- 후보에 없는 `meeting_id`, 중복 순위, 빈 추천 이유는 서버에서 무효 처리한다.
- JSON 파싱 실패 시 동일 요청 1회 재시도한다.
- 재시도도 실패하면 후보의 결정적 정렬 결과와 기본 추천 안내를 사용한다.
- 무료 모델의 속도·가용성·일일 요청 제한을 고려해 중복 호출을 막고 결과를 짧은 시간 캐시한다.
- 응답에 `fallback: true`가 오면 화면에 "AI 응답이 지연되어 기본 추천을 보여드려요" 안내를 붙인다.

## 7. 보안·개인정보

- 브라우저에는 Supabase publishable/anon 키만 둔다. RLS 없이 데이터를 공개하지 않는다.
- OpenRouter 키와 Supabase secret key는 Edge Function 환경변수에만 둔다.
- LLM 프롬프트에는 사번·본명·이메일·전화번호·사진 URL을 넣지 않는다.
- 채팅 기반 약속 추천은 필요한 최근 대화만 보내고, **발표 단계부터** 사용자에게 AI 전송 사실을 화면에 알린다. 파일럿 단계에서는 첫 AI 요청 전 동의 절차를 추가한다.
- OpenRouter의 프롬프트 보관은 기본적으로 비활성이나, 실제 요청은 모델 제공자를 거치므로 제공자 정책을 확인하고 가능하면 ZDR/학습 거부 설정을 사용한다.
- 파일럿 전환 시 개인정보 수집 목적·보관 기간·삭제 방법을 안내하고, 테스트 종료 후 데이터를 삭제할 수 있도록 한다.
- Edge Function은 GitHub Pages origin에서 호출되므로 CORS 응답 헤더를 명시적으로 반환한다.

## 8. 단계별 구현 순서와 우선순위

제출 마감(2026-09-08 22:00)을 기준으로 우선순위를 나눈다. **코드는 P0·P1을 모두 작성하되, 실제 Supabase 배포·검증은 P0부터 순서대로 진행한다.** 어느 단계에서 멈추더라도 이중 모드 원칙 덕분에 발표 데모는 동작한다.

| 우선순위 | 범위 | 이유 |
| --- | --- | --- |
| **P0 — 발표 필수** | 골격·스키마·입장 코드·**LLM 매칭**(plan Task 1~4) | "AI 도구 활용" 평가 항목을 실제 LLM 호출로 실증하는 최소 범위 |
| **P1 — 발표 권장** | Realtime 채팅·AI 약속 추천·만남 완료·안정화(Task 5~7) | 두 번째 LLM 기능과 다인 실시간 시연. 시간이 허락하면 배포 |
| **P2 — 제출 후** | 25명 파일럿(Task 8), 사진 업로드 | 평가와 무관. 파일럿 시작 전 별도 일정으로 진행 |

### 단계 A — 더미 데이터 연결

1. Supabase 개발 프로젝트와 기본 스키마 생성
2. 기존 상수 데이터를 seed 데이터로 이전
3. 공용 QR 주소와 발표용 입장 코드 검증
4. 프로필 저장·매칭 목록 조회 연결
5. `recommend-meetings` Edge Function과 OpenRouter 호출
6. 모임 참가·채팅방 생성·Realtime 채팅 연결
7. AI 약속 추천·만남 완료·홈 상태 반영

### 단계 B — 발표 안정화

1. 모델 ID와 프롬프트를 환경변수/설정으로 고정
2. 응답 검증·재시도·기본 추천 fallback 구현
3. 데모 초기화 기능과 오류 안내 추가
4. 모바일 375×812 뷰포트에서 핵심 흐름 회귀 테스트
5. QR 접속, 새로고침, 네트워크 지연 상황 점검
6. OpenRouter 크레딧 충전·모델 ID 유효성·남은 한도 확인

### 단계 C — 25명 파일럿

1. 별도 Supabase 프로젝트로 분리
2. 팀원 접근 방식(이메일 매직 링크 또는 만료 팀 코드) 적용, 사번 수집은 이 단계에서만
3. RLS 정책과 실명 접근 규칙 점검
4. LLM 전송 데이터 최소화·동의 절차·삭제 기능 추가
5. 추천 선택률·채팅 참여·약속 확정·만남 완료를 익명 통계로 수집
6. 무료 모델 한도 초과 시 fallback 또는 일시적 기본 추천 제공

## 9. 검증 기준

- 백엔드 설정이 비어 있으면 네트워크 요청 없이 기존 로컬 데모가 그대로 동작한다.
- 같은 공용 QR로 두 명 이상이 동시에 입장할 수 있다.
- 입장 코드 만료 후 새 세션이 생성되지 않는다.
- 프로필 변경이 다음 추천 요청에 반영된다.
- LLM이 반환한 추천 모임이 실제 후보와 일치한다.
- LLM 장애 시 화면이 멈추지 않고 기본 추천을 보여준다.
- 한 채팅방의 메시지가 다른 방에 노출되지 않는다.
- 만남 완료 후 익명→실명 전환, 사진첩 생성, 홈 행성 점등이 함께 반영된다.
- 만남 완료를 두 번 호출해도 연결 행과 앨범이 중복 생성되지 않는다.
- 본명이 연결되지 않은 사용자 화면과 LLM 요청에 노출되지 않는다.

## 10. 범위에서 제외하는 것

- **사진 업로드(Supabase Storage)** — 발표 단계의 사진첩은 앨범 레코드와 플레이스홀더 이미지만 제공한다. 실제 업로드·Storage RLS·용량 관리는 파일럿 이후 별도 태스크로 설계한다
- 사내 SSO 연동
- 운영자용 복잡한 관리자 콘솔
- 자동 결제·알림톡·캘린더 연동
- 임베딩 기반 벡터 매칭
- 고가용성·대규모 트래픽 최적화

이 기능들은 25명 파일럿에서 사용성·추천 품질을 확인한 후 별도 설계한다.

## 11. 운영 체크리스트 (구현 시 반드시 걸리는 항목)

문서만 보고 구현하면 빠뜨리기 쉬운 Supabase·OpenRouter 설정을 모아 둔다. 상세 절차는 `docs/deployment.md`에 둔다.

- Supabase Dashboard → Authentication → Providers에서 **Email 제공자가 켜져 있어야** 한다(기본값). 계정은 `demo-login`이 admin API로 만들고 `email_confirm: true`로 생성하므로 확인 메일 설정은 무관하다. 익명 로그인은 쓰지 않는다.
- `demo-login`은 로그인 전에 호출되므로 `--no-verify-jwt`로 배포한다. `DEMO_LOGIN_SECRET`은 길고 무작위여야 하며, 바꾸면 기존 계정 비밀번호가 다음 로그인 때 자동으로 새 파생값으로 갱신된다.
- 마이그레이션에 `alter publication supabase_realtime add table public.messages, public.meeting_plans;`를 포함해야 Realtime `postgres_changes`가 동작한다.
- 모든 Edge Function은 `OPTIONS` 프리플라이트에 응답하고 `Access-Control-Allow-Origin` 등 CORS 헤더를 반환한다.
- `connections`는 `(least(a,b), greatest(a,b))` 순서로 저장하고 유니크 제약을 건다.
- 레이트리밋은 `demo_entry_attempts` 테이블 카운트로 구현한다.
- Edge Function 비밀값: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `DEMO_RESET_TOKEN`, `DEMO_LOGIN_SECRET`만 `supabase secrets set`으로 등록한다. `SUPABASE_URL`·`SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY`는 플랫폼이 자동 주입하며 `SUPABASE_` 접두사는 직접 등록할 수 없다.
- OpenRouter: 크레딧 충전 여부, 모델 ID 유효성, 발표 직전 남은 한도.
- GitHub Pages `src/index.html`의 `CONFIG`에는 URL과 anon 키만 넣는다. secret key·OpenRouter 키가 들어가면 `tests/backend-contract.test.mjs`가 실패한다.

## 12. 2026-09-03 2차 변경 (사용자 피드백 반영)

| 변경 | 설계 |
| --- | --- |
| 선호 지역 복수 선택 + 하드 필터 | `profiles.regions text[]` 추가(기존 `region`은 첫 항목으로 유지). `recommend-meetings`는 `region ∈ regions`인 열린 모임만 후보로 삼는다. 지역 밖 모임은 관심사가 맞아도 추천되지 않는다 |
| 프로필 저장 버튼 | 자동 저장을 없애고 변경 시 `저장` 버튼이 켜진다. 저장 시에만 `profiles` upsert와 추천 캐시 무효화 |
| 같은 성별 우선 | `matching_preferences.same_gender`(구 `balance` 대체). 서버가 후보별 `same_gender_ratio`(다른 멤버 중 같은 성별 비율)를 계산해 LLM 프롬프트와 결정적 정렬에 반영. 성별 미설정이면 무시 |
| 약속 확정 = 전원 투표 | `meeting_plan_votes(plan_id, meeting_id, user_id)`. 멤버가 직접 insert(RLS). 트리거 `confirm_plan_when_unanimous`가 투표 수 ≥ 멤버 수일 때 `meeting_plans.confirmed=true`. Realtime publication에 등록해 모든 멤버의 바가 함께 차오른다 |
| 만남 완료 = 개인별 체크인 | `meeting_attendance(meeting_id, user_id)` + RPC `attend_meeting_tx`. 내 출석을 기록하고 **이미 완료한 멤버와의 쌍만** `connections`에 넣는다. `room_members`는 연결된 상대에게만 `real_name`을 준다 → 같은 방이라도 사람마다 보이는 실명이 다르다. 전원 완료 시 `meetings.status='completed'`. `complete_meeting_tx`는 제거 |
| 장소 후보 실제 웹 검색 | `_shared/search.ts`: `KAKAO_REST_KEY`가 있으면 카카오 로컬 키워드 검색, 없으면 OpenRouter 웹 검색 플러그인(`plugins:[{id:'web'}]`, 크레딧 필요), 둘 다 없으면 검색 없이 진행. 결과는 프롬프트에 후보로 넣고 `meeting_plans.candidates jsonb`에 저장, 카드에 이름·주소·링크·이유로 표시 |
| 인재경영원 | 기본 지역 목록과 시드 모임(`…0007`)에 추가 |
