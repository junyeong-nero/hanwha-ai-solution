// complete-meeting — 개인별 만남 완료 체크인. attend_meeting_tx RPC 를 호출자 권한으로 실행해
// 호출자를 체크인하고, 이미 체크인한 다른 멤버와 연결 쌍을 만들고, 사진첩을 준비한다.
// 멤버 전원이 체크인하면 모임이 completed 로 바뀐다. 재호출해도 결과가 같다.
// 요청: POST { meeting_id }  (Authorization: Bearer <세션 JWT>)
// 응답: 200 { attended: true, attended_count, member_count, connection_count, album_id }
//       / 403 NOT_MEMBER / 409 PLAN_NOT_CONFIRMED
import { preflight, json, fail, errorResponse, readJsonBody, isUuid } from '../_shared/cors.ts';
import { requireUser } from '../_shared/supabase.ts';

const FN = 'complete-meeting';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'POST 요청만 받을 수 있어요');

  try {
    // RPC 는 호출자 스코프 클라이언트로 실행한다 — 멤버 여부는 함수 안에서 auth.uid() 로 검사한다.
    const { client } = await requireUser(req);
    const body = await readJsonBody(req);
    const meetingId = body.meeting_id;
    if (!isUuid(meetingId)) return fail(400, 'BAD_REQUEST', 'meeting_id 가 필요해요');

    const { data, error } = await client.rpc('attend_meeting_tx', { p_meeting_id: meetingId });
    if (error) {
      const notMember = error.code === '42501' || /모임 멤버가 아닙니다/.test(error.message ?? '');
      if (notMember) return fail(403, 'NOT_MEMBER', '이 모임의 멤버만 만남 완료를 체크인할 수 있어요');
      // 약속이 확정되기 전부터 멤버였어야 체크인할 수 있다 (실명은 실제로 만난 사람에게만)
      const noPlan = error.code === '55000' || /확정된 약속이 있어야/.test(error.message ?? '');
      if (noPlan) return fail(409, 'PLAN_NOT_CONFIRMED', '확정된 약속이 있어야 만남 완료를 체크인할 수 있어요');
      throw error;
    }

    const result = (typeof data === 'string' ? JSON.parse(data) : data) as
      | { attended_count?: number; member_count?: number; connection_count?: number; album_id?: string }
      | null;
    if (!result || !result.album_id) throw new Error('체크인 결과가 비어 있어요');

    return json({
      attended: true,
      attended_count: Number(result.attended_count ?? 0),
      member_count: Number(result.member_count ?? 0),
      connection_count: Number(result.connection_count ?? 0),
      album_id: result.album_id,
    });
  } catch (err) {
    return errorResponse(err, FN);
  }
});
