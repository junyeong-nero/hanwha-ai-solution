import { sha256Hex } from './auth.ts';

// 신뢰할 프록시 개수는 배포자가 확인한 값만 사용한다. 미설정이면 공유 버킷으로 제한한다.
export function trustedClientIp(headers: Headers, hopsValue?: string): string {
  const hops = Number(hopsValue);
  if (!Number.isInteger(hops) || hops < 1 || hops > 10) return 'unknown';
  const parts = (headers.get('x-forwarded-for') ?? '').split(',').map((part) => part.trim());
  const ip = parts[parts.length - hops];
  if (!ip || !/^[0-9a-fA-F:.]+$/.test(ip)) return 'unknown';
  // IPv4·IPv6를 정규화해 표기 변경으로 버킷이 갈라지지 않게 한다.
  try {
    const host = new URL(ip.includes(':') ? `http://[${ip}]/` : `http://${ip}/`).hostname;
    if (host.startsWith('[') || /^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return host;
  } catch { /* 잘못된 헤더는 공유 버킷으로 처리한다. */ }
  return 'unknown';
}

export async function loginAttemptKeys(headers: Headers, company: string, employee: string, hops?: string): Promise<string[]> {
  return Promise.all([
    sha256Hex(`ip:${trustedClientIp(headers, hops)}`),
    sha256Hex(`account:${JSON.stringify([company, employee])}`),
  ]);
}
