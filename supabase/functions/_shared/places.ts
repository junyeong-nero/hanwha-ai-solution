// LLM 이 고른 장소를 실제 검색 결과와 맞춰 보는 검증 모듈 (순수 모듈 — Deno · Node 모두에서 동작)
// LLM 텍스트를 그대로 확정하지 않는다. 검색 결과에 없는 장소는 후보에서 빼고,
// 남은 후보는 검색 결과의 장소 ID·주소·좌표·상세 링크로 덮어써 실재하는 장소만 남긴다.
import { cleanString, safeHttpUrl } from './json.ts';
import type { Place } from './search.ts';

/** 약속 카드의 후보지 (투표·지도 비교 대상) */
export interface PlanCandidate {
  /** 카카오 장소 ID — 지도 Marker · 선택 상태의 키. 검증되지 않은 후보는 '' */
  id: string;
  name: string;
  address: string;
  url: string;
  category: string;
  lat: number | null;
  lng: number | null;
  /** 왜 이곳인지 한국어 한 문장 */
  why: string;
  /** 실제 장소 검색 결과와 매칭됐는지 */
  verified: boolean;
  /** 같은 이름의 다른 장소가 후보에 함께 있는지 (동명이인 구분용) */
  ambiguous?: boolean;
}

export const MAX_CANDIDATES = 5;
/** 검증된 후보가 이 수에 못 미치면 검색 결과로 채운다 */
const MIN_CANDIDATES = 2;
const SEARCHED_WHY = '검색된 후보지예요';

