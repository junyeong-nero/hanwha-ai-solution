// LLM 매칭 프롬프트 생성 · 응답 파서 · 결정적 fallback 정렬 (순수 모듈 — Deno · Node 모두에서 동작)
import { extractJsonObject, cleanString, cleanStringArray } from './json.ts';

export interface Recommendation {
  meeting_id: string;
  rank: number;
  reason: string;
  cautions: string[];
}

export interface MatchingPreferences {
  /** true 면 같은 성별 비율이 높은 모임을 우선한다 */
  same_gender: boolean;
  scope: string;
  direction: string;
}

/** LLM 에 보내는 익명 프로필. 실명 · 사번 · 사용자 ID 는 절대 포함하지 않는다. */
export interface ProfileForLLM {
  company_id: string | null;
  /** 선호 지역 목록 — 서버가 이 목록 안의 모임만 후보로 넘긴다 */
  regions: string[];
  age_band: string;
  gender: string | null;
  interests: string[];
  hobbies: string[];
  group_size: [number, number];
  matching_preferences: MatchingPreferences;
}

/** LLM 에 보내는 후보 모임 요약 */
export interface CandidateForLLM {
  id: string;
  title: string;
  region: string;
  when_label: string;
  tags: string[];
  capacity: number;
  member_count: number;
  known_count: number;
  joined: boolean;
  /** 다른 멤버 중 호출자와 같은 성별의 비율 (0~1). 성별을 모르거나 멤버가 없으면 null */
  same_gender_ratio: number | null;
}

export const FALLBACK_REASON = '기본 추천 — 선호 지역과 아는 얼굴 비율 기준으로 정렬했어요';
export const FALLBACK_REASON_SAME_GENDER = '기본 추천 — 같은 성별 비율과 아는 얼굴 비율 기준으로 정렬했어요';
const MAX_REASON_LEN = 160;

/** 나이를 연령대 문자열로 바꾼다. 나이가 없으면 '비공개'. */
export function ageBand(age: number | null | undefined): string {
  if (age === null || age === undefined || !Number.isFinite(age) || age < 0) return '비공개';
  const decade = Math.floor(age / 10) * 10;
  if (decade < 20) return '20대 미만';
  if (decade >= 60) return '60대 이상';
  const rest = age % 10;
  const part = rest <= 3 ? '초반' : rest <= 6 ? '중반' : '후반';
  return `${decade}대 ${part}`;
}

function stringList(value: unknown, maxItems = 12): string[] {
  return cleanStringArray(value, 40, maxItems);
}

function toInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

