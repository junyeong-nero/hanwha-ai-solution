// demo-login — 입장 코드 + 계열사 + 사번 + 이름으로 발표용 계정을 만들거나 찾아 세션을 발급한다.
// 같은 (계열사, 사번) 은 어느 기기에서든 같은 계정이라 프로필·채팅이 복원되고, 동명이인은 사번으로 구분된다.
// 비밀번호는 서버 비밀키(DEMO_LOGIN_SECRET)로만 파생되므로 클라이언트에는 세션만 내려간다.
//
// 요청: POST { code, company_id, employee_no, real_name, nickname? }   (JWT 불필요 · verify_jwt=false)
// 응답: 200 { session: { access_token, refresh_token }, is_new, expires_at }
//       400 BAD_REQUEST / 401 INVALID_CODE·EXPIRED_CODE·CODE_EXHAUSTED·NAME_MISMATCH / 429 RATE_LIMITED
import { preflight, json, fail, errorResponse, readJsonBody } from '../_shared/cors.ts';
import { serviceClient, anonClient } from '../_shared/supabase.ts';
import {
  hashCode,
  sha256Hex,
  evaluateCode,
  isRateLimited,
  sessionExpiry,
  normalizeEmployeeNo,
  normalizeName,
  syntheticEmail,
  derivePassword,
} from '../_shared/auth.ts';

const FN = 'demo-login';
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const SESSION_HOURS = 12;

const MESSAGES: Record<string, string> = {
  INVALID_CODE: '입장 코드가 올바르지 않아요',
  EXPIRED_CODE: '만료된 입장 코드예요. 발표 화면의 새 코드를 확인해 주세요',
  CODE_EXHAUSTED: '이 입장 코드는 사용 한도를 넘었어요',
  RATE_LIMITED: '시도가 너무 많아요. 10분 뒤에 다시 해 주세요',
  NAME_MISMATCH: '사번과 이름이 일치하지 않아요. 입력 내용을 확인해 주세요',
};

interface ProfileRow {
  user_id: string;
  real_name: string;
  nickname: string;
}

