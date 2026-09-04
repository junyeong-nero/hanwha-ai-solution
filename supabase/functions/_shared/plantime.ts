// 약속 시각 파서 — "이번 주 목요일 저녁 7시" 같은 한국어 문구를 KST 기준 ISO 8601 로 바꾼다.
// (순수 모듈 — Deno · Node 모두에서 동작. Intl·Date 시간대에 의존하지 않고 +09:00 오프셋으로만 계산한다)
//
// 약속 카드의 time_label 은 사람이 읽는 자유 텍스트라 "시간이 지났는지"를 판정할 수 없다.
// 이 모듈이 만든 meet_at 이 있어야 약속 시간이 지난 카드를 자동 확정할 수 있다.

/** KST 는 서머타임이 없어 고정 +09:00 으로 계산한다 */
const KST_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 요일 표기 → JS getUTCDay() 인덱스 (일요일 = 0) */
const WEEKDAYS: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

/** 시각이 없을 때 시간대 낱말만으로 정하는 기본 시각 (사내 모임 기준) */
const PERIOD_HOURS: Record<string, number> = {
  새벽: 6, 아침: 8, 오전: 10, 점심: 12, 정오: 12, 낮: 13, 오후: 14, 저녁: 19, 밤: 21, 야간: 21,
};
/** 시각은 있는데 오전/오후가 불분명할 때 오후로 미는 낱말 */
const PM_WORDS = ['오후', '저녁', '밤', '야간', '퇴근'];
const AM_WORDS = ['오전', '아침', '새벽'];

/** 낮 시간 표기 없이 "7시" 처럼 적혔을 때 오후로 보는 상한 (1~8시 → 13~20시) */
const BARE_PM_MAX = 8;

/** 요일·시간대 낱말이 하나도 없으면 기본 저녁 7시 */
const DEFAULT_HOUR = 19;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** KST 벽시계를 UTC 필드로 읽기 위해 +9시간 민 Date */
function toKst(at: Date | string | number): Date | null {
  const d = at instanceof Date ? at : new Date(at);
  const t = d.getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + KST_MS);
}

