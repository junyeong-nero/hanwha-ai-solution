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

async function attempt(opts: ChatJsonOptions, timeoutMs: number, fetchImpl: typeof fetch): Promise<string> {
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
        body: JSON.stringify({
          model: opts.model,
          messages: [
            { role: 'system', content: opts.system },
            { role: 'user', content: opts.user },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2,
        }),
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
 * TIMEOUT · HTTP 429 · HTTP 5xx · 네트워크 오류는 자동으로 1회 재시도한다.
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
    throw err;
  }
}