/** 이름 비교용 정규화 — 공백·괄호·구두점을 없애고 소문자로 */
export function normalizePlaceName(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s ]+/g, '')
    .replace(/[()[\]{}<>·,.\-_'"“”‘’!?~/\\|]/g, '');
}

/**
 * 이름으로 검색 결과에서 같은 장소를 찾는다.
 * 정규화 완전 일치 → 한쪽이 다른 쪽을 포함(2글자 이상) 순으로 본다. 없으면 null.
 */
export function matchPlace(name: unknown, places: Place[]): Place | null {
  const key = normalizePlaceName(name);
  if (!key || !Array.isArray(places)) return null;
  const list = places.filter((p) => p && typeof p === 'object');

  const exact = list.find((p) => normalizePlaceName(p.name) === key);
  if (exact) return exact;

  if (key.length < 2) return null;
  const partial = list.find((p) => {
    const other = normalizePlaceName(p.name);
    return other.length >= 2 && (other.includes(key) || key.includes(other));
  });
  return partial ?? null;
}

/** 검색된 장소를 후보지로 바꾼다 (why 는 이유 문장) */
export function placeToCandidate(place: Place, why = SEARCHED_WHY): PlanCandidate {
  return {
    id: cleanString(place.id, 40),
    name: cleanString(place.name, 80),
    address: cleanString(place.address, 160),
    url: safeHttpUrl(place.url),
    category: cleanString(place.category, 40),
    lat: typeof place.lat === 'number' ? place.lat : null,
    lng: typeof place.lng === 'number' ? place.lng : null,
    why: cleanString(why, 120) && why !== SEARCHED_WHY ? cleanString(why, 120)
      : cleanString(`${place.address || '요청한 지역'}에서 검색한 ${place.category || '장소'} 후보예요. 위치와 업종을 비교해 보세요.`, 120),
    verified: true,
  };
}

/** 검증되지 않은(검색 결과가 아예 없을 때의) LLM 후보 */
function unverifiedCandidate(raw: Record<string, unknown>): PlanCandidate | null {
  const name = cleanString(raw.name, 80);
  if (!name) return null;
  return {
    id: '',
    name,
    address: cleanString(raw.address, 160),
    url: safeHttpUrl(cleanString(raw.url, 300)),
    category: cleanString(raw.category, 40),
    lat: null,
    lng: null,
    why: cleanString(raw.why ?? raw.reason, 120),
    verified: false,
  };
}

/** 같은 이름이 두 번 이상 나오는 후보에 ambiguous 를 붙인다 (동명이인 — 주소로 구분해 보여 준다) */
export function markAmbiguous(candidates: PlanCandidate[]): PlanCandidate[] {
  const count = new Map<string, number>();
  for (const c of candidates) {
    const key = normalizePlaceName(c.name);
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  return candidates.map((c) =>
    (count.get(normalizePlaceName(c.name)) ?? 0) > 1 ? { ...c, ambiguous: true } : c
  );
}

/**
 * LLM 후보지를 검색 결과와 맞춰 검증한다.
 * - 검색 결과가 있으면: 매칭된 후보만 남기고 장소 ID·주소·좌표·링크를 검색 값으로 덮어쓴다.
 *   (LLM 이 지어낸 장소는 여기서 사라진다.) 남은 수가 적으면 검색 결과로 채운다.
 * - 검색 결과가 없으면: LLM 후보를 verified false 로 그대로 둔다 (검색으로 확인하지 못했음을 화면에서 알린다).
 */
export function verifyCandidates(rawCandidates: unknown, places: Place[] = [], limit = MAX_CANDIDATES): PlanCandidate[] {
  const raws = (Array.isArray(rawCandidates) ? rawCandidates : [])
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object');
  const searched = (Array.isArray(places) ? places : []).filter((p) => p && typeof p === 'object' && p.name);

  if (searched.length === 0) {
    const out: PlanCandidate[] = [];
    for (const raw of raws) {
      const candidate = unverifiedCandidate(raw);
      if (candidate) out.push(candidate);
      if (out.length >= limit) break;
    }
    return markAmbiguous(out);
  }

  const out: PlanCandidate[] = [];
  const used = new Set<string>();
  for (const raw of raws) {
    const place = matchPlace(raw.name, searched);
    if (!place) continue;                       // 검색 결과에 없는 장소 — 확정하지 않는다
    const key = place.id || normalizePlaceName(place.name);
    if (used.has(key)) continue;
    used.add(key);
    out.push(placeToCandidate(place, cleanString(raw.why ?? raw.reason, 120)));
    if (out.length >= limit) break;
  }

  // 검증을 통과한 후보가 너무 적으면 검색 결과로 채운다 (지도에서 비교할 후보를 남긴다)
  for (const place of searched) {
    if (out.length >= Math.max(MIN_CANDIDATES, Math.min(limit, searched.length))) break;
    const key = place.id || normalizePlaceName(place.name);
    if (used.has(key)) continue;
    used.add(key);
    out.push(placeToCandidate(place));
  }
  return markAmbiguous(out.slice(0, limit));
}

/**
 * 만남 장소 문구를 후보지 목록에 맞춘다.
 * 후보와 이름이 맞으면 후보의 정식 이름으로, 맞는 후보가 없으면 첫 후보로 바꾼다.
 * 후보가 하나도 없으면 원래 문구를 그대로 둔다.
 */
export function resolvePlaceName(place: unknown, candidates: PlanCandidate[]): string {
  const name = cleanString(place, 120);
  if (!Array.isArray(candidates) || candidates.length === 0) return name;
  const key = normalizePlaceName(name);
  const hit = candidates.find((c) => normalizePlaceName(c.name) === key)
    ?? candidates.find((c) => {
      const other = normalizePlaceName(c.name);
      return other.length >= 2 && key.length >= 2 && (key.includes(other) || other.includes(key));
    });
  return (hit ?? candidates[0]).name;
}

/** 후보지 목록에서 만남 장소로 고른 후보를 찾는다 (없으면 null) */
export function findCandidate(candidates: PlanCandidate[], place: unknown): PlanCandidate | null {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const key = normalizePlaceName(place);
  return candidates.find((c) => normalizePlaceName(c.name) === key) ?? null;
}
