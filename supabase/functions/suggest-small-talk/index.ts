// 추천은 호출자에게만 반환하며 채팅이나 DB에 자동으로 공유하지 않는다.
import { preflight, json, fail, errorResponse, readJsonBody, isUuid } from '../_shared/cors.ts';
import { requireUser, serviceClient } from '../_shared/supabase.ts';
import { consumeAIBudget } from '../_shared/ai-limit.ts';
import { anonymizeMessages } from '../_shared/chat.ts';
import { suggestSmallTalk } from '../_shared/small-talk.ts';
const FN = 'suggest-small-talk';
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'POST 요청만 받을 수 있어요');
  try {
    const { user } = await requireUser(req);
    const body = await readJsonBody(req);
    if (!isUuid(body.meeting_id) || (body.topic !== undefined && (typeof body.topic !== 'string' || body.topic.length > 80))) return fail(400, 'BAD_REQUEST', '모임과 80자 이내의 주제를 보내 주세요');
    const svc = serviceClient(), meetingId = body.meeting_id;
    const membershipQuery = () => svc.from('meeting_members').select('joined_at').eq('meeting_id', meetingId).eq('user_id', user.id).maybeSingle();
    const { data: member, error: memberError } = await membershipQuery();
    if (memberError) throw memberError;
    if (!member) return fail(403, 'NOT_MEMBER', '현재 모임 멤버만 대화 주제를 추천받을 수 있어요');
    const allowed = await consumeAIBudget(svc, user.id, FN, meetingId, key => Deno.env.get(key));
    if (!allowed) return fail(429, 'RATE_LIMITED', 'AI 대화 주제 추천 한도에 도달했어요. 잠시 후 다시 시도해 주세요');
    const { data: meeting, error: meetingError } = await svc.from('meetings').select('title,tags').eq('id', meetingId).maybeSingle();
    if (meetingError) throw meetingError;
    if (!meeting) return fail(404, 'NOT_FOUND', '모임을 찾을 수 없어요');
    const { data: messages, error: messagesError } = await svc.from('messages').select('sender_id,body,created_at').eq('meeting_id', meetingId)
      .gte('created_at', member.joined_at).not('sender_id', 'is', null).order('created_at', { ascending: false }).limit(30);
    if (messagesError) throw messagesError;
    const result = await suggestSmallTalk({ meeting, lines: anonymizeMessages(messages ?? [], { limit: 30, maxLen: 300 }),
      topic: typeof body.topic === 'string' ? body.topic.trim() : '', apiKey: Deno.env.get('OPENAI_API_KEY') ?? '' });
    // 생성 도중 탈퇴·재참가했으면 과거 참가 구간의 대화를 돌려주지 않는다.
    const { data: current, error: currentError } = await membershipQuery();
    if (currentError) throw currentError;
    if (!current || current.joined_at !== member.joined_at) return fail(403, 'NOT_MEMBER', '참여 상태가 바뀌었어요. 방을 다시 열어 주세요');
    return json(result, 200, { 'Cache-Control': 'no-store' });
  } catch (err) { return errorResponse(err, FN); }
});
