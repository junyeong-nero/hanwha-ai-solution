// 실제 장소를 찾는 검색 모듈 (순수 모듈 — Deno · Node 모두에서 동작)
// 1순위 Kakao 로컬 키워드 검색, 2순위 OpenRouter 웹 검색 플러그인, 둘 다 없으면 빈 결과.
// 검색은 약속 추천을 절대 막지 않는다 — 어떤 오류가 나도 places 는 빈 배열로 끝나고,
// 왜 비었는지는 status('quota' · 'auth' · 'error' · 'empty' · 'no_key')로 알린다.
// API 키·프롬프트·응답은 로그에 남기지 않는다.
import { extractJsonObject, cleanString, safeHttpUrl } from './json.ts';

/** 정규화된 장소 한 곳. id·좌표는 카카오 검색에서만 채워진다 (없으면 '' · null). */
export interface Place {
  /** 카카오 장소 ID — 후보 선택·중복 제거의 기준 */
  id: string;
  name: string;
  address: string;
  /** 상세 링크 (http/https 만) */
  url: string;
  category: string;
  /** 위도 (한국 범위 밖이면 null) */
  lat: number | null;
  /** 경도 (한국 범위 밖이면 null) */
  lng: number | null;
}

export type SearchProvider = 'kakao' | 'openrouter' | 'none';

/**
 * 검색이 어떻게 끝났는지.
 * - ok: 후보를 찾음 / empty: 요청은 성공했지만 결과 0건
 * - quota: 할당량 초과(HTTP 429) / auth: 키·도메인 문제(401·403) / error: 그 밖의 실패
 * - no_key: 검색 키가 없어 아예 요청하지 않음
 */
export type SearchStatus = 'ok' | 'empty' | 'quota' | 'auth' | 'error' | 'no_key';

export interface SearchResult {
  provider: SearchProvider;
  places: Place[];
  status: SearchStatus;
  /** 실제로 보낸 검색어 */
  queries: string[];
  /** 결과가 없을 때 사용자에게 안내할 대체 검색어 */
  alternatives: string[];
}

export interface SearchOptions {
  region: string;
  keywords: string[];
  kakaoKey?: string;
  openRouterKey?: string;
  /** OpenRouter 모델 (기본 openrouter/free) */
  model?: string;
  /** 테스트용 fetch 주입 */
  fetchImpl?: typeof fetch;
  /** 요청당 타임아웃 (기본 12초) */
  timeoutMs?: number;
  /** 최대 후보지 수 (기본 5) */
  limit?: number;
}

export const KAKAO_ENDPOINT = 'https://dapi.kakao.com/v2/local/search/keyword.json';
export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_LIMIT = 5;
/** 한 번의 추천에서 카카오에 보낼 수 있는 최대 요청 수 (할당량 보호) */
const MAX_KAKAO_REQUESTS = 3;
/** 대한민국 좌표 범위 — 벗어난 값은 좌표 없음으로 본다 */
const LAT_RANGE = [33, 39.5] as const;
const LNG_RANGE = [124, 132] as const;

/** 검색 실패를 status 와 함께 나르는 내부 오류 */
class SearchError extends Error {
  status: SearchStatus;
  constructor(status: SearchStatus) {
    super(`SEARCH_${status.toUpperCase()}`);
    this.name = 'SearchError';
    this.status = status;
  }
}

/** HTTP 상태 코드를 검색 status 로 옮긴다 (429 할당량 · 401·403 키·도메인 · 나머지 오류) */
export function statusFromHttp(code: number): SearchStatus {
  if (code === 429) return 'quota';
  if (code === 401 || code === 403) return 'auth';
  return 'error';
}

