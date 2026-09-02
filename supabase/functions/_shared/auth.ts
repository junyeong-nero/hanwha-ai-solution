// 입장 코드 해시 · 만료 · 레이트리밋 판정 (순수 모듈 — Deno · Node 모두에서 동작)

/** SHA-256 hex 다이제스트 */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 입장 코드를 저장·비교용 해시로 바꾼다 (demo_access_codes.code_hash 와 동일한 방식) */
export function hashCode(code: string): Promise<string> {
  return sha256Hex(code);
}

export interface DemoCodeRow {
  active: boolean;
  expires_at: string;
  use_count: number;
  max_uses: number;
}

export type CodeVerdict = 'ok' | 'INVALID_CODE' | 'EXPIRED_CODE' | 'CODE_EXHAUSTED';

/**
 * 입장 코드 행을 검사한다.
 * - 행이 없으면 INVALID_CODE
 * - 비활성 또는 만료면 EXPIRED_CODE (운영자가 끈 코드도 사용자에게는 "만료"로 보인다)
 * - 사용 횟수를 다 썼으면 CODE_EXHAUSTED
 */
export function evaluateCode(row: DemoCodeRow | null | undefined, now: Date): CodeVerdict {
  if (!row) return 'INVALID_CODE';
  if (!row.active) return 'EXPIRED_CODE';
  const expires = new Date(row.expires_at).getTime();
  if (Number.isNaN(expires) || expires <= now.getTime()) return 'EXPIRED_CODE';
  if (Number(row.use_count) >= Number(row.max_uses)) return 'CODE_EXHAUSTED';
  return 'ok';
}

/**
 * 창(windowMs) 안의 시도 횟수가 limit 이상이면 true.
 * 기본값: 10분에 20회.
 */
export function isRateLimited(attemptTimestamps: Date[], now: Date, limit = 20, windowMs = 600000): boolean {
  const from = now.getTime() - windowMs;
  let count = 0;
  for (const t of attemptTimestamps) {
    const ms = t instanceof Date ? t.getTime() : new Date(t).getTime();
    if (!Number.isNaN(ms) && ms >= from) count++;
  }
  return count >= limit;
}

/** 세션 만료 시각 (기본 12시간 뒤) ISO 문자열 */
export function sessionExpiry(now: Date, hours = 12): string {
  return new Date(now.getTime() + hours * 3600 * 1000).toISOString();
}

/**
 * 관리 토큰 비교. 두 값을 각각 해시한 뒤 길이가 같은 문자열을 끝까지 비교해
 * 길이·내용에 따른 조기 종료를 피한다.
 */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const [ha, hb] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = ha.length ^ hb.length;
  for (let i = 0; i < ha.length; i++) {
    diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i % hb.length);
  }
  return diff === 0;
}
