// 채팅 익명화 · 약속 추천 프롬프트 · 응답 파서 · 정적 fallback (순수 모듈 — Deno · Node 모두에서 동작)
import { extractJsonObject, cleanString, cleanStringArray, safeHttpUrl } from './json.ts';
import { parseMeetAt, acceptMeetAt, nowHint } from './plantime.ts';
import { verifyCandidates, resolvePlaceName, placeToCandidate, MAX_CANDIDATES } from './places.ts';
import type { Place } from './search.ts';
import type { PlanCandidate } from './places.ts';

export type { Place } from './search.ts';
export type { PlanCandidate } from './places.ts';
export { safeHttpUrl } from './json.ts';

export interface RawMessage {
  sender_id: string;
  body: string;
  created_at: string;
}

export interface AnonymizedLine {
  speaker: string;
  text: string;
}

export interface PlanMeeting {
  title: string;
  region: string;
  tags: string[];
  when_label: string;
}

export interface PlanSuggestion {
  place: string;
  time: string;
  activity: string;
  nearby: string[];
  candidates: PlanCandidate[];
  /** 약속 시각 (KST ISO 8601). 문구에서 날짜를 짚을 수 없으면 null — 자동 확정 대상에서 빠진다 */
  meet_at: string | null;
}

const DEFAULT_LIMIT = 30;
const DEFAULT_MAX_LEN = 300;
const MAX_PLACES_IN_PROMPT = 8;

/**
 * 메시지를 익명화한다.
 * - 시간순으로 정렬한 뒤 최신 limit(30)개만 남긴다
 * - 발신자 ID 는 남긴 구간 안에서 처음 등장한 순서대로 참가자1..N 으로 바꾼다
 * - 본문은 maxLen(300)자로 자른다
 */
export function anonymizeMessages(
  messages: RawMessage[],
  opts: { limit?: number; maxLen?: number } = {},
): AnonymizedLine[] {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const maxLen = opts.maxLen ?? DEFAULT_MAX_LEN;
  const list = Array.isArray(messages) ? messages.filter((m) => m && typeof m === 'object') : [];

  // created_at 이 모두 해석되면 시간순 정렬, 아니면 입력 순서를 그대로 둔다
  const times = list.map((m) => Date.parse(String(m.created_at ?? '')));
  const ordered = times.every((t) => Number.isFinite(t))
    ? list.map((m, i) => ({ m, t: times[i], i })).sort((a, b) => a.t - b.t || a.i - b.i).map((x) => x.m)
    : list;

  const latest = ordered.slice(Math.max(0, ordered.length - limit));
  const labels = new Map<string, string>();
  const out: AnonymizedLine[] = [];
  for (const m of latest) {
    const key = String(m.sender_id ?? '');
    let speaker = labels.get(key);
    if (!speaker) {
      speaker = `참가자${labels.size + 1}`;
      labels.set(key, speaker);
    }
    const text = cleanString(m.body, maxLen);
    if (!text) continue;
    out.push({ speaker, text });
  }
  return out;
}

/** 검색 결과를 프롬프트용으로 정리한다 (이름 없는 항목은 버린다) */
function sanitizePlaces(places: unknown): Place[] {
  if (!Array.isArray(places)) return [];
  const out: Place[] = [];
  for (const item of places) {
    const p = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const name = cleanString(p.name, 80);
    if (!name) continue;
    out.push({
      id: cleanString(p.id, 40),
      name,
      address: cleanString(p.address, 160),
      url: safeHttpUrl(cleanString(p.url, 300)),
      category: cleanString(p.category, 40),
      lat: typeof p.lat === 'number' ? p.lat : null,
      lng: typeof p.lng === 'number' ? p.lng : null,
    });
    if (out.length >= MAX_PLACES_IN_PROMPT) break;
  }
  return out;
}

