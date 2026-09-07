// recommend-meetings — 익명 프로필과 규칙 후보를 GPT에 전달해 순위·이유를 돌려준다.
// GPT 응답 검증·시간 제한·캐시를 적용하고, 실패하면 기존 규칙 순서로 대체한다.
// 후보는 선호 지역(profiles.regions) 안의 열린 모임으로 서버가 먼저 거른다 (하드 제약).
// 요청: POST {}  (Authorization: Bearer <세션 JWT>)
// 응답: 200 { recommendations, candidates, model, fallback, regions } / 401 UNAUTHORIZED·NO_PROFILE
import { preflight, json, fail, errorResponse } from '../_shared/cors.ts';
import { requireUser, serviceClient } from '../_shared/supabase.ts';
import { ageBand, RULE_ENGINE_MODEL } from '../_shared/recommendation.ts';
import { tokenUsage } from '../_shared/openai.ts';
import { recommendWithAI } from '../_shared/ai-matching.ts';

import { consumeAIBudget } from '../_shared/ai-limit.ts';

const FN = 'recommend-meetings';

interface Candidate {
  id: string;
  title: string;
  emoji: string;
  region: string;
  when_label: string;
  capacity: number;
  tags: string[];
  member_count: number;
  known_count: number;
  joined: boolean;
  /** 호출자가 직접 만든 모임 */
  mine: boolean;
  /** 다른 멤버 중 호출자와 같은 성별의 비율 (0~1). 성별을 모르거나 다른 멤버가 없으면 null */
  same_gender_ratio: number | null;
  /** 다른 멤버 중 호출자와 같은 계열사의 비율 (0~1). 계열사를 모르거나 다른 멤버가 없으면 null */
  same_company_ratio: number | null;
}