/** KST 벽시계 Date(=UTC 필드) 를 +09:00 오프셋 ISO 문자열로 만든다 */
function kstToIso(kst: Date): string {
  return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}`
    + `T${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}:00+09:00`;
}

/** 그 주의 월요일을 0 으로 두는 인덱스 (월 0 … 일 6) */
function mondayIndex(day: number): number {
  return (day + 6) % 7;
}

interface TimeOfDay {
  hour: number;
  minute: number;
  /** 시각 정보가 문구에 실제로 있었는지 (없으면 기본값을 쓴 것) */
  explicit: boolean;
}

/** "저녁 7시 반" · "19:30" · "오전 9시" 에서 시·분을 뽑는다 */
function parseTimeOfDay(text: string): TimeOfDay {
  const pm = PM_WORDS.some((w) => text.includes(w));
  const am = AM_WORDS.some((w) => text.includes(w));

  let hour: number | null = null;
  let minute = 0;

  const colon = text.match(/(\d{1,2})\s*:\s*(\d{2})/);
  const hourWord = text.match(/(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분|\s*(반))?/);
  if (colon) {
    hour = Number(colon[1]);
    minute = Number(colon[2]);
  } else if (hourWord) {
    hour = Number(hourWord[1]);
    if (hourWord[2]) minute = Number(hourWord[2]);
    else if (hourWord[3]) minute = 30;
  }

  if (hour === null || hour > 23 || minute > 59) {
    // 시각 없이 "저녁"·"점심" 만 있는 경우 — 시간대 낱말의 기본 시각을 쓴다
    for (const [word, h] of Object.entries(PERIOD_HOURS)) {
      if (text.includes(word)) return { hour: h, minute: 0, explicit: true };
    }
    return { hour: DEFAULT_HOUR, minute: 0, explicit: false };
  }

  if (pm && hour < 12) hour += 12;
  else if (am && hour === 12) hour = 0;
  else if (!pm && !am && hour >= 1 && hour <= BARE_PM_MAX) hour += 12;

  return { hour: hour % 24, minute, explicit: true };
}

/** 문구에서 날짜(KST 기준 연·월·일)를 찾는다. 못 찾으면 null */
function parseDatePart(text: string, todayKst: Date): { y: number; m: number; d: number } | null {
  const y0 = todayKst.getUTCFullYear();

  // 1) 2026-09-11 · 2026/09/11 · 2026년 9월 11일
  const full = text.match(/(\d{4})\s*[-/년]\s*(\d{1,2})\s*[-/월]\s*(\d{1,2})/);
  if (full) return { y: Number(full[1]), m: Number(full[2]), d: Number(full[3]) };

  // 2) 9월 11일 · 9/11 — 연도는 오늘 기준으로 정하고, 반년 이상 지난 날짜면 내년으로 본다
  const md = text.match(/(\d{1,2})\s*[월/]\s*(\d{1,2})\s*일?/);
  if (md) {
    const m = Number(md[1]);
    const d = Number(md[2]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const guess = Date.UTC(y0, m - 1, d);
      const rolled = guess < todayKst.getTime() - 180 * DAY_MS ? y0 + 1 : y0;
      return { y: rolled, m, d };
    }
  }

  // 3) 오늘 · 내일 · 모레 · 글피
  const relatives: Array<[RegExp, number]> = [
    [/오늘|금일/, 0], [/내일|낼|명일/, 1], [/모레/, 2], [/글피/, 3],
  ];
  for (const [re, offset] of relatives) {
    if (re.test(text)) {
      const at = new Date(todayKst.getTime() + offset * DAY_MS);
      return { y: at.getUTCFullYear(), m: at.getUTCMonth() + 1, d: at.getUTCDate() };
    }
  }

  // 4) 요일 — "주말" 은 토요일로 본다
  const weekdayMatch = text.match(/([월화수목금토일])\s*요일/);
  const weekend = /주말/.test(text);
  if (!weekdayMatch && !weekend) return null;
  const target = weekdayMatch ? WEEKDAYS[weekdayMatch[1]] : WEEKDAYS['토'];

  const nextWeek = /다음\s*주|담주|차주|내주/.test(text);
  const thisWeek = /이번\s*주|이번주|금주/.test(text);

  let offsetDays: number;
  if (thisWeek) {
    // "이번 주 화요일" 은 이번 주(월~일) 안의 그 요일 — 이미 지났을 수 있다
    offsetDays = mondayIndex(target) - mondayIndex(todayKst.getUTCDay());
  } else {
    // 수식어가 없으면 오늘 포함 다가오는 그 요일
    offsetDays = (target - todayKst.getUTCDay() + 7) % 7;
  }
  if (nextWeek) offsetDays += 7;

  const at = new Date(todayKst.getTime() + offsetDays * DAY_MS);
  return { y: at.getUTCFullYear(), m: at.getUTCMonth() + 1, d: at.getUTCDate() };
}

/**
 * 한국어 약속 문구를 KST ISO 8601 문자열로 바꾼다. 날짜를 짚을 수 없으면 null.
 * - "평일 저녁"·"교육 마친 날" 처럼 날짜가 없는 문구는 null (자동 확정 대상에서 빠진다)
 * - 시각이 없으면 시간대 낱말의 기본 시각을, 그것도 없으면 저녁 7시를 쓴다
 */
export function parseMeetAt(label: unknown, now: Date | string | number = new Date()): string | null {
  const text = typeof label === 'string' ? label.trim() : '';
  if (!text) return null;
  const nowKst = toKst(now);
  if (!nowKst) return null;

  // 문구가 이미 ISO 8601 이면 그대로 정규화한다
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) {
    const kst = toKst(text);
    return kst ? kstToIso(kst) : null;
  }

  const todayKst = new Date(Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth(), nowKst.getUTCDate()));
  const date = parseDatePart(text, todayKst);
  if (!date) return null;

  const { hour, minute } = parseTimeOfDay(text);
  const at = new Date(Date.UTC(date.y, date.m - 1, date.d, hour, minute));
  if (!Number.isFinite(at.getTime())) return null;
  return kstToIso(at);
}

/** 앞으로 몇 일까지의 약속을 정상으로 볼지 — 이보다 먼 시각은 파싱 오류로 본다 */
export const MAX_HORIZON_DAYS = 180;

/**
 * 저장해도 되는 약속 시각인지 확인한다. 새로 만드는 카드는 미래여야 하고,
 * 180일보다 먼 시각은 LLM 이 연도를 잘못 쓴 것으로 보고 버린다.
 * 통과하면 +09:00 ISO 문자열, 아니면 null.
 */
export function acceptMeetAt(value: unknown, now: Date | string | number = new Date()): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const nowMs = new Date(now instanceof Date ? now.getTime() : now).getTime();
  const at = new Date(value.trim()).getTime();
  if (!Number.isFinite(at) || !Number.isFinite(nowMs)) return null;
  if (at <= nowMs) return null;
  if (at > nowMs + MAX_HORIZON_DAYS * DAY_MS) return null;
  const kst = toKst(at);
  return kst ? kstToIso(kst) : null;
}

/** 프롬프트에 넣을 "지금" 표기 — LLM 이 "이번 주 목요일" 을 실제 날짜로 풀 수 있게 한다 */
export function nowHint(now: Date | string | number = new Date()): { iso: string; label: string } {
  const kst = toKst(now) ?? new Date(0);
  return {
    iso: kstToIso(kst),
    label: `${kst.getUTCFullYear()}년 ${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일 `
      + `(${WEEKDAY_LABELS[kst.getUTCDay()]}요일) ${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())} KST`,
  };
}
