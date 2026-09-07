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

const SYSTEM_PROMPT_BASE = `당신은 소모임의 장소 후보를 추천하는 한국어 도우미예요. 날짜나 약속을 정하지 말고, 채팅에서 비교하며 이야기할 후보를 제안하세요.

규칙:
1. 최근 대화의 음식·활동·지역 선호를 모임 제목·태그보다 우선하세요. 러닝 크루라도 닭발을 먹자는 대화면 닭발 식당을 추천하세요. 거절하거나 취소한 제안은 제외하세요. 언급이 없으면 모임 지역과 검색된 업종을 근거로 삼으세요.
2. candidates는 실제 places 목록에서 2~5곳을 골라 {name, why}로 적으세요. 한 곳만 있으면 한 곳만 추천하세요. name은 검색 결과 그대로 쓰세요.
3. why는 후보마다 서로 다른 한국어 한두 문장(120자 이내)으로, 대화의 어떤 선호와 검색 결과의 어떤 지역·업종이 맞는지 구체적으로 설명하세요. 참가자 이름·개인정보·대화 직접 인용은 쓰지 마세요.
4. 검색에 없는 영업시간, 가격, 예약 가능 여부, 좌석 수, 주차, 조용함, 실제 거리·이동시간은 추측하지 마세요. 대화에서 조용한 곳을 원해도 해당 매장이 조용하다고 단정하지 마세요.
5. place는 후보 이름 하나, time은 "장소 후보", meet_at은 반드시 null, activity는 "마음에 드는 곳을 채팅에서 이야기해 보세요", nearby는 빈 배열로 두세요. 약속 확정이나 시간 제안은 하지 마세요.
6. 모든 문장은 한국어 ~해요체로 쓰고 JSON 객체 하나만 출력하세요.`;
const SYSTEM_PROMPT_NO_PLACES = `${SYSTEM_PROMPT_BASE}
검색 결과가 없으면 candidates는 빈 배열로 두고 장소를 만들어 내지 마세요.`;
const SYSTEM_PROMPT_WITH_PLACES = `${SYSTEM_PROMPT_BASE}
주소·좌표·링크는 검색 결과에서 채우므로 출력하지 않아도 돼요.
{"place":"후보 이름","time":"장소 후보","meet_at":null,"activity":"마음에 드는 곳을 채팅에서 이야기해 보세요","nearby":[],"candidates":[{"name":"상호명","why":"대화 선호와 검색 정보에 근거한 추천 이유"}]}`;

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
