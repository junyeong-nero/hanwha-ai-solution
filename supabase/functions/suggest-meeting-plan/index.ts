// suggest-meeting-plan — 카카오 장소 검색으로 실제 후보지를 찾고, 최근 대화를 익명화해 OpenAI GPT 에 보내 약속 카드를 만든다.
// 요청: POST { meeting_id }  (Authorization: Bearer <세션 JWT>)
// 응답: 200 { plan: { id, place, time, meet_at, activity, nearby, candidates }, fallback, search_used, search } / 403 NOT_MEMBER
// 새 추천의 meet_at은 null — 시간표에서 방장이 선택해 확정할 때만 채운다
// search_used: 'kakao' | 'none' — 후보지를 어떤 검색으로 찾았는지 (하위 호환)
// search: { provider, status, queries, alternatives } — 검색 결과 없음·할당량 초과·오류를 화면에서 구분하기 위한 정보
// LLM 이 지어낸 장소는 verifyPlan 이 검색 결과와 대조해 걸러 낸다 — 후보지는 실재하는 장소만 남는다.
import { preflight, json, fail, errorResponse, readJsonBody, isUuid } from '../_shared/cors.ts';
import { requireUser, serviceClient } from '../_shared/supabase.ts';
import { OPENAI_MODEL, tokenUsage } from '../_shared/openai.ts';
import { suggestWithAI } from '../_shared/ai-plan.ts';
import { anonymizeMessages } from '../_shared/chat.ts';
import { inferPlaceIntent } from '../_shared/place-intent.ts';
import { searchPlaces } from '../_shared/search.ts';

const FN = 'suggest-meeting-plan';
const MESSAGE_LIMIT = 30;
const MESSAGE_MAX_LEN = 300;

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
      .select('meeting_id, joined_at')
      .eq('meeting_id', meetingId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) return fail(403, 'NOT_MEMBER', '이 모임의 멤버만 약속을 추천받을 수 있어요');

    const { data: meeting, error: meetingError } = await svc
      .from('meetings')
      .select('id, title, region, tags, when_label, created_by')
      .eq('id', meetingId)
      .maybeSingle();
    if (meetingError) throw meetingError;
    if (!meeting) return fail(404, 'NOT_FOUND', '모임을 찾을 수 없어요');

    if (meeting.created_by && meeting.created_by !== user.id) return fail(403, 'NOT_HOST', '방장이 약속 잡기를 시작하면 시간과 장소를 선택할 수 있어요');

    const meetingForPrompt = {
      title: String(meeting.title ?? ''),
      region: String(meeting.region ?? ''),
      tags: Array.isArray(meeting.tags) ? meeting.tags.map(String) : [],
      when_label: String(meeting.when_label ?? ''),
    };

    // 2. 최근 메시지 익명화 (발신자 UUID → 참가자N, 300자 제한)
    // 호출자가 참가한 뒤의 대화만 넣는다 — 참가 이전 대화는 본인이 읽을 수 없으므로
    // AI 약속 카드를 통해 요약돼 돌아오는 경로도 막는다 (이슈 #11)
    const { data: messages, error: messagesError } = await svc
      .from('messages')
      .select('sender_id, body, created_at')
      .eq('meeting_id', meetingId)
      .gte('created_at', membership.joined_at)
      .order('created_at', { ascending: false })
      .limit(MESSAGE_LIMIT);
    if (messagesError) throw messagesError;
    const lines = anonymizeMessages(messages ?? [], { limit: MESSAGE_LIMIT, maxLen: MESSAGE_MAX_LEN });

    // 프롬프트 · 파서 · 폴백이 같은 "지금"을 쓰도록 한 번만 잡는다
    const now = new Date();

    const model = OPENAI_MODEL;
    const apiKey = Deno.env.get('OPENAI_API_KEY') ?? '';

    // 3. 대화 의도 → 실제 장소 검색 → 검증된 후보 추천 순서로 진행한다.
    const intent = await inferPlaceIntent({ meeting: meetingForPrompt, lines, apiKey });
    const search = await searchPlaces({
      region: intent.region,
      keywords: intent.keywords,
      kakaoKey: Deno.env.get('KAKAO_REST_KEY') ?? undefined,
    });
    const places = search.places;

    // 4~5. OpenAI 호출과 실제 장소 검증. 실패 시 검색 후보 기반 기본 카드를 반환한다.
    const result = await suggestWithAI({ meeting: meetingForPrompt, lines, places, now, apiKey });
    const { plan: finalPlan, fallback } = result;

    // 6. 시간은 미정으로 저장한다. LLM 추정 시각이 자동 확정되는 것을 막는다.
    const { data: inserted, error: insertError } = await svc
      .from('meeting_plans')
      .insert({
        meeting_id: meetingId,
        created_by: user.id,
        place: finalPlan.place,
        time_label: '가능 시간 조율 중',
        meet_at: null,
        activity: finalPlan.activity,
        nearby: finalPlan.nearby,
        candidates: finalPlan.candidates,
        source: fallback ? 'fallback' : 'llm',
      })
      .select('id, place, time_label, meet_at, activity, nearby, candidates, selected_place, schedule_host')
      .single();
    if (insertError || !inserted) throw insertError ?? new Error('약속 저장 실패');

    // 7. 메타데이터만 기록 (대화 원문은 저장하지 않는다). 기록 실패는 응답을 막지 않는다.
    const { error: logError } = await svc.from('ai_recommendation_runs').insert({
      user_id: user.id,
      function_name: FN,
      model,
      meeting_ids: [meetingId],
      success: !fallback && !intent.fallback,
      fallback: fallback || intent.fallback,
      latency_ms: Date.now() - started,
      error_type: result.error_type || intent.error_type,
    });
    if (logError) console.error(`[${FN}] 실행 기록 저장 실패: ${logError.code ?? 'unknown'}`);
    console.info(JSON.stringify({ function_name: FN, ...tokenUsage(result.usage), intent_usage: tokenUsage(intent.usage), latency_ms: Date.now() - started }));

    return json({
      plan: {
        id: inserted.id,
        place: inserted.place,
        time: inserted.time_label,
        meet_at: inserted.meet_at ?? null,
        activity: inserted.activity,
        nearby: Array.isArray(inserted.nearby) ? inserted.nearby : [],
        candidates: Array.isArray(inserted.candidates) ? inserted.candidates : [],
        selected_place: inserted.selected_place ?? null,
        schedule_host: inserted.schedule_host,
      },
      fallback: fallback || intent.fallback,
      intent_fallback: intent.fallback,
      search_used: search.provider,
      search: {
        provider: search.provider,
        status: search.status,
        queries: search.queries,
        alternatives: search.alternatives,
      },
    });
  } catch (err) {
    return errorResponse(err, FN);
  }
});