const SYSTEM_PROMPT_BASE = `당신은 소모임 약속 잡기를 돕는 한국어 도우미예요. 모임 정보와 익명 처리된 최근 대화를 보고, 참가자들이 바로 실행할 수 있는 약속 한 가지를 제안해요.

규칙:
1. 대화에서 이미 언급된 장소·시간·활동 선호를 우선 반영하고, 모임 제목·태그보다 최근 대화의 합의를 우선하세요. 러닝 크루라도 닭발을 먹자는 대화면 닭발 식당을 추천하세요. 거절하거나 취소한 제안은 제외하고, 언급이 없으면 지역의 식당·카페를 제안하세요.
2. place 는 region 안의 구체적인 장소(예: "판교역 2번 출구 앞 카페"), time 은 요일·시간대가 드러나게, activity 는 함께 할 일을 한 문장으로 적으세요.
3. meet_at 은 time 과 같은 시각을 기계가 읽을 수 있게 적은 값이에요. now 를 기준으로 실제 날짜를 계산해 KST ISO 8601(예: "2026-09-11T19:00:00+09:00")로 적고, 반드시 now 이후 180일 안의 시각이어야 해요.
4. nearby 는 만남 전후에 들르기 좋은 주변 장소 2~3곳을 짧은 한국어 문구 배열로 적으세요.
5. 모든 문장은 한국어 "~해요"체로, 각 항목은 60자 이내로 적으세요. 참가자 이름이나 개인정보는 쓰지 마세요.`;

const SYSTEM_PROMPT_NO_PLACES = `${SYSTEM_PROMPT_BASE}
6. candidates 는 선택 사항이에요. 대화에서 구체적인 장소가 여러 곳 언급됐다면 {name, address, url, why} 로 2~5곳 적고, 아니면 빈 배열로 두세요.
7. 다른 설명이나 마크다운 없이 아래 형태의 JSON 객체 하나만 출력하세요.
{"place":"만남 장소","time":"만남 시간","meet_at":"2026-09-11T19:00:00+09:00","activity":"함께 할 활동","nearby":["주변 장소 1","주변 장소 2"],"candidates":[]}`;

const SYSTEM_PROMPT_WITH_PLACES = `${SYSTEM_PROMPT_BASE}
6. places 는 장소 검색으로 확인한 실제 장소 목록이에요. 만남 장소(place)는 반드시 이 목록에서 고르세요.
   목록에 없는 장소를 적으면 실재하지 않는 곳으로 보고 후보에서 빠져요.
7. candidates 에는 places 중에서 이 모임에 어울리는 2~5곳을 {name, why} 로 적으세요.
   name 은 목록의 값을 글자 그대로 쓰고, why 는 왜 이곳이 좋은지 한국어 한 문장으로 적으세요.
   주소·좌표·링크는 검색 결과에서 자동으로 채워지니 적지 않아도 돼요.
8. place 는 candidates 에 넣은 name 중 하나와 정확히 같아야 해요.
9. 다른 설명이나 마크다운 없이 아래 형태의 JSON 객체 하나만 출력하세요.
{"place":"candidates 의 name 중 하나","time":"만남 시간","meet_at":"2026-09-11T19:00:00+09:00","activity":"함께 할 활동","nearby":["주변 장소 1","주변 장소 2"],"candidates":[{"name":"상호명","why":"한 문장 이유"}]}`;

/**
 * 약속 추천 프롬프트. 모임 요약과 익명화된 대화만 넣는다.
 * places 가 있으면 목록(name · category · address · url)을 함께 넣고 그 안에서 고르게 한다.
 * now 는 "이번 주 목요일" 같은 표현을 실제 날짜(meet_at)로 풀 수 있게 함께 넣는다.
 */
export function buildPlanPrompt(
  meeting: PlanMeeting,
  lines: AnonymizedLine[],
  places: Place[] = [],
  now: Date | string | number = new Date(),
): { system: string; user: string } {
  const m = (meeting && typeof meeting === 'object' ? meeting : {}) as Record<string, unknown>;
  const safeMeeting = {
    title: cleanString(m.title, 60),
    region: cleanString(m.region, 30),
    tags: cleanStringArray(m.tags, 20, 6),
    when_label: cleanString(m.when_label, 30),
  };
  const conversation = (Array.isArray(lines) ? lines : [])
    .map((l) => ({ speaker: cleanString(l?.speaker, 20), text: cleanString(l?.text, DEFAULT_MAX_LEN) }))
    .filter((l) => l.speaker && l.text);
  const safePlaces = sanitizePlaces(places);

  const hint = nowHint(now);
  const user = JSON.stringify({
    now: hint.iso,
    now_label: hint.label,
    meeting: safeMeeting,
    conversation,
    note: conversation.length === 0 ? '아직 대화가 없어요. 모임 정보만으로 제안하세요.' : undefined,
    places: safePlaces.length > 0
      ? safePlaces.map((p) => ({
          name: p.name,
          category: p.category || undefined,
          address: p.address || undefined,
        }))
      : undefined,
  });
  return { system: safePlaces.length > 0 ? SYSTEM_PROMPT_WITH_PLACES : SYSTEM_PROMPT_NO_PLACES, user };
}

