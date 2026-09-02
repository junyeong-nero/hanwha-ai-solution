// Supabase 클라이언트 생성 (Deno 런타임 전용 — Node 테스트에서는 import 하지 않는다)
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';
import type { HttpFailure } from './cors.ts';

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`환경변수 ${name} 이(가) 설정되지 않았어요`);
  return value;
}

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

/** 호출자의 Authorization 헤더를 그대로 넘기는 클라이언트 (RLS · auth.uid() 가 호출자 기준으로 적용된다) */
export function callerClient(req: Request): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
    ...clientOptions,
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
}

/** 서비스 역할 클라이언트 (RLS 우회). SUPABASE_SECRET_KEY 가 없으면 SUPABASE_SERVICE_ROLE_KEY 를 쓴다. */
export function serviceClient(): SupabaseClient {
  const key = Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) throw new Error('환경변수 SUPABASE_SECRET_KEY 이(가) 설정되지 않았어요');
  return createClient(requireEnv('SUPABASE_URL'), key, clientOptions);
}

const unauthorized: HttpFailure = {
  status: 401,
  error_code: 'UNAUTHORIZED',
  message: '로그인 세션이 없어요. 다시 입장해 주세요',
};

/** 호출자 JWT 를 검증하고 사용자와 호출자 스코프 클라이언트를 돌려준다. 실패하면 401 HttpFailure 를 던진다. */
export async function requireUser(req: Request): Promise<{ user: User; client: SupabaseClient }> {
  const header = req.headers.get('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw unauthorized;

  const client = callerClient(req);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) throw unauthorized;
  return { user: data.user, client };
}
