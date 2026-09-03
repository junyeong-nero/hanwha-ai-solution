// reset-demo — 발표용 데이터를 초기화한다. 사용자 JWT 대신 x-demo-reset-token 헤더로 인증한다.
// 요청: POST {}  (x-demo-reset-token: <DEMO_RESET_TOKEN>)
// 응답: 200 { reset: true } / 403 FORBIDDEN
// 계열사 · 모임 · 입장 코드(시드)는 남기고, 모임 상태만 open 으로 되돌린다.
import { preflight, json, fail, errorResponse } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/supabase.ts';
import { safeEqual } from '../_shared/auth.ts';

const FN = 'reset-demo';

// 삭제 순서와 각 테이블의 "모든 행" 필터 컬럼 (supabase-js 는 필터 없는 delete 를 막는다)
const TABLES: Array<{ table: string; column: string }> = [
  { table: 'messages', column: 'id' },
  { table: 'meeting_plan_votes', column: 'plan_id' },
  { table: 'meeting_attendance', column: 'meeting_id' },
  { table: 'meeting_plans', column: 'id' },
  { table: 'connections', column: 'id' },
  { table: 'albums', column: 'id' },
  { table: 'meeting_members', column: 'user_id' },
  { table: 'demo_sessions', column: 'id' },
  { table: 'ai_recommendation_runs', column: 'id' },
  { table: 'demo_entry_attempts', column: 'id' },
  { table: 'profiles', column: 'user_id' },
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'POST 요청만 받을 수 있어요');

  try {
    const expected = Deno.env.get('DEMO_RESET_TOKEN') ?? '';
    const provided = req.headers.get('x-demo-reset-token') ?? '';
    if (!expected || !(await safeEqual(provided, expected))) {
      return fail(403, 'FORBIDDEN', '초기화 권한이 없어요');
    }

    const svc = serviceClient();
    for (const { table, column } of TABLES) {
      const { error } = await svc.from(table).delete().not(column, 'is', null);
      if (error) throw error;
    }

    // 사용자가 직접 만든 모임은 지우고, 시드 모임은 open 으로 되돌린다
    const { error: userMeetingsError } = await svc.from('meetings').delete().not('created_by', 'is', null);
    if (userMeetingsError) throw userMeetingsError;
    const { error: meetingsError } = await svc.from('meetings').update({ status: 'open' }).neq('status', 'open');
    if (meetingsError) throw meetingsError;

    return json({ reset: true });
  } catch (err) {
    return errorResponse(err, FN);
  }
});
