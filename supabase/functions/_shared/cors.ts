// CORS 헤더와 공통 HTTP 응답 도우미 (순수 모듈 — Deno · Node 모두에서 동작)

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-demo-reset-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** JSON 본문과 CORS 헤더를 가진 응답 */
export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      ...extra,
    },
  });
}

/** OPTIONS 프리플라이트 응답 */
export function preflight(): Response {
  return new Response('ok', { status: 200, headers: corsHeaders });
}

/** 오류 응답 `{ error_code, message }` */
export function fail(status: number, errorCode: string, message: string): Response {
  return json({ error_code: errorCode, message }, status);
}

/** requireUser 등이 던지는 구조화된 오류 */
export interface HttpFailure {
  status: number;
  error_code: string;
  message?: string;
}

function isHttpFailure(err: unknown): err is HttpFailure {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as HttpFailure).status === 'number' &&
    typeof (err as HttpFailure).error_code === 'string'
  );
}

/**
 * 처리 중 던져진 예외를 응답으로 바꾼다.
 * 프롬프트·응답·키가 로그에 남지 않도록 오류 이름만 기록한다.
 */
export function errorResponse(err: unknown, fnName = 'edge-function'): Response {
  if (isHttpFailure(err)) {
    return fail(err.status, err.error_code, err.message ?? '요청을 처리할 수 없어요');
  }
  const name = err instanceof Error ? err.name : typeof err;
  console.error(`[${fnName}] 처리 중 오류: ${name}`);
  return fail(500, 'SERVER_ERROR', '잠시 후 다시 시도해 주세요');
}

/** 요청 본문을 JSON 객체로 읽는다. 비어 있거나 잘못된 JSON 이면 빈 객체. */
export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const text = await req.text();
    if (!text.trim()) return {};
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** UUID 형식 검사 */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