/** createUser 가 "이미 있는 이메일" 로 실패했는지 */
function isEmailExists(err: unknown): boolean {
  const e = err as { code?: string; status?: number; message?: string } | null;
  if (!e) return false;
  if (e.code === 'email_exists' || e.code === 'user_already_exists') return true;
  if (e.status === 422 && /registered|exists/i.test(e.message ?? '')) return true;
  return false;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'POST 요청만 받을 수 있어요');

  try {
    const secret = Deno.env.get('DEMO_LOGIN_SECRET') ?? '';
    if (!secret) throw new Error('DEMO_LOGIN_SECRET 미설정');

    const body = await readJsonBody(req);
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const companyId = typeof body.company_id === 'string' ? body.company_id.trim().toLowerCase() : '';
    const employeeNo = normalizeEmployeeNo(body.employee_no);
    const realName = normalizeName(body.real_name);
    const nickname = typeof body.nickname === 'string' ? body.nickname.trim().slice(0, 8) : '';

    if (!code || code.length > 32) return fail(401, 'INVALID_CODE', MESSAGES.INVALID_CODE);
    if (!companyId || !employeeNo || !realName) {
      return fail(400, 'BAD_REQUEST', '계열사·사번·이름을 모두 입력해 주세요');
    }

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

    // 2. 계열사 존재 확인
    const { data: company, error: companyError } = await svc
      .from('companies')
      .select('id')
      .eq('id', companyId)
      .maybeSingle();
    if (companyError) throw companyError;
    if (!company) return fail(400, 'BAD_REQUEST', '계열사를 다시 선택해 주세요');

    // 3. 입장 코드 검증
    const codeHash = await hashCode(code);
    const { data: codeRow, error: codeError } = await svc
      .from('demo_access_codes')
      .select('id, active, expires_at, use_count, max_uses')
      .eq('code_hash', codeHash)
      .maybeSingle();
    if (codeError) throw codeError;
    if (!codeRow) return fail(401, 'INVALID_CODE', MESSAGES.INVALID_CODE);
    const verdict = evaluateCode(codeRow, now);
    if (verdict !== 'ok') return fail(401, verdict, MESSAGES[verdict]);

    // 4. (계열사, 사번) 으로 기존 프로필 조회 — 있으면 이름이 일치해야 한다
    const { data: existing, error: existingError } = await svc
      .from('profiles')
      .select('user_id, real_name, nickname')
      .eq('company_id', companyId)
      .eq('employee_no', employeeNo)
      .maybeSingle<ProfileRow>();
    if (existingError) throw existingError;
    if (existing && existing.real_name !== realName) {
      return fail(401, 'NAME_MISMATCH', MESSAGES.NAME_MISMATCH);
    }

    // 5. 입장 코드 사용 횟수 소비 (원자적)
    const { data: consumed, error: consumeError } = await svc.rpc('consume_demo_code', { p_code_id: codeRow.id });
    if (consumeError) throw consumeError;
    if (!consumed) return fail(401, 'CODE_EXHAUSTED', MESSAGES.CODE_EXHAUSTED);

    // 6. 결정적 계정 준비 — 이메일은 계열사.사번, 비밀번호는 서버 비밀키로 파생
    //    비밀번호를 바꾸면 그 사용자의 다른 기기 세션이 모두 끊기므로, 먼저 그대로 로그인해 보고
    //    실패할 때(처음 입장 · 비밀키 교체 · reset 이후)만 계정을 만들거나 비밀번호를 맞춘다.
    const email = syntheticEmail(companyId, employeeNo);
    const password = await derivePassword(secret, email);
    const anon = anonClient();

    let signIn = await anon.auth.signInWithPassword({ email, password });
    let userId: string | null = signIn.data.session?.user.id ?? null;

    if (!userId) {
      const { data: created, error: createError } = await svc.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { demo: true },
      });
      if (createError) {
        if (!isEmailExists(createError)) throw createError;
        // 계정은 있는데 비밀번호가 파생값과 다른 경우 — 비밀번호를 맞춘다 (이때만 다른 세션이 끊긴다)
        let foundId: string | null = existing?.user_id ?? null;
        if (!foundId) {
          const { data: page, error: listError } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
          if (listError) throw listError;
          const found = (page?.users ?? []).find((u: { email?: string }) => (u.email ?? '').toLowerCase() === email);
          if (!found) throw new Error('계정 조회 실패');
          foundId = found.id;
        }
        const { error: pwError } = await svc.auth.admin.updateUserById(foundId, { password });
        if (pwError) throw pwError;
      }
      // 7. 서버에서 대신 로그인해 세션을 받는다
      signIn = await anon.auth.signInWithPassword({ email, password });
      userId = signIn.data.session?.user.id ?? null;
    }
    if (signIn.error || !signIn.data.session || !userId) throw signIn.error ?? new Error('세션 발급 실패');
    if (existing && existing.user_id !== userId) throw new Error('계정·프로필 불일치');

    // 8. 프로필 생성 (처음 입장) — 기존 프로필은 건드리지 않는다 (닉네임·설정은 앱 안에서 바꾼다)
    const isNew = !existing;
    if (isNew) {
      const { error: profileError } = await svc.from('profiles').upsert(
        {
          user_id: userId,
          employee_no: employeeNo,
          company_id: companyId,
          real_name: realName,
          nickname: nickname || '달토끼',
          region: '판교',
        },
        { onConflict: 'user_id' },
      );
      if (profileError) throw profileError;
    }

    // 9. 입장 코드와 세션 결합
    const expiresAt = sessionExpiry(now, SESSION_HOURS);
    const { error: sessionError } = await svc
      .from('demo_sessions')
      .insert({ user_id: userId, code_id: codeRow.id, expires_at: expiresAt });
    if (sessionError) throw sessionError;

    return json({
      session: { access_token: signIn.data.session.access_token, refresh_token: signIn.data.session.refresh_token },
      is_new: isNew,
      expires_at: expiresAt,
    });
  } catch (err) {
    return errorResponse(err, FN);
  }
});
