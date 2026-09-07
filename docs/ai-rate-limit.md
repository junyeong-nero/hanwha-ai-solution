# AI 호출 예산 (#15, 운영 기준 후속 #31)

`0018_ai_request_limits.sql` 적용 후 `recommend-meetings`와 `suggest-meeting-plan`을 배포합니다. #16의 로그인 마이그레이션과 독립적입니다. 서버 환경변수로만 아래 값을 조정합니다.

| 설정 | 기본값 | 범위 |
| --- | --- | --- |
| `AI_USER_WINDOW_LIMIT` | 10 | 사용자·함수별 10분, 1~100 |
| `AI_MEETING_WINDOW_LIMIT` | 3 | 약속 추천 모임별 10분, 1~100 |
| `AI_DAILY_REQUEST_LIMIT` | 1000 | 두 함수 합계 UTC 하루, 1~100000 |

10분은 첫 허용 요청부터 시작하는 고정 창입니다. 창 경계 전후에는 최대 두 배의 요청이 허용될 수 있습니다. 일일 한도는 UTC 자정에 초기화됩니다. 잘못된 설정은 기본값을 씁니다. DB에서 한도를 검사하고 원자적으로 예약한 뒤 외부 API를 호출하므로 여러 인스턴스의 동시 호출도 상한을 넘지 않습니다. 오류·실패·기존 인스턴스 캐시 적중도 보수적으로 한 번 소비하며, 거부 요청은 소비하지 않습니다. 만료된 카운터는 다음 요청 시 정리합니다.

한도 초과 또는 예산 DB 오류 시 모임 추천은 **외부 호출 없는 규칙 추천**(`rate_limited: true`)을 반환합니다. 약속 추천은 외부 검색·LLM·약속 INSERT 전에 **429 RATE_LIMITED**와 한국어 안내를 반환하며 기존 약속은 유지합니다. 새로고침이나 함수 직접 호출로도 같은 예산을 사용합니다. 모임 추천의 기존 60초 캐시는 최신 프로필·후보가 같을 때 재사용하지만 인스턴스 간 공유 캐시는 아닙니다.

Supabase SQL Editor에서 다음으로 예산 사용량을 확인합니다(관리자 전용, 사용자에게 공개하지 않음).

```sql
select scope, used, expires_at from public.ai_request_budgets order by expires_at;
select function_name, success, fallback, error_type, count(*)
from public.ai_recommendation_runs
where created_at >= now() - interval '1 day'
group by function_name, success, fallback, error_type;
```

이 한도는 **기능 실행 예약 횟수**이며 토큰·금액 한도가 아닙니다. 약속 한 번에 의도 분석과 약속 생성의 여러 LLM 요청·내부 재시도·카카오 검색이 발생할 수 있으므로 실제 비용은 공급자 Dashboard와 함께 확인합니다. 개발·발표 환경에서 낮은 한도로 초과 동작을 확인한 뒤 발표 인원에 맞게 조정합니다. 가격·사용량 운영 정책과 영속 결과 캐시의 확장은 #31에서 다룹니다.
