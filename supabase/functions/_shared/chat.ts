// 채팅 익명화 · 약속 추천 프롬프트 · 응답 파서 · 정적 fallback (순수 모듈 — Deno · Node 모두에서 동작)
import { extractJsonObject, cleanString, cleanStringArray } from './json.ts';

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
}

const DEFAULT_LIMIT = 30;
const DEFAULT_MAX_LEN = 300;

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

const SYSTEM_PROMPT = `당신은 소모임 약속 잡기를 돕는 한국어 도우미예요. 모임 정보와 익명 처리된 최근 대화를 보고, 참가자들이 바로 실행할 수 있는 약속 한 가지를 제안해요.

규칙:
1. 대화에서 이미 언급된 장소·시간·활동 선호를 우선 반영하고, 언급이 없으면 모임의 region·when_label·tags 에 맞춰 제안하세요.
2. place 는 region 안의 구체적인 장소(예: "판교역 2번 출구 앞 카페"), time 은 요일·시간대가 드러나게, activity 는 함께 할 일을 한 문장으로 적으세요.
3. nearby 는 만남 전후에 들르기 좋은 주변 장소 2~3곳을 짧은 한국어 문구 배열로 적으세요.
4. 모든 문장은 한국어 "~해요"체로, 각 항목은 60자 이내로 적으세요. 참가자 이름이나 개인정보는 쓰지 마세요.
5. 다른 설명이나 마크다운 없이 아래 형태의 JSON 객체 하나만 출력하세요.
{"place":"만남 장소","time":"만남 시간","activity":"함께 할 활동","nearby":["주변 장소 1","주변 장소 2"]}`;

/** 약속 추천 프롬프트. 모임 요약과 익명화된 대화만 넣는다. */
export function buildPlanPrompt(meeting: PlanMeeting, lines: AnonymizedLine[]): { system: string; user: string } {
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
  const user = JSON.stringify({
    meeting: safeMeeting,
    conversation,
    note: conversation.length === 0 ? '아직 대화가 없어요. 모임 정보만으로 제안하세요.' : undefined,
  });
  return { system: SYSTEM_PROMPT, user };
}

/**
 * LLM 응답에서 약속 카드를 꺼낸다. place · time · activity 가 비어 있거나
 * nearby 가 배열이 아니면 Error('INVALID_LLM_OUTPUT').
 */
export function parsePlan(raw: string): PlanSuggestion {
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed === 'string' || Array.isArray(parsed)) throw new Error('INVALID_LLM_OUTPUT');
  const root = parsed as Record<string, unknown>;
  const src = (root.plan && typeof root.plan === 'object' ? root.plan : root) as Record<string, unknown>;

  const place = cleanString(src.place, 120);
  const time = cleanString(src.time ?? src.time_label, 80);
  const activity = cleanString(src.activity, 160);
  if (!place || !time || !activity) throw new Error('INVALID_LLM_OUTPUT');
  if (!Array.isArray(src.nearby)) throw new Error('INVALID_LLM_OUTPUT');

  return { place, time, activity, nearby: cleanStringArray(src.nearby, 80, 5) };
}

/** LLM 이 두 번 실패했을 때 모임 정보만으로 만드는 정적 약속 카드 */
export function fallbackPlan(meeting: PlanMeeting): PlanSuggestion {
  const m = (meeting && typeof meeting === 'object' ? meeting : {}) as Record<string, unknown>;
  const region = cleanString(m.region, 30) || '회사';
  const whenLabel = cleanString(m.when_label, 30) || '다음 주 저녁';
  const tags = cleanStringArray(m.tags, 20, 6);
  const activity = tags.length > 0 ? `${tags[0]} 주제로 가볍게 첫 만남을 가져요` : '가볍게 인사 나누며 첫 만남을 가져요';
  return {
    place: `${region} 근처 만남의 장소`,
    time: whenLabel,
    activity,
    nearby: ['근처 카페 한 곳', '근처 식당 한 곳'],
  };
}
