// OpenRouter Chat Completions 호출 (순수 모듈 — Deno · Node 모두에서 동작)
// 프롬프트 · 응답 · API 키는 절대 로그에 남기지 않는다.

export type LlmErrorCode = 'TIMEOUT' | 'HTTP' | 'EMPTY';

export class LlmError extends Error {
  code: LlmErrorCode;
  status: number | undefined;

  constructor(code: LlmErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.status = status;
  }
}

export interface ChatJsonOptions {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  /** 요청당 타임아웃 (기본 20초) */
  timeoutMs?: number;
  /** 테스트용 fetch 주입 */
  fetchImpl?: typeof fetch;
}

export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 20000;

function isRetryable(err: LlmError): boolean {
  if (err.code === 'TIMEOUT') return true;
  if (err.code !== 'HTTP') return false;
  const status = err.status ?? 0;
  return status === 0 || status === 429 || status >= 500;
}

function extractContent(payload: unknown): string {
  const choices = (payload as { choices?: unknown[] } | null)?.choices;
  const first = Array.isArray(choices) ? (choices[0] as { message?: { content?: unknown } } | undefined) : undefined;
  const content = first?.message?.content;
  if (typeof content === 'string') return content;
  // 일부 모델은 content 를 파트 배열로 돌려준다
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : String((part as { text?: unknown })?.text ?? '')))
      .join('');
  }
  return '';
}

/**
 * 요청 본문. `compat` 모드에서는 일부 무료 모델이 거부하는 `response_format` 과 system 역할을 빼고,
 * 시스템 지시를 user 메시지 앞에 붙인다 (HTTP 400 대응).
 */
function buildBody(opts: ChatJsonOptions, compat: boolean): string {
  const messages = compat
    ? [{ role: 'user', content: `${opts.system}\n\n---\n\n${opts.user}` }]
    : [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ];
  const body: Record<string, unknown> = { model: opts.model, messages, temperature: 0.2 };
  if (!compat) body.response_format = { type: 'json_object' };
  return JSON.stringify(body);
}

async function attempt(opts: ChatJsonOptions, timeoutMs: number, fetchImpl: typeof fetch, compat = false): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // fetchImpl 이 signal 을 무시하더라도 타임아웃이 걸리도록 abort 와 경쟁시킨다
  const timeout = new Promise<never>((_, reject) => {
    controller.signal.addEventListener(
      'abort',
      () => reject(new LlmError('TIMEOUT', `OpenRouter 응답이 ${timeoutMs}ms 안에 오지 않았어요`)),
      { once: true },
    );
  });

  let res: Response;
  try {
    res = await Promise.race([
      fetchImpl(OPENROUTER_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://junyeong-nero.github.io/hanwha-ai-solution/',
          'X-Title': 'MoonLight Hanwha',
        },
        body: buildBody(opts, compat),
        signal: controller.signal,
      }),
      timeout,
    ]);
  } catch (err) {
    if (err instanceof LlmError) throw err;
    if (controller.signal.aborted) {
      throw new LlmError('TIMEOUT', `OpenRouter 응답이 ${timeoutMs}ms 안에 오지 않았어요`);
    }
    // 네트워크 오류 — 상태 0 으로 재시도 대상
    throw new LlmError('HTTP', 'OpenRouter 에 연결할 수 없어요', 0);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new LlmError('HTTP', `OpenRouter 응답 오류 (HTTP ${res.status})`, res.status);
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new LlmError('EMPTY', 'OpenRouter 응답 본문을 읽을 수 없어요');
  }

  const content = extractContent(payload);
  if (!content.trim()) throw new LlmError('EMPTY', 'OpenRouter 응답에 내용이 없어요');
  return content;
}

/**
 * OpenRouter 에 JSON 전용 채팅 요청을 보내고 `choices[0].message.content` 문자열을 돌려준다.
 * - TIMEOUT · HTTP 429 · HTTP 5xx · 네트워크 오류는 같은 요청으로 1회 재시도한다.
 * - HTTP 400 은 모델이 `response_format` 이나 system 역할을 지원하지 않는 경우가 대부분이므로
 *   호환 모드(둘 다 제거, 지시를 user 메시지에 합침)로 1회 재시도한다.
 */
export async function chatJson(opts: ChatJsonOptions): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    return await attempt(opts, timeoutMs, fetchImpl);
  } catch (err) {
    if (err instanceof LlmError && isRetryable(err)) {
      return await attempt(opts, timeoutMs, fetchImpl);
    }
    if (err instanceof LlmError && err.code === 'HTTP' && err.status === 400) {
      return await attempt(opts, timeoutMs, fetchImpl, true);
    }
    throw err;
  }
}
