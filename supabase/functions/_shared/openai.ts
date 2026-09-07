// OpenAI Responses API — 키·프롬프트·응답 원문을 로그에 남기지 않는다.
export const OPENAI_MODEL = 'gpt-5.4-mini';
export const OPENAI_ENDPOINT = 'https://api.openai.com/v1/responses';

export class OpenAIError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.name = 'OpenAIError';
    this.code = code;
  }
}

export interface JsonRequest {
  apiKey: string;
  system: string;
  user: string;
  name: string;
  schema: Record<string, unknown>;
  timeoutMs?: number;
  maxOutputTokens?: number;
  fetchImpl?: typeof fetch;
}

export function errorCode(err: unknown): string {
  if (err instanceof OpenAIError) return err.code;
  return err instanceof Error && err.message === 'INVALID_LLM_OUTPUT' ? err.message : 'UNKNOWN';
}

/** 본문 읽기를 포함해 20초로 제한한다. 실패하면 호출자가 기본 결과를 사용한다. */
export async function responsesJson(opts: JsonRequest): Promise<{ raw: string; usage: unknown }> {
  if (!opts.apiKey.trim()) throw new OpenAIError('NO_API_KEY');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000);
  const timeout = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new OpenAIError('TIMEOUT')), { once: true });
  });
  try {
    return await Promise.race([(async () => {
      const res = await (opts.fetchImpl ?? fetch)(OPENAI_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: OPENAI_MODEL,
          store: false,
          reasoning: { effort: 'none' },
          max_output_tokens: opts.maxOutputTokens ?? 4000,
          input: [
            { role: 'system', content: opts.system },
            { role: 'user', content: opts.user },
          ],
          text: { format: { type: 'json_schema', name: opts.name, strict: true, schema: opts.schema } },
        }),
      });
      if (!res.ok) throw new OpenAIError(`HTTP_${res.status}`);
      const payload = await res.json();
      if (payload?.status !== 'completed') throw new OpenAIError('INCOMPLETE');
      const parts = (Array.isArray(payload.output) ? payload.output : [])
        .filter((item: { type?: string }) => item?.type === 'message')
        .flatMap((item: { content?: unknown[] }) => Array.isArray(item.content) ? item.content : []);
      if (parts.some((p: { type?: string }) => p?.type === 'refusal')) throw new OpenAIError('REFUSAL');
      const raw = parts.filter((p: { type?: string }) => p?.type === 'output_text')
        .map((p: { text?: unknown }) => typeof p.text === 'string' ? p.text : '').join('');
      if (!raw.trim()) throw new OpenAIError('EMPTY');
      try { JSON.parse(raw); } catch { throw new OpenAIError('INVALID_LLM_OUTPUT'); }
      return { raw, usage: payload.usage ?? null };
    })(), timeout]);
  } catch (err) {
    if (err instanceof OpenAIError) throw err;
    throw new OpenAIError(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_OR_JSON');
  } finally {
    clearTimeout(timer);
  }
}

/** 모든 필드를 필수로 하는 Structured Outputs 객체 스키마. */
export function objectSchema(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

/** 비용 확인용 토큰 수만 추린다. 공급자 응답 원문은 기록하지 않는다. */
export function tokenUsage(usage: unknown) {
  const value = (usage && typeof usage === 'object' ? usage : {}) as Record<string, unknown>;
  const count = (key: string) => typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0 ? value[key] : 0;
  return { input_tokens: count('input_tokens'), output_tokens: count('output_tokens') };
}