/** 0~1 비율이면 소수 둘째 자리로 반올림, 아니면 null */
function toRatio(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

/** 프로필에서 허용된 필드만 뽑는다 (화이트리스트). */
function sanitizeProfile(input: unknown): ProfileForLLM {
  const p = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const prefs = (p.matching_preferences && typeof p.matching_preferences === 'object'
    ? p.matching_preferences
    : {}) as Record<string, unknown>;

  let band = cleanString(p.age_band, 20);
  if (!band) band = ageBand(typeof p.age === 'number' ? p.age : null);

  let size: [number, number];
  if (Array.isArray(p.group_size) && p.group_size.length === 2) {
    size = [toInt(p.group_size[0], 4), toInt(p.group_size[1], 6)];
  } else {
    size = [toInt(p.group_size_min, 4), toInt(p.group_size_max, 6)];
  }

  // regions 가 없으면 단일 region 으로 대체한다
  let regions = cleanStringArray(p.regions, 30, 10);
  if (regions.length === 0) {
    const single = cleanString(p.region, 30);
    if (single) regions = [single];
  }

  return {
    company_id: cleanString(p.company_id, 20) || null,
    regions,
    age_band: band,
    gender: cleanString(p.gender, 10) || null,
    interests: stringList(p.interests),
    hobbies: stringList(p.hobbies),
    group_size: size,
    matching_preferences: {
      same_gender: prefs.same_gender === true,
      scope: cleanString(prefs.scope, 10) || 'all',
      direction: cleanString(prefs.direction, 10) || 'wide',
    },
  };
}

/** 후보에서 허용된 필드만 뽑는다. */
function sanitizeCandidate(input: unknown): CandidateForLLM & { known_member_ratio: number } {
  const c = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const memberCount = Math.max(0, toInt(c.member_count, 0));
  const knownCount = Math.max(0, Math.min(memberCount, toInt(c.known_count, 0)));
  return {
    id: cleanString(c.id, 64),
    title: cleanString(c.title, 60),
    region: cleanString(c.region, 30),
    when_label: cleanString(c.when_label, 30),
    tags: stringList(c.tags, 6),
    capacity: toInt(c.capacity, 0),
    member_count: memberCount,
    known_count: knownCount,
    known_member_ratio: memberCount > 0 ? Math.round((knownCount / memberCount) * 100) / 100 : 0,
    joined: c.joined === true,
    same_gender_ratio: toRatio(c.same_gender_ratio),
  };
}

/** 비율을 프롬프트용 백분율 문자열로 바꾼다. 모르면 '정보 없음'. */
function ratioLabel(ratio: number | null): string {
  return ratio === null ? '정보 없음' : `${Math.round(ratio * 100)}%`;
}

const SYSTEM_PROMPT = `당신은 한화그룹 계열사 임직원 소모임 앱 '달빛한화'의 매칭 도우미예요.
사용자 프로필(익명 처리됨)과 후보 모임 목록을 JSON 으로 받고, 사용자에게 잘 맞는 순서로 후보 모임 전체의 순위를 매겨요.

규칙:
1. meeting_id 에는 반드시 candidates 배열에 있는 id 만 그대로 쓰세요. 없는 id 를 만들거나 바꾸지 마세요.
2. 주어진 모든 후보에 rank(1부터 시작하는 정수, 중복 없음)를 부여하세요. 후보를 빠뜨리지 마세요.
3. reason 은 사용자에게 보여줄 한국어 한 문장(60자 이내, "~해요"체)으로, 왜 이 모임이 맞는지 구체적으로 적으세요.
4. cautions 는 걸리는 점(정원 임박, 이미 참가 중, 성별 구성 등)을 짧은 한국어 문구 배열로 적고, 없으면 빈 배열로 두세요.
5. 후보는 모두 사용자의 선호 지역 목록(profile.regions) 안의 모임이에요. 지역은 이미 맞으니 지역 불일치를 이유로 감점하지 마세요.
6. 판단 기준: interests·hobbies 와 모임 tags 의 겹침, 희망 인원(group_size)과 현재 인원(member_count·capacity),
   matching_preferences.direction(wide = 새로운 사람 위주라 known_member_ratio 가 낮은 모임 선호, deep = 아는 얼굴 위주라 높은 모임 선호),
   matching_preferences.scope(mine = 같은 계열사 위주, all = 계열사 무관).
7. matching_preferences.same_gender 가 true 면 "같은 성별 우선" 이에요. same_gender_ratio(다른 멤버 중 사용자와 같은 성별의 비율, 백분율 또는 '정보 없음')가 높은 모임을 앞에 두세요.
   false 면 same_gender_ratio 는 참고만 하고 순위에 크게 반영하지 마세요.
8. joined 가 true 인 모임은 이미 참가 중이므로 순위를 뒤로 미루되 목록에서 빼지는 마세요.
9. 다른 설명이나 마크다운 없이 아래 형태의 JSON 객체 하나만 출력하세요.
{"recommendations":[{"meeting_id":"candidates 의 id","rank":1,"reason":"한 문장 이유","cautions":[]}]}`;

/**
 * 매칭 프롬프트를 만든다. 입력 객체에 실명·사번 등이 섞여 있어도
 * 화이트리스트 필드만 프롬프트에 들어간다.
 */
export function buildRecommendationPrompt(profile: unknown, candidates: unknown[]): { system: string; user: string } {
  const safeProfile = sanitizeProfile(profile);
  const safeCandidates = (Array.isArray(candidates) ? candidates : [])
    .map(sanitizeCandidate)
    .filter((c) => c.id)
    .map((c) => ({ ...c, same_gender_ratio: ratioLabel(c.same_gender_ratio) }));
  const user = JSON.stringify({
    profile: safeProfile,
    preferred_regions: safeProfile.regions,
    same_gender_first: safeProfile.matching_preferences.same_gender,
    note: safeProfile.regions.length > 0
      ? `후보 모임은 모두 선호 지역(${safeProfile.regions.join(', ')}) 안에 있어요.`
      : '선호 지역이 비어 있어 모든 지역의 모임이 후보예요.',
    candidates: safeCandidates,
    candidate_ids: safeCandidates.map((c) => c.id),
  });
  return { system: SYSTEM_PROMPT, user };
}

/**
 * LLM 응답을 검증한다.
 * - 첫 번째 JSON 객체만 사용 (코드 펜스 허용)
 * - 후보에 없는 id · 빈 이유 · 160자 초과 이유는 버림
 * - 같은 id 는 가장 좋은 순위만 남김
 * - rank 오름차순 정렬 후 1..n 으로 다시 번호 매김
 * - 남는 추천이 없으면 Error('INVALID_LLM_OUTPUT')
 */
export function parseRecommendations(raw: string, candidateIds: string[]): Recommendation[] {
  const parsed = extractJsonObject(raw);
  let list: unknown[] | null = null;
  if (Array.isArray(parsed)) list = parsed;
  else if (parsed && typeof parsed === 'object') {
    const recs = (parsed as { recommendations?: unknown }).recommendations;
    if (Array.isArray(recs)) list = recs;
  }
  if (!list) throw new Error('INVALID_LLM_OUTPUT');

  const allowed = new Set(candidateIds);
  const best = new Map<string, Recommendation>();

  list.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const rec = item as Record<string, unknown>;
    const id = String(rec.meeting_id ?? rec.id ?? '').trim();
    if (!allowed.has(id)) return;

    const reason = typeof rec.reason === 'string' ? rec.reason.replace(/\s+/g, ' ').trim() : '';
    // 비어 있거나, 160자를 넘거나, 글자 없이 기호만 있는 이유("...")는 버린다
    if (!reason || reason.length > MAX_REASON_LEN || !/[가-힣A-Za-z0-9]/.test(reason)) return;

    const rankNum = Number(rec.rank);
    // rank 가 없거나 이상하면 순서를 유지하되 정상 순위 뒤로 보낸다
    const rank = Number.isFinite(rankNum) && rankNum > 0 ? rankNum : 1000 + index;
    const cautions = cleanStringArray(rec.cautions, MAX_REASON_LEN, 5);

    const prev = best.get(id);
    if (!prev || rank < prev.rank) best.set(id, { meeting_id: id, rank, reason, cautions });
  });

  const sorted = [...best.values()].sort(
    (a, b) => a.rank - b.rank || (a.meeting_id < b.meeting_id ? -1 : a.meeting_id > b.meeting_id ? 1 : 0),
  );
  if (sorted.length === 0) throw new Error('INVALID_LLM_OUTPUT');
  return sorted.map((r, i) => ({ ...r, rank: i + 1 }));
}

