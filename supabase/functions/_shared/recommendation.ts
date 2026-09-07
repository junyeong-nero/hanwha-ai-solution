// 모임 추천 규칙 엔진 — 프로필과 후보 모임을 가중치 점수로 매겨 순위·이유·주의점을 만든다.
// 외부 LLM 을 호출하지 않으므로 응답이 즉시 나오고, 같은 입력이면 항상 같은 결과가 나온다.
// (순수 모듈 — Deno · Node 모두에서 동작)
import { cleanString, cleanStringArray } from './json.ts';

export interface Recommendation {
  meeting_id: string;
  rank: number;
  reason: string;
  cautions: string[];
}

/** 순위와 함께 점수를 돌려주는 형태 (정렬 근거 확인용) */
export interface ScoredRecommendation extends Recommendation {
  /** 0~1 가중 평균 점수. 이미 참가 중인 모임은 1 을 빼서 뒤로 민다 */
  score: number;
}

export interface MatchingPreferences {
  /** true 면 같은 성별 비율이 높은 모임을 우선한다 */
  same_gender: boolean;
  /** 'mine' 이면 같은 계열사 비율이 높은 모임을 우선한다 */
  scope: string;
  /** 'deep' 이면 아는 얼굴이 많은 모임, 'wide' 면 새로운 얼굴이 많은 모임을 우선한다 */
  direction: string;
}

/** 규칙 엔진에 넘기는 익명 프로필. 실명 · 사번 · 사용자 ID 는 쓰지 않는다. */
export interface RuleProfile {
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

/** 규칙 엔진에 넘기는 후보 모임 요약 */
export interface RuleCandidate {
  id: string;
  title: string;
  region: string;
  when_label: string;
  tags: string[];
  capacity: number;
  member_count: number;
  known_count: number;
  joined: boolean;
  /** 다른 멤버 중 호출자와 같은 성별의 비율 (0~1). 성별을 모르거나 다른 멤버가 없으면 null */
  same_gender_ratio: number | null;
  /** 다른 멤버 중 호출자와 같은 계열사의 비율 (0~1). 계열사를 모르거나 다른 멤버가 없으면 null */
  same_company_ratio: number | null;
}

/** 규칙 엔진 버전 — ai_recommendation_runs.model 에 남긴다 */
export const RULE_ENGINE_MODEL = 'rule-based-v1';

/** 어느 항목도 근거가 되지 못했을 때 쓰는 이유 */
export const DEFAULT_REASON = '선호 지역의 열린 모임 중 조건이 가장 가까워요';

/** 항목별 가중치. 적용되지 않는 항목은 빼고 나머지를 다시 정규화한다. */
const WEIGHTS = {
  interest: 0.34,
  direction: 0.22,
  size: 0.16,
  gender: 0.14,
  company: 0.1,
  vacancy: 0.04,
};

/** 이 점수 이상인 항목만 추천 이유 문장으로 쓴다 */
const REASON_THRESHOLD = 0.6;
const MAX_REASON_LEN = 60;
const MAX_CAUTIONS = 3;

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
export function sanitizeProfile(input: unknown): RuleProfile {
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
  if (size[1] < size[0]) size = [size[1], size[0]];

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
export function sanitizeCandidate(input: unknown): RuleCandidate {
  const c = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const memberCount = Math.max(0, toInt(c.member_count, 0));
  const knownCount = Math.max(0, Math.min(memberCount, toInt(c.known_count, 0)));
  return {
    id: cleanString(c.id, 64),
    title: cleanString(c.title, 60),
    region: cleanString(c.region, 30),
    when_label: cleanString(c.when_label, 30),
    tags: stringList(c.tags, 6),
    capacity: Math.max(0, toInt(c.capacity, 0)),
    member_count: memberCount,
    known_count: knownCount,
    joined: c.joined === true,
    same_gender_ratio: toRatio(c.same_gender_ratio),
    same_company_ratio: toRatio(c.same_company_ratio),
  };
}

/** 비교용으로 낱말을 다듬는다: 소문자 · 공백/기호 제거 */
function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[\s#·・,/]+/g, '');
}

/** 두 낱말이 같거나 한쪽이 다른 쪽을 품으면 겹치는 것으로 본다 (두 글자 이상일 때만) */
function wordsMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < 2 || b.length < 2) return false;
  return a.includes(b) || b.includes(a);
}

/** 아는 얼굴 비율 (0~1) */
function knownRatio(c: RuleCandidate): number {
  return c.member_count > 0 ? c.known_count / c.member_count : 0;
}