/** 다른 멤버 중 호출자와 같은 값(성별·계열사)을 가진 비율. 기준값이 없거나 다른 멤버가 없으면 null */
function sameAttributeRatio(
  memberIds: string[],
  selfId: string,
  selfValue: string | null,
  values: Map<string, string | null>,
): number | null {
  if (!selfValue) return null;
  const others = memberIds.filter((id) => id !== selfId);
  if (others.length === 0) return null;
  const same = others.filter((id) => (values.get(id) ?? null) === selfValue).length;
  return Math.round((same / others.length) * 100) / 100;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'POST 요청만 받을 수 있어요');

  const started = Date.now();
  try {
    const { user } = await requireUser(req);
    const svc = serviceClient();

    // 1. 프로필 (매칭에 필요한 필드만 조회 — real_name · employee_no 는 읽지 않는다)
    const { data: profile, error: profileError } = await svc
      .from('profiles')
      .select('company_id, region, regions, gender, age, interests, hobbies, group_size_min, group_size_max, matching_preferences')
      .eq('user_id', user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) return fail(401, 'NO_PROFILE', '프로필을 먼저 저장해 주세요');

    // 선호 지역 목록: regions 가 비어 있으면 단일 region 으로 대체, 둘 다 없으면 모든 지역
    const regionsUsed: string[] = Array.isArray(profile.regions) && profile.regions.length > 0
      ? profile.regions.map(String).filter(Boolean)
      : profile.region
        ? [String(profile.region)]
        : [];
    const selfGender = typeof profile.gender === 'string' && profile.gender.trim() ? profile.gender.trim() : null;
    const selfCompany = typeof profile.company_id === 'string' && profile.company_id.trim() ? profile.company_id.trim() : null;

    // 2. 열린 모임 (선호 지역 하드 필터) · 멤버 · 내 연결
    let meetingsQuery = svc
      .from('meetings')
      .select('id, title, emoji, region, when_label, capacity, tags, created_by')
      .eq('status', 'open');
    if (regionsUsed.length > 0) meetingsQuery = meetingsQuery.in('region', regionsUsed);
    const { data: meetings, error: meetingsError } = await meetingsQuery;
    if (meetingsError) throw meetingsError;

    const meetingIds = (meetings ?? []).map((m: { id: string }) => m.id);
    const { data: members, error: membersError } = meetingIds.length
      ? await svc.from('meeting_members').select('meeting_id, user_id').in('meeting_id', meetingIds)
      : { data: [], error: null };
    if (membersError) throw membersError;

    const { data: connections, error: connectionsError } = await svc
      .from('connections')
      .select('user_a_id, user_b_id')
      .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`);
    if (connectionsError) throw connectionsError;

    const known = new Set<string>();
    for (const c of connections ?? []) {
      known.add(c.user_a_id === user.id ? c.user_b_id : c.user_a_id);
    }

    const membersByMeeting = new Map<string, string[]>();
    for (const row of members ?? []) {
      const list = membersByMeeting.get(row.meeting_id) ?? [];
      list.push(row.user_id);
      membersByMeeting.set(row.meeting_id, list);
    }

    // 3. 멤버 성별·계열사 (같은 성별·계열사 비율 계산용 — 이 두 필드만 읽는다)
    const memberIds = [...new Set((members ?? []).map((row: { user_id: string }) => row.user_id))];
    const genders = new Map<string, string | null>();
    const companies = new Map<string, string | null>();
    if ((selfGender || selfCompany) && memberIds.length > 0) {
      const { data: memberProfiles, error: memberProfilesError } = await svc
        .from('profiles')
        .select('user_id, gender, company_id')
        .in('user_id', memberIds);
      if (memberProfilesError) throw memberProfilesError;
      for (const row of memberProfiles ?? []) {
        const g = typeof row.gender === 'string' && row.gender.trim() ? row.gender.trim() : null;
        const co = typeof row.company_id === 'string' && row.company_id.trim() ? row.company_id.trim() : null;
        genders.set(row.user_id, g);
        companies.set(row.user_id, co);
      }
    }

    // 4. 후보 = 선호 지역 안에서 열려 있고 정원이 남은 모임 (이미 참가한 모임은 포함하되 joined 로 표시)
    const candidates: Candidate[] = (meetings ?? [])
      .map((m: Record<string, unknown>) => {
        const ids = membersByMeeting.get(String(m.id)) ?? [];
        const joined = ids.includes(user.id);
        const knownCount = ids.filter((id) => id !== user.id && known.has(id)).length;
        return {
          id: String(m.id),
          title: String(m.title ?? ''),
          emoji: String(m.emoji ?? '🌙'),
          region: String(m.region ?? ''),
          when_label: String(m.when_label ?? ''),
          capacity: Number(m.capacity ?? 0),
          tags: Array.isArray(m.tags) ? m.tags.map(String) : [],
          member_count: ids.length,
          known_count: knownCount,
          joined,
          mine: m.created_by === user.id,
          same_gender_ratio: sameAttributeRatio(ids, user.id, selfGender, genders),
          same_company_ratio: sameAttributeRatio(ids, user.id, selfCompany, companies),
        };
      })
      .filter((c: Candidate) => c.joined || c.member_count < c.capacity);

    const prefs = (profile.matching_preferences ?? {}) as { same_gender?: boolean; scope?: string; direction?: string };
    const ruleProfile = {
      company_id: selfCompany,
      regions: regionsUsed,
      age_band: ageBand(typeof profile.age === 'number' ? profile.age : null),
      gender: selfGender,
      interests: Array.isArray(profile.interests) ? profile.interests : [],
      hobbies: Array.isArray(profile.hobbies) ? profile.hobbies : [],
      group_size: [profile.group_size_min ?? 4, profile.group_size_max ?? 6] as [number, number],
      matching_preferences: {
        same_gender: prefs.same_gender === true,
        scope: prefs.scope ?? 'all',
        direction: prefs.direction ?? 'wide',
      },
    };

    if (candidates.length === 0) {
      return json({ recommendations: [], candidates: [], model: RULE_ENGINE_MODEL, fallback: false, regions: regionsUsed });
    }

    // 5. GPT 재정렬 — 오류 시 규칙 순서를 반환하고 후보도 같은 순서로 정렬한다
    const allowed = await consumeAIBudget(svc, user.id, FN, null, (key) => Deno.env.get(key));
    const result = await recommendWithAI({
      profile: ruleProfile, candidates, userId: user.id,
      apiKey: allowed ? Deno.env.get('OPENAI_API_KEY') ?? '' : '',
    });
    if (!allowed) result.error_type = 'RATE_LIMITED';
    const { recommendations } = result;
    const rankById = new Map(recommendations.map((r) => [r.meeting_id, r.rank]));
    candidates.sort((a, b) => (rankById.get(a.id) ?? Infinity) - (rankById.get(b.id) ?? Infinity));

    // 6. 메타데이터만 기록 (프로필 원문은 저장하지 않는다). 기록 실패는 응답을 막지 않는다.
    const { error: logError } = await svc.from('ai_recommendation_runs').insert({
      user_id: user.id,
      function_name: FN,
      model: result.model,
      meeting_ids: recommendations.map((r) => r.meeting_id),
      success: !result.fallback,
      fallback: result.fallback,
      latency_ms: Date.now() - started,
      error_type: result.error_type,
    });
    if (logError) console.error(`[${FN}] 실행 기록 저장 실패: ${logError.code ?? 'unknown'}`);
    console.info(JSON.stringify({ function_name: FN, ...tokenUsage(result.usage), latency_ms: Date.now() - started }));

    return json({ recommendations, candidates, model: result.model, fallback: result.fallback, cached: result.cached, rate_limited: !allowed, regions: regionsUsed });
  } catch (err) {
    return errorResponse(err, FN);
  }
});