export interface FallbackCandidate {
  id: string;
  member_count: number;
  known_count: number;
  same_gender_ratio?: number | null;
}

export interface FallbackProfile {
  matching_preferences: { direction?: string; same_gender?: boolean };
}

/**
 * LLM 이 실패했을 때 쓰는 결정적 정렬. 지역은 서버가 이미 걸러 두었으므로 정렬 기준이 아니다.
 * 1) same_gender 가 true 일 때만: 같은 성별 비율 내림차순 (null 은 맨 뒤)
 * 2) 아는 얼굴 비율 (deep 이면 내림차순, 아니면 오름차순)
 * 3) id
 */
export function deterministicOrder(candidates: FallbackCandidate[], profile: FallbackProfile): Recommendation[] {
  const deep = profile?.matching_preferences?.direction === 'deep';
  const sameGender = profile?.matching_preferences?.same_gender === true;
  const knownRatio = (c: FallbackCandidate) => (c.member_count > 0 ? c.known_count / c.member_count : 0);
  const genderRatio = (c: FallbackCandidate) =>
    typeof c.same_gender_ratio === 'number' && Number.isFinite(c.same_gender_ratio) ? c.same_gender_ratio : null;

  const sorted = [...candidates].sort((a, b) => {
    if (sameGender) {
      const ga = genderRatio(a);
      const gb = genderRatio(b);
      if (ga !== gb) {
        if (ga === null) return 1;
        if (gb === null) return -1;
        return gb - ga;
      }
    }
    const ka = knownRatio(a);
    const kb = knownRatio(b);
    if (ka !== kb) return deep ? kb - ka : ka - kb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const reason = sameGender ? FALLBACK_REASON_SAME_GENDER : FALLBACK_REASON;
  return sorted.map((c, i) => ({
    meeting_id: c.id,
    rank: i + 1,
    reason,
    cautions: [],
  }));
}
