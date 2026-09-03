// recommend-meetings — 익명 프로필과 후보 모임을 OpenRouter LLM 에 보내 순위·이유를 받는다.
// 후보는 선호 지역(profiles.regions) 안의 열린 모임으로 서버가 먼저 거른다 (하드 제약).
// 요청: POST {}  (Authorization: Bearer <세션 JWT>)
// 응답: 200 { recommendations, candidates, model, fallback, regions } / 401 UNAUTHORIZED·NO_PROFILE
import { preflight, json, fail, errorResponse } from '../_shared/cors.ts';
import { requireUser, serviceClient } from '../_shared/supabase.ts';
import { chatJson, LlmError } from '../_shared/llm.ts';
import {
  ageBand,
  buildRecommendationPrompt,
  parseRecommendations,
  deterministicOrder,
  type Recommendation,
} from '../_shared/recommendation.ts';

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
}

/** 오류를 ai_recommendation_runs.error_type 용 짧은 분류로 바꾼다 (원문은 남기지 않는다) */
function classifyError(err: unknown): string {
  if (err instanceof LlmError) return err.code === 'HTTP' ? `HTTP_${err.status ?? 0}` : err.code;
  if (err instanceof Error && err.message === 'INVALID_LLM_OUTPUT') return 'INVALID_LLM_OUTPUT';
  return 'UNKNOWN';
}

/** 다른 멤버 중 호출자와 같은 성별의 비율. 호출자 성별을 모르거나 다른 멤버가 없으면 null */
function sameGenderRatio(memberIds: string[], selfId: string, selfGender: string | null, genders: Map<string, string | null>): number | null {
  if (!selfGender) return null;
  const others = memberIds.filter((id) => id !== selfId);
  if (others.length === 0) return null;
  const same = others.filter((id) => (genders.get(id) ?? null) === selfGender).length;
  return Math.round((same / others.length) * 100) / 100;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'POST 요청만 받을 수 있어요');

  const started = Date.now();
  try {
    const { user } = await requireUser(req);
    const svc = serviceClient();

    // 1. 프로필 (LLM 에 필요한 필드만 조회 — real_name · employee_no 는 읽지 않는다)
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

    // 3. 멤버 성별 (같은 성별 비율 계산용 — 성별만 읽는다)
    const memberIds = [...new Set((members ?? []).map((row: { user_id: string }) => row.user_id))];
    const genders = new Map<string, string | null>();
    if (selfGender && memberIds.length > 0) {
      const { data: memberProfiles, error: gendersError } = await svc
        .from('profiles')
        .select('user_id, gender')
        .in('user_id', memberIds);
      if (gendersError) throw gendersError;
      for (const row of memberProfiles ?? []) {
        const g = typeof row.gender === 'string' && row.gender.trim() ? row.gender.trim() : null;
        genders.set(row.user_id, g);
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
          same_gender_ratio: sameGenderRatio(ids, user.id, selfGender, genders),
        };
      })
      .filter((c: Candidate) => c.joined || c.member_count < c.capacity);

    const prefs = (profile.matching_preferences ?? {}) as { same_gender?: boolean; scope?: string; direction?: string };
    const fallbackProfile = {
      matching_preferences: { direction: prefs.direction, same_gender: prefs.same_gender === true },
    };

    // 후보 순서를 결정적으로 고정해 LLM 입력과 fallback 이 같은 순서를 보게 한다
    const baseOrder = deterministicOrder(candidates, fallbackProfile).map((r) => r.meeting_id);
    candidates.sort((a, b) => baseOrder.indexOf(a.id) - baseOrder.indexOf(b.id));

    const model = Deno.env.get('OPENROUTER_MODEL') ?? 'openrouter/free';
    const apiKey = Deno.env.get('OPENROUTER_API_KEY') ?? '';

    if (candidates.length === 0) {
      return json({ recommendations: [], candidates: [], model, fallback: false, regions: regionsUsed });
    }

    // 5. LLM 호출 — JSON 검증 실패는 1회 재시도, 그래도 실패하면 결정적 정렬로 대체
    const profileForLLM = {
      company_id: profile.company_id ?? null,
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
    const candidateIds = candidates.map((c) => c.id);

    let recommendations: Recommendation[] | null = null;
    let errorType: string | null = null;

    if (!apiKey) {
      errorType = 'NO_API_KEY';
    } else {
      const prompt = buildRecommendationPrompt(profileForLLM, candidates);
      for (let attempt = 0; attempt < 2 && !recommendations; attempt++) {
        try {
          const raw = await chatJson({ apiKey, model, system: prompt.system, user: prompt.user });
          recommendations = parseRecommendations(raw, candidateIds);
        } catch (err) {
          errorType = classifyError(err);
          // 전송 오류는 chatJson 안에서 이미 1회 재시도했으므로 파싱 실패만 다시 시도한다
          if (errorType !== 'INVALID_LLM_OUTPUT') break;
        }
      }
    }

    const fallback = recommendations === null;
    const finalRecommendations = recommendations ?? deterministicOrder(candidates, fallbackProfile);

    // 6. 메타데이터만 기록 (프롬프트·응답 원문은 저장하지 않는다). 기록 실패는 응답을 막지 않는다.
    const { error: logError } = await svc.from('ai_recommendation_runs').insert({
      user_id: user.id,
      function_name: FN,
      model,
      meeting_ids: finalRecommendations.map((r) => r.meeting_id),
      success: !fallback,
      fallback,
      latency_ms: Date.now() - started,
      error_type: fallback ? errorType : null,
    });
    if (logError) console.error(`[${FN}] 실행 기록 저장 실패: ${logError.code ?? 'unknown'}`);

    return json({ recommendations: finalRecommendations, candidates, model, fallback, regions: regionsUsed });
  } catch (err) {
    return errorResponse(err, FN);
  }
});
