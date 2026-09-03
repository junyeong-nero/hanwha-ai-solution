// 웹 검색으로 약속 후보지를 찾는다 (순수 모듈 — Deno · Node 모두에서 동작)
// 1순위 Kakao 로컬 키워드 검색, 2순위 OpenRouter 웹 검색 플러그인, 둘 다 없으면 빈 결과.
// 검색은 약속 추천을 절대 막지 않는다 — 어떤 오류가 나도 { provider: 'none', places: [] } 로 끝난다.
// API 키·프롬프트·응답은 로그에 남기지 않는다.
import { extractJsonObject, cleanString } from './json.ts';

export interface Place {
  name: string;
  address: string;
  url: string;
  category: string;
}

export type SearchProvider = 'kakao' | 'openrouter' | 'none';

export interface SearchResult {
  provider: SearchProvider;
  places: Place[];
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
const MAX_KAKAO_REQUESTS = 2;

const NONE: SearchResult = { provider: 'none', places: [] };

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
    controller.signal.addEventListener('abort', () => reject(new Error('SEARCH_TIMEOUT')), { once: true });
  });
  try {
    return await Promise.race([fetchImpl(url, { ...init, signal: controller.signal }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** 임의 객체를 Place 로 정리한다. 이름이 없으면 null. */
function toPlace(input: unknown): Place | null {
  const p = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const name = cleanString(p.name, 80);
  if (!name) return null;
  return {
    name,
    address: cleanString(p.address, 160),
    url: cleanString(p.url, 300),
    category: cleanString(p.category, 40),
  };
}

/* ===== Kakao 로컬 키워드 검색 ===== */

interface KakaoDocument {
  place_name?: unknown;
  road_address_name?: unknown;
  address_name?: unknown;
  place_url?: unknown;
  category_group_name?: unknown;
  category_name?: unknown;
}

function mapKakaoDocuments(documents: unknown, limit: number): Place[] {
  if (!Array.isArray(documents)) return [];
  const out: Place[] = [];
  for (const doc of documents as KakaoDocument[]) {
    const place = toPlace({
      name: doc?.place_name,
      address: cleanString(doc?.road_address_name, 160) || cleanString(doc?.address_name, 160),
      url: doc?.place_url,
      category: cleanString(doc?.category_group_name, 40) || cleanString(doc?.category_name, 40),
    });
    if (place) out.push(place);
    if (out.length >= limit) break;
  }
  return out;
}

async function searchKakao(
  opts: SearchOptions,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  limit: number,
): Promise<Place[]> {
  const region = cleanString(opts.region, 30);
  const keywords = (Array.isArray(opts.keywords) ? opts.keywords : [])
    .map((k) => cleanString(k, 30))
    .filter(Boolean);
  // 첫 키워드로 검색하고 결과가 없으면 다음 키워드로 한 번 더 (최대 2회)
  const queries = keywords.length > 0
    ? keywords.slice(0, MAX_KAKAO_REQUESTS).map((k) => `${region} ${k}`.trim())
    : [region];

  for (const query of queries) {
    if (!query) continue;
    const url = `${KAKAO_ENDPOINT}?query=${encodeURIComponent(query)}&size=${limit}`;
    const res = await fetchWithTimeout(
      fetchImpl,
      url,
      { method: 'GET', headers: { Authorization: `KakaoAK ${opts.kakaoKey}` } },
      timeoutMs,
    );
    if (!res.ok) throw new Error(`KAKAO_HTTP_${res.status}`);
    const payload = (await res.json()) as { documents?: unknown } | null;
    const places = mapKakaoDocuments(payload?.documents, limit);
    if (places.length > 0) return places;
  }
  return [];
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
    return { ...place, url: citations[idx].url };
  });
}

async function searchOpenRouter(
  opts: SearchOptions,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  limit: number,
): Promise<Place[]> {
  const region = cleanString(opts.region, 30);
  const keywords = (Array.isArray(opts.keywords) ? opts.keywords : [])
    .map((k) => cleanString(k, 30))
    .filter(Boolean);
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
  if (!res.ok) throw new Error(`OPENROUTER_HTTP_${res.status}`);

  const payload = (await res.json()) as { choices?: Array<{ message?: unknown }> } | null;
  const message = payload?.choices?.[0]?.message;
  const content = extractContent(message);
  if (!content.trim()) return [];

  const parsed = extractJsonObject(content) as { places?: unknown } | unknown[];
  const list = Array.isArray(parsed) ? parsed : (parsed as { places?: unknown })?.places;
  if (!Array.isArray(list)) return [];

  const places: Place[] = [];
  for (const item of list) {
    const place = toPlace(item);
    if (place) places.push(place);
    if (places.length >= limit) break;
  }
  return fillUrlsFromCitations(places, extractCitations(message));
}

/**
 * 지역 + 키워드로 실제 장소를 검색한다.
 * - kakaoKey 가 있으면 Kakao 로컬 키워드 검색 (provider 'kakao')
 * - 없고 openRouterKey 가 있으면 OpenRouter 웹 검색 플러그인 (provider 'openrouter')
 * - 둘 다 없거나 어떤 단계에서든 실패하면 { provider: 'none', places: [] }
 */
export async function searchPlaces(opts: SearchOptions): Promise<SearchResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limit = Math.max(1, Math.min(15, Math.round(opts.limit ?? DEFAULT_LIMIT)));

  try {
    if (opts.kakaoKey) {
      const places = await searchKakao(opts, fetchImpl, timeoutMs, limit);
      return { provider: 'kakao', places };
    }
    if (opts.openRouterKey) {
      const places = await searchOpenRouter(opts, fetchImpl, timeoutMs, limit);
      return { provider: 'openrouter', places };
    }
    return NONE;
  } catch {
    // 검색 실패는 약속 추천을 막지 않는다 (오류 내용은 키가 섞일 수 있어 기록하지 않는다)
    return { provider: 'none', places: [] };
  }
}
