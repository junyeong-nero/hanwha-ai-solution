// complete-meeting — complete_meeting_tx RPC 를 호출자 권한으로 실행해 만남 완료·연결·사진첩을 처리한다.
// 요청: POST { meeting_id }  (Authorization: Bearer <세션 JWT>)
// 응답: 200 { revealed: true, connection_count, album_id } / 403 NOT_MEMBER
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

    const { data, error } = await client.rpc('complete_meeting_tx', { p_meeting_id: meetingId });
    if (error) {
      const notMember = error.code === '42501' || /모임 멤버가 아닙니다/.test(error.message ?? '');
      if (notMember) return fail(403, 'NOT_MEMBER', '이 모임의 멤버만 만남을 완료할 수 있어요');
      throw error;
    }

    const result = (typeof data === 'string' ? JSON.parse(data) : data) as
      | { connection_count?: number; album_id?: string }
      | null;
    if (!result || !result.album_id) throw new Error('완료 결과가 비어 있어요');

    return json({
      revealed: true,
      connection_count: Number(result.connection_count ?? 0),
      album_id: result.album_id,
    });
  } catch (err) {
    return errorResponse(err, FN);
  }
});