/** 나를 포함한 예상 인원 */
function projectedSize(c: RuleCandidate): number {
  return c.member_count + (c.joined ? 0 : 1);
}

interface Factor {
  /** 0~1 점수 */
  score: number;
  weight: number;
  /** 이 항목이 추천 이유가 될 때 쓸 문장 */
  reason: string;
}

interface Scored {
  candidate: RuleCandidate;
  score: number;
  reason: string;
  cautions: string[];
}

/** 관심사·취미와 모임 태그(+제목)의 겹침을 점수와 겹친 낱말로 돌려준다 */
function interestMatch(profile: RuleProfile, c: RuleCandidate): { score: number; matched: string[] } {
  const keywords = [...profile.interests, ...profile.hobbies];
  if (keywords.length === 0) return { score: 0.5, matched: [] };

  const haystack = [...c.tags, c.title].map(normalizeWord).filter(Boolean);
  const matched: string[] = [];
  for (const keyword of keywords) {
    const norm = normalizeWord(keyword);
    if (haystack.some((h) => wordsMatch(norm, h)) && !matched.includes(keyword)) matched.push(keyword);
  }
  // 두세 개만 겹쳐도 만점 — 관심사를 적게 적은 사용자가 불리해지지 않게 한다
  const target = Math.min(keywords.length, 3);
  return { score: Math.min(1, matched.length / target), matched };
}

/** 예상 인원이 희망 범위에 얼마나 가까운지 (범위 안이면 1, 4명 이상 벗어나면 0) */
function sizeScore(profile: RuleProfile, c: RuleCandidate): number {
  const [min, max] = profile.group_size;
  const size = projectedSize(c);
  const distance = size < min ? min - size : size > max ? size - max : 0;
  return Math.max(0, 1 - distance / 4);
}

/** 남은 자리 비율 — 자리가 넉넉한 모임을 조금 우대한다 */
function vacancyScore(c: RuleCandidate): number {
  if (c.capacity <= 0) return 0;
  return Math.max(0, Math.min(1, (c.capacity - c.member_count) / c.capacity));
}

function percent(ratio: number): number {
  return Math.round(ratio * 100);
}

/** 후보 하나의 항목별 점수를 만든다. 적용되지 않는 항목은 넣지 않는다. */
function factorsFor(profile: RuleProfile, c: RuleCandidate, matched: string[], interestScore: number): Factor[] {
  const prefs = profile.matching_preferences;
  const deep = prefs.direction === 'deep';
  const factors: Factor[] = [];

  factors.push({
    score: interestScore,
    weight: WEIGHTS.interest,
    reason: matched.length
      ? `관심사 ${matched.slice(0, 2).join('·')}가 겹쳐요`
      : `${c.region || '선호 지역'} 모임 중 태그가 가장 가까워요`,
  });

  const known = knownRatio(c);
  factors.push({
    score: deep ? known : 1 - known,
    weight: WEIGHTS.direction,
    reason: deep
      ? `아는 얼굴 ${c.known_count}명이 있어 편하게 시작할 수 있어요`
      : c.known_count === 0
        ? '모두 처음 만나는 사람들이라 새 인연에 좋아요'
        : '새로운 얼굴이 대부분이라 넓게 만나기 좋아요',
  });

  const [min, max] = profile.group_size;
  factors.push({
    score: sizeScore(profile, c),
    weight: WEIGHTS.size,
    reason: `희망 인원 ${min}~${max}명에 맞는 규모예요`,
  });

  if (prefs.same_gender && c.same_gender_ratio !== null) {
    factors.push({
      score: c.same_gender_ratio,
      weight: WEIGHTS.gender,
      reason: `같은 성별 멤버가 ${percent(c.same_gender_ratio)}%라 편해요`,
    });
  }

  if (prefs.scope === 'mine' && c.same_company_ratio !== null) {
    factors.push({
      score: c.same_company_ratio,
      weight: WEIGHTS.company,
      reason: `같은 계열사 멤버가 ${percent(c.same_company_ratio)}%예요`,
    });
  }

  factors.push({
    score: vacancyScore(c),
    weight: WEIGHTS.vacancy,
    reason: '자리가 넉넉해 바로 참가할 수 있어요',
  });

  return factors;
}