/** 타임아웃을 건 fetch. fetchImpl 이 signal 을 무시해도 abort 와 경쟁시켜 제한 시간을 지킨다. */
async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const timeout = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new SearchError('error')), { once: true });
  });
  try {
    return await Promise.race([fetchImpl(url, { ...init, signal: controller.signal }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** 좌표 문자열·숫자를 한국 범위 안의 숫자로 정리한다. 범위 밖이거나 숫자가 아니면 null. */
export function toCoord(value: unknown, kind: 'lat' | 'lng'): number | null {
  const raw = typeof value === 'number' ? value : String(value ?? '').trim();
  if (raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const [min, max] = kind === 'lat' ? LAT_RANGE : LNG_RANGE;
  if (n < min || n > max) return null;
  return Math.round(n * 1e7) / 1e7;
}

/** 임의 객체를 Place 로 정리한다. 이름이 없으면 null. */
export function toPlace(input: unknown): Place | null {
  const p = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const name = cleanString(p.name, 80);
  if (!name) return null;
  return {
    id: cleanString(p.id, 40),
    name,
    address: cleanString(p.address, 160),
    url: safeHttpUrl(cleanString(p.url, 300)),
    category: cleanString(p.category, 40),
    lat: toCoord(p.lat, 'lat'),
    lng: toCoord(p.lng, 'lng'),
  };
}

/** 같은 장소를 두 번 담지 않는다 — 장소 ID 가 있으면 ID, 없으면 이름+주소 기준 */
export function placeKey(place: Place): string {
  return place.id ? `id:${place.id}` : `n:${place.name}|${place.address}`;
}

/** 이미 담긴 목록에 place 를 더한다 (중복이면 무시). 아직 자리가 남았으면 true */
function pushUnique(out: Place[], seen: Set<string>, place: Place, limit: number): boolean {
  const key = placeKey(place);
  if (!seen.has(key)) {
    seen.add(key);
    out.push(place);
  }
  return out.length < limit;
}

/** 검색어 조합 — "지역 키워드" 를 먼저 쓰고, 그래도 없으면 지역만 · 키워드만으로 넓힌다 */
export function buildQueries(region: string, keywords: string[]): string[] {
  const out: string[] = [];
  const add = (q: string) => {
    const query = q.trim();
    if (query && !out.includes(query)) out.push(query);
  };
  for (const keyword of keywords) add(`${region} ${keyword}`);
  add(region);
  for (const keyword of keywords) add(keyword);
  return out;
}

/** 결과가 없을 때 안내할 대체 검색어 (이미 써 본 검색어는 뺀다) */
export function buildAlternatives(region: string, keywords: string[], used: string[]): string[] {
  const base = region || keywords[0] || '';
  if (!base) return [];
  return [`${base} 카페`, `${base} 맛집`, `${base} 근처 모임 장소`]
    .filter((q) => !used.includes(q))
    .slice(0, 3);
}

/* ===== Kakao 로컬 키워드 검색 ===== */

interface KakaoDocument {
  id?: unknown;
  place_name?: unknown;
  road_address_name?: unknown;
  address_name?: unknown;
  place_url?: unknown;
  category_group_name?: unknown;
  category_name?: unknown;
  x?: unknown;
  y?: unknown;
}

/** 카카오 문서 배열을 Place 로 바꾼다 (x=경도, y=위도) */
export function mapKakaoDocuments(documents: unknown, limit: number): Place[] {
  if (!Array.isArray(documents)) return [];
  const out: Place[] = [];
  const seen = new Set<string>();
  for (const doc of documents as KakaoDocument[]) {
    const place = toPlace({
      id: doc?.id,
      name: doc?.place_name,
      address: cleanString(doc?.road_address_name, 160) || cleanString(doc?.address_name, 160),
      url: doc?.place_url,
      category: cleanString(doc?.category_group_name, 40) || cleanString(doc?.category_name, 40),
      lat: doc?.y,
      lng: doc?.x,
    });
    if (place && !pushUnique(out, seen, place, limit)) break;
  }
  return out;
}

async function searchKakao(
  opts: SearchOptions,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  limit: number,
  queries: string[],
  used: string[],
): Promise<Place[]> {
  const places: Place[] = [];
  const seen = new Set<string>();

  for (const query of queries.slice(0, MAX_KAKAO_REQUESTS)) {
    used.push(query);
    const url = `${KAKAO_ENDPOINT}?query=${encodeURIComponent(query)}&size=${limit}`;
    const res = await fetchWithTimeout(
      fetchImpl,
      url,
      { method: 'GET', headers: { Authorization: `KakaoAK ${opts.kakaoKey}` } },
      timeoutMs,
    );
    if (!res.ok) throw new SearchError(statusFromHttp(res.status));
    const payload = (await res.json()) as { documents?: unknown } | null;
    let room = true;
    for (const place of mapKakaoDocuments(payload?.documents, limit)) {
      room = pushUnique(places, seen, place, limit);
      if (!room) break;
    }
    // 필요한 만큼 모았으면 남은 검색어는 보내지 않는다 (할당량 보호)
    if (!room) break;
  }
  return places;
}

/* ===== OpenRouter 웹 검색 플러그인 ===== */

interface UrlCitation {
  url: string;
  title: string;
}

function buildOpenRouterPrompt(region: string, keywords: string[], limit: number): { system: string; user: string } {
  const system = `당신은 소모임 장소를 찾아 주는 한국어 도우미예요. 웹 검색 결과만 근거로, 실제로 존재하는 장소만 고르세요.

규칙:
1. 지어내거나 확실하지 않은 장소는 넣지 마세요. 검색 결과에 없는 장소는 제외하세요.
2. 각 장소의 name 은 상호명, address 는 도로명 또는 지번 주소, url 은 검색 결과의 링크, category 는 짧은 분류(예: 카페, 공원, 식당)로 적으세요.
3. 최대 ${limit}곳까지만 적고, 다른 설명이나 마크다운 없이 아래 형태의 JSON 객체 하나만 출력하세요.
{"places":[{"name":"상호명","address":"주소","url":"링크","category":"분류"}]}`;
  const user = JSON.stringify({
    region,
    keywords,
    request: `${region} 에서 ${keywords.join(', ')} 모임을 하기 좋은 실제 장소를 최대 ${limit}곳 찾아 주세요.`,
  });
  return { system, user };
}

function extractCitations(message: unknown): UrlCitation[] {
  const annotations = (message as { annotations?: unknown } | null)?.annotations;
  if (!Array.isArray(annotations)) return [];
  const out: UrlCitation[] = [];
  for (const a of annotations) {
    const ann = a as { type?: unknown; url_citation?: { url?: unknown; title?: unknown } } | null;
    if (!ann || ann.type !== 'url_citation') continue;
    const url = cleanString(ann.url_citation?.url, 300);
    if (!url) continue;
    out.push({ url, title: cleanString(ann.url_citation?.title, 120) });
  }
  return out;
}

function extractContent(message: unknown): string {
  const content = (message as { content?: unknown } | null)?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : String((part as { text?: unknown })?.text ?? '')))
      .join('');
  }
  return '';
}

/** url 이 없는 장소에 검색 인용 링크를 채운다 — 제목이 상호명과 겹치는 인용을 우선, 없으면 남은 인용을 순서대로 */
function fillUrlsFromCitations(places: Place[], citations: UrlCitation[]): Place[] {
  if (citations.length === 0) return places;
  const used = new Set<number>();
  return places.map((place) => {
    if (place.url) return place;
    let idx = citations.findIndex(
      (c, i) => !used.has(i) && c.title && (c.title.includes(place.name) || place.name.includes(c.title)),
    );
    if (idx < 0) idx = citations.findIndex((_, i) => !used.has(i));
    if (idx < 0) return place;
    used.add(idx);
    return { ...place, url: safeHttpUrl(citations[idx].url) };
  });
}

async function searchOpenRouter(
  opts: SearchOptions,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  limit: number,
  region: string,
  keywords: string[],
): Promise<Place[]> {
  const prompt = buildOpenRouterPrompt(region, keywords, limit);
  const body = {
    model: opts.model || 'openrouter/free',
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    plugins: [{ id: 'web', max_results: 5 }],
    temperature: 0.2,
  };

  const res = await fetchWithTimeout(
    fetchImpl,
    OPENROUTER_ENDPOINT,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://junyeong-nero.github.io/hanwha-ai-solution/',
        'X-Title': 'MoonLight Hanwha',
      },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
  if (!res.ok) throw new SearchError(statusFromHttp(res.status));

  const payload = (await res.json()) as { choices?: Array<{ message?: unknown }> } | null;
  const message = payload?.choices?.[0]?.message;
  const content = extractContent(message);
  if (!content.trim()) return [];

  const parsed = extractJsonObject(content) as { places?: unknown } | unknown[];
  const list = Array.isArray(parsed) ? parsed : (parsed as { places?: unknown })?.places;
  if (!Array.isArray(list)) return [];

  const places: Place[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const place = toPlace(item);
    if (place && !pushUnique(places, seen, place, limit)) break;
  }
  return fillUrlsFromCitations(places, extractCitations(message));
}

/**
 * 지역 + 키워드로 실제 장소를 검색한다.
 * - kakaoKey 가 있으면 Kakao 로컬 키워드 검색 (provider 'kakao')
 * - 없고 openRouterKey 가 있으면 OpenRouter 웹 검색 플러그인 (provider 'openrouter')
 * - 둘 다 없으면 status 'no_key'
 * 실패해도 예외를 던지지 않는다. 왜 비었는지는 status 로, 다음에 해 볼 검색어는 alternatives 로 알린다.
 */
export async function searchPlaces(opts: SearchOptions): Promise<SearchResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limit = Math.max(1, Math.min(15, Math.round(opts.limit ?? DEFAULT_LIMIT)));
  const region = cleanString(opts.region, 30);
  const keywords = (Array.isArray(opts.keywords) ? opts.keywords : [])
    .map((k) => cleanString(k, 30))
    .filter(Boolean);
  const queries = buildQueries(region, keywords);
  const used: string[] = [];

  const provider: SearchProvider = opts.kakaoKey ? 'kakao' : opts.openRouterKey ? 'openrouter' : 'none';
  if (provider === 'none') {
    return { provider, places: [], status: 'no_key', queries: [], alternatives: [] };
  }

  try {
    let places: Place[];
    if (provider === 'kakao') {
      places = await searchKakao(opts, fetchImpl, timeoutMs, limit, queries, used);
    } else {
      used.push(...queries.slice(0, 1));
      places = await searchOpenRouter(opts, fetchImpl, timeoutMs, limit, region, keywords);
    }
    return {
      provider,
      places,
      status: places.length > 0 ? 'ok' : 'empty',
      queries: used,
      alternatives: places.length > 0 ? [] : buildAlternatives(region, keywords, used),
    };
  } catch (err) {
    // 검색 실패는 약속 추천을 막지 않는다 (오류 내용은 키가 섞일 수 있어 기록하지 않는다)
    const status = err instanceof SearchError ? err.status : 'error';
    return { provider, places: [], status, queries: used, alternatives: buildAlternatives(region, keywords, used) };
  }
}
