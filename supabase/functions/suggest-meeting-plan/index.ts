// suggest-meeting-plan — 최근 대화를 익명화해 OpenRouter LLM 에 보내고 약속 카드를 만든다.
// 요청: POST { meeting_id }  (Authorization: Bearer <세션 JWT>)
// 응답: 200 { plan: { id, place, time, activity, nearby }, fallback } / 403 NOT_MEMBER
import { preflight, json, fail, errorResponse, readJsonBody, isUuid } from '../_shared/cors.ts';
import { requireUser, serviceClient } from '../_shared/supabase.ts';
import { chatJson, LlmError } from '../_shared/llm.ts';
import { anonymizeMessages, buildPlanPrompt, parsePlan, fallbackPlan, type PlanSuggestion } from '../_shared/chat.ts';

const FN = 'suggest-meeting-plan';
const MESSAGE_LIMIT = 30;
const MESSAGE_MAX_LEN = 300;

function classifyError(err: unknown): string {
  if (err instanceof LlmError) return err.code === 'HTTP' ? `HTTP_${err.status ?? 0}` : err.code;
  if (err instanceof Error && err.message === 'INVALID_LLM_OUTPUT') return 'INVALID_LLM_OUTPUT';
  return 'UNKNOWN';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'POST 요청만 받을 수 있어요');

  const started = Date.now();
  try {
    const { user } = await requireUser(req);
    const body = await readJsonBody(req);
    const meetingId = body.meeting_id;
    if (!isUuid(meetingId)) return fail(400, 'BAD_REQUEST', 'meeting_id 가 필요해요');

    const svc = serviceClient();

    // 1. 멤버 확인
    const { data: membership, error: membershipError } = await svc
      .from('meeting_members')
      .select('meeting_id')
      .eq('meeting_id', meetingId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) return fail(403, 'NOT_MEMBER', '이 모임의 멤버만 약속을 추천받을 수 있어요');

    const { data: meeting, error: meetingError } = await svc
      .from('meetings')
      .select('id, title, region, tags, when_label')
      .eq('id', meetingId)
      .maybeSingle();
    if (meetingError) throw meetingError;
    if (!meeting) return fail(404, 'NOT_FOUND', '모임을 찾을 수 없어요');

    const meetingForPrompt = {
      title: String(meeting.title ?? ''),
      region: String(meeting.region ?? ''),
      tags: Array.isArray(meeting.tags) ? meeting.tags.map(String) : [],
      when_label: String(meeting.when_label ?? ''),
    };

    // 2. 최근 메시지 익명화 (발신자 UUID → 참가자N, 300자 제한)
    const { data: messages, error: messagesError } = await svc
      .from('messages')
      .select('sender_id, body, created_at')
      .eq('meeting_id', meetingId)
      .order('created_at', { ascending: false })
      .limit(MESSAGE_LIMIT);
    if (messagesError) throw messagesError;
    const lines = anonymizeMessages(messages ?? [], { limit: MESSAGE_LIMIT, maxLen: MESSAGE_MAX_LEN });

    // 3. LLM 호출 — JSON 검증 실패는 1회 재시도, 그래도 실패하면 정적 카드
    const model = Deno.env.get('OPENROUTER_MODEL') ?? 'openrouter/free';
    const apiKey = Deno.env.get('OPENROUTER_API_KEY') ?? '';

    let plan: PlanSuggestion | null = null;
    let errorType: string | null = null;

    if (!apiKey) {
      errorType = 'NO_API_KEY';
    } else {
      const prompt = buildPlanPrompt(meetingForPrompt, lines);
      for (let attempt = 0; attempt < 2 && !plan; attempt++) {
        try {
          const raw = await chatJson({ apiKey, model, system: prompt.system, user: prompt.user });
          plan = parsePlan(raw);
        } catch (err) {
          errorType = classifyError(err);
          if (errorType !== 'INVALID_LLM_OUTPUT') break;
        }
      }
    }

    const fallback = plan === null;
    const finalPlan = plan ?? fallbackPlan(meetingForPrompt);

    // 4. 저장 후 계약 형태로 반환 (time ↔ time_label 매핑)
    const { data: inserted, error: insertError } = await svc
      .from('meeting_plans')
      .insert({
        meeting_id: meetingId,
        created_by: user.id,
        place: finalPlan.place,
        time_label: finalPlan.time,
        activity: finalPlan.activity,
        nearby: finalPlan.nearby,
        source: fallback ? 'fallback' : 'llm',
      })
      .select('id, place, time_label, activity, nearby')
      .single();
    if (insertError || !inserted) throw insertError ?? new Error('약속 저장 실패');

    // 5. 메타데이터만 기록 (대화 원문은 저장하지 않는다). 기록 실패는 응답을 막지 않는다.
    const { error: logError } = await svc.from('ai_recommendation_runs').insert({
      user_id: user.id,
      function_name: FN,
      model,
      meeting_ids: [meetingId],
      success: !fallback,
      fallback,
      latency_ms: Date.now() - started,
      error_type: fallback ? errorType : null,
    });
    if (logError) console.error(`[${FN}] 실행 기록 저장 실패: ${logError.code ?? 'unknown'}`);

    return json({
      plan: {
        id: inserted.id,
        place: inserted.place,
        time: inserted.time_label,
        activity: inserted.activity,
        nearby: Array.isArray(inserted.nearby) ? inserted.nearby : [],
      },
      fallback,
    });
  } catch (err) {
    return errorResponse(err, FN);
  }
});
