// verify-demo-entry — 발표용 임시 입장 코드를 검증하고 호출자의 익명 세션과 결합한다.
// 요청: POST { code }  (Authorization: Bearer <익명 세션 JWT>)
// 응답: 200 { expires_at } / 401 INVALID_CODE·EXPIRED_CODE·CODE_EXHAUSTED·UNAUTHORIZED / 429 RATE_LIMITED
import { preflight, json, fail, errorResponse, readJsonBody } from '../_shared/cors.ts';
import { requireUser, serviceClient } from '../_shared/supabase.ts';
import { hashCode, sha256Hex, evaluateCode, isRateLimited, sessionExpiry } from '../_shared/auth.ts';

const FN = 'verify-demo-entry';
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const SESSION_HOURS = 12;

const MESSAGES: Record<string, string> = {
  INVALID_CODE: '입장 코드가 올바르지 않아요',
  EXPIRED_CODE: '만료된 입장 코드예요. 발표 화면의 새 코드를 확인해 주세요',
  CODE_EXHAUSTED: '이 입장 코드는 사용 한도를 넘었어요',
  RATE_LIMITED: '시도가 너무 많아요. 10분 뒤에 다시 해 주세요',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'POST 요청만 받을 수 있어요');

  try {
    const { user } = await requireUser(req);
    const body = await readJsonBody(req);
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!code || code.length > 32) return fail(401, 'INVALID_CODE', MESSAGES.INVALID_CODE);

    const svc = serviceClient();
    const now = new Date();

    // 1. 레이트리밋 — IP 해시 기준 10분 20회
    const forwarded = req.headers.get('x-forwarded-for') ?? '';
    const ip = forwarded.split(',')[0].trim() || 'unknown';
    const attemptKey = await sha256Hex(ip);
    const since = new Date(now.getTime() - RATE_WINDOW_MS).toISOString();

    const { data: attempts, error: attemptsError } = await svc
      .from('demo_entry_attempts')
      .select('attempted_at')
      .eq('attempt_key', attemptKey)
      .gte('attempted_at', since)
      .limit(RATE_LIMIT + 5);
    if (attemptsError) throw attemptsError;

    const stamps = (attempts ?? []).map((a: { attempted_at: string }) => new Date(a.attempted_at));
    if (isRateLimited(stamps, now, RATE_LIMIT, RATE_WINDOW_MS)) {
      return fail(429, 'RATE_LIMITED', MESSAGES.RATE_LIMITED);
    }
    const { error: insertAttemptError } = await svc.from('demo_entry_attempts').insert({ attempt_key: attemptKey });
    if (insertAttemptError) throw insertAttemptError;

    // 2. 코드 조회 · 검증
    const codeHash = await hashCode(code);
    const { data: row, error: rowError } = await svc
      .from('demo_access_codes')
      .select('id, active, expires_at, use_count, max_uses')
      .eq('code_hash', codeHash)
      .maybeSingle();
    if (rowError) throw rowError;

    if (!row) return fail(401, 'INVALID_CODE', MESSAGES.INVALID_CODE);
    const verdict = evaluateCode(row, now);
    if (verdict !== 'ok') return fail(401, verdict, MESSAGES[verdict]);

    // 3. 사용 횟수 원자적 증가 (동시 입장으로 한도를 넘지 않도록 DB 함수에서 조건부 갱신)
    const { data: consumed, error: consumeError } = await svc.rpc('consume_demo_code', { p_code_id: row.id });
    if (consumeError) throw consumeError;
    if (!consumed) return fail(401, 'CODE_EXHAUSTED', MESSAGES.CODE_EXHAUSTED);

    // 4. 세션 결합
    const expiresAt = sessionExpiry(now, SESSION_HOURS);
    const { error: sessionError } = await svc
      .from('demo_sessions')
      .insert({ user_id: user.id, code_id: row.id, expires_at: expiresAt });
    if (sessionError) throw sessionError;

    return json({ expires_at: expiresAt });
  } catch (err) {
    return errorResponse(err, FN);
  }
});