/** 문장 끝을 연결형으로 바꾼다 — "새 인연에 좋아요" → "새 인연에 좋고", "규모예요" → "규모이고" */
const CONJUNCTIVE: Array<[RegExp, string]> = [
  [/겹쳐요$/, '겹치고'],
  [/가까워요$/, '가깝고'],
  [/좋아요$/, '좋고'],
  [/편해요$/, '편하고'],
  [/있어요$/, '있고'],
  [/이에요$/, '이고'],
  [/예요$/, '이고'],
  [/해요$/, '하고'],
];
export function toConjunctive(sentence: string): string {
  for (const [re, to] of CONJUNCTIVE) if (re.test(sentence)) return sentence.replace(re, to);
  return sentence;
}

/** 점수가 높은 항목 최대 2개를 골라 한 문장으로 잇는다 (60자 이내) */
function buildReason(factors: Factor[]): string {
  const strong = factors
    .filter((f) => f.score >= REASON_THRESHOLD && f.reason)
    .sort((a, b) => b.score * b.weight - a.score * a.weight);
  if (strong.length === 0) return DEFAULT_REASON;

  const head = strong[0].reason;
  for (const next of strong.slice(1)) {
    // 두 번째 근거는 60자를 넘지 않을 때만 덧붙인다
    const joined = `${toConjunctive(head)}, ${next.reason}`;
    if (joined.length <= MAX_REASON_LEN) return joined;
  }
  return head.length > MAX_REASON_LEN ? head.slice(0, MAX_REASON_LEN) : head;
}

/** 사용자에게 미리 알려 줄 걸리는 점들 */
function buildCautions(profile: RuleProfile, c: RuleCandidate, matchedCount: number): string[] {
  const prefs = profile.matching_preferences;
  const [min, max] = profile.group_size;
  const cautions: string[] = [];

  if (c.joined) cautions.push('이미 참가 중이에요');
  const left = c.capacity - c.member_count;
  if (!c.joined && c.capacity > 0 && left <= 1) cautions.push('정원이 거의 찼어요');

  const size = projectedSize(c);
  if (size < min) cautions.push(`희망 인원(${min}~${max}명)보다 작은 모임이에요`);
  else if (size > max) cautions.push(`희망 인원(${min}~${max}명)보다 큰 모임이에요`);

  if (matchedCount === 0 && profile.interests.length + profile.hobbies.length > 0) {
    cautions.push('관심사와 겹치는 태그가 없어요');
  }
  if (prefs.same_gender && c.same_gender_ratio !== null && c.same_gender_ratio < 0.34) {
    cautions.push(`같은 성별 멤버가 ${percent(c.same_gender_ratio)}%로 적어요`);
  }
  if (prefs.scope === 'mine' && c.same_company_ratio !== null && c.same_company_ratio < 0.34) {
    cautions.push('다른 계열사 멤버가 대부분이에요');
  }

  return cautions.slice(0, MAX_CAUTIONS);
}

/** 후보 하나를 채점한다 */
function scoreCandidate(profile: RuleProfile, c: RuleCandidate): Scored {
  const { score: interestScore, matched } = interestMatch(profile, c);
  const factors = factorsFor(profile, c, matched, interestScore);
  const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
  const weighted = factors.reduce((sum, f) => sum + f.score * f.weight, 0);
  const base = totalWeight > 0 ? weighted / totalWeight : 0;
  // 이미 참가한 모임은 목록에서 빼지 않고 맨 뒤로만 민다
  const score = Math.round((c.joined ? base - 1 : base) * 10000) / 10000;

  return {
    candidate: c,
    score,
    reason: buildReason(factors),
    cautions: buildCautions(profile, c, matched.length),
  };
}

/**
 * 규칙 기반 추천. 지역은 서버가 이미 걸렀으므로 점수에 넣지 않는다.
 * 정렬: 점수 내림차순 → direction 기준 아는 얼굴 비율 → id (같은 입력이면 항상 같은 순서)
 */
export function rankByRules(profile: unknown, candidates: unknown[]): ScoredRecommendation[] {
  const safeProfile = sanitizeProfile(profile);
  const deep = safeProfile.matching_preferences.direction === 'deep';
  const scored = (Array.isArray(candidates) ? candidates : [])
    .map(sanitizeCandidate)
    .filter((c) => c.id)
    .map((c) => scoreCandidate(safeProfile, c));

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    const ka = knownRatio(a.candidate);
    const kb = knownRatio(b.candidate);
    if (ka !== kb) return deep ? kb - ka : ka - kb;
    return a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0;
  });

  return scored.map((s, i) => ({
    meeting_id: s.candidate.id,
    rank: i + 1,
    reason: s.reason,
    cautions: s.cautions,
    score: s.score,
  }));
}