/**
 * LLM 응답에서 약속 카드를 꺼낸다. place · time · activity 가 비어 있거나
 * nearby 가 배열이 아니면 Error('INVALID_LLM_OUTPUT'). candidates 는 선택(기본 []).
 * meet_at 은 LLM 이 준 ISO 값을 먼저 쓰고, 없거나 과거·너무 먼 시각이면 time 문구에서 다시 뽑는다.
 * 그래도 날짜를 짚을 수 없으면 null 로 두고 기존처럼 전원 투표로만 확정한다.
 */
export function parsePlan(raw: string, now: Date | string | number = new Date()): PlanSuggestion {
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed === 'string' || Array.isArray(parsed)) throw new Error('INVALID_LLM_OUTPUT');
  const root = parsed as Record<string, unknown>;
  const src = (root.plan && typeof root.plan === 'object' ? root.plan : root) as Record<string, unknown>;

  const place = cleanString(src.place, 120);
  const time = cleanString(src.time ?? src.time_label, 80);
  const activity = cleanString(src.activity, 160);
  if (!place || !time || !activity) throw new Error('INVALID_LLM_OUTPUT');
  if (!Array.isArray(src.nearby)) throw new Error('INVALID_LLM_OUTPUT');

  return {
    place,
    time,
    activity,
    nearby: cleanStringArray(src.nearby, 80, 5),
    // 이 단계에서는 LLM 이 적은 그대로 담아 두고, verifyPlan 이 검색 결과와 맞춰 검증한다
    candidates: verifyCandidates(src.candidates, []),
    meet_at: acceptMeetAt(src.meet_at, now) ?? acceptMeetAt(parseMeetAt(time, now), now),
  };
}

/**
 * LLM 이 두 번 실패했을 때 모임 정보만으로 만드는 정적 약속 카드.
 * 검색된 places 가 있으면 첫 장소를 만남 장소로 쓰고 최대 5곳을 후보지로 넣는다.
 */
export function fallbackPlan(
  meeting: PlanMeeting,
  places: Place[] = [],
  now: Date | string | number = new Date(),
): PlanSuggestion {
  const m = (meeting && typeof meeting === 'object' ? meeting : {}) as Record<string, unknown>;
  const region = cleanString(m.region, 30) || '회사';
  const whenLabel = cleanString(m.when_label, 30) || '다음 주 저녁';
  const tags = cleanStringArray(m.tags, 20, 6);
  const activity = tags.length > 0 ? `${tags[0]} 주제로 가볍게 첫 만남을 가져요` : '가볍게 인사 나누며 첫 만남을 가져요';
  const safePlaces = sanitizePlaces(places).slice(0, MAX_CANDIDATES);
  const meetAt = acceptMeetAt(parseMeetAt(whenLabel, now), now);

  if (safePlaces.length > 0) {
    return {
      place: safePlaces[0].name,
      time: whenLabel,
      activity,
      nearby: safePlaces.slice(1, 3).map((p) => p.name).concat(['근처 카페 한 곳']).slice(0, 3),
      candidates: safePlaces.map((p) => placeToCandidate(p)),
      meet_at: meetAt,
    };
  }

  return {
    place: `${region} 근처 만남의 장소`,
    time: whenLabel,
    activity,
    nearby: ['근처 카페 한 곳', '근처 식당 한 곳'],
    candidates: [],
    meet_at: meetAt,
  };
}

/**
 * 약속 카드를 실제 장소 검색 결과로 검증한다 (LLM · fallback 양쪽 모두 이 관문을 지난다).
 * - candidates 는 검색 결과와 매칭된 곳만 남고, 장소 ID·주소·좌표·상세 링크가 검색 값으로 채워진다
 * - place 는 남은 후보 중 하나의 이름으로 맞춘다 — 후보에 없는 장소가 만남 장소가 되는 일을 막는다
 * 검색 결과가 없으면(키 없음·할당량 초과 등) 후보를 verified false 로 두어 화면에서 구분할 수 있게 한다.
 */
export function verifyPlan(plan: PlanSuggestion, places: Place[] = []): PlanSuggestion {
  const candidates = verifyCandidates(plan.candidates, sanitizePlaces(places), MAX_CANDIDATES);
  return { ...plan, candidates, place: resolvePlaceName(plan.place, candidates) };
}
