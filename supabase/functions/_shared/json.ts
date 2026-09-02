// LLM 응답 문자열에서 JSON 객체를 꺼내는 도우미 (순수 모듈)

/**
 * 원문에서 첫 번째 JSON 객체를 찾아 파싱한다.
 * ```json 코드 펜스와 앞뒤 설명 문장을 허용한다.
 * 객체를 찾지 못하면 Error('INVALID_LLM_OUTPUT') 을 던진다.
 */
export function extractJsonObject(raw: string): unknown {
  const text = String(raw ?? '').replace(/```[a-zA-Z]*/g, '').trim();
  if (!text) throw new Error('INVALID_LLM_OUTPUT');

  // 전체가 JSON 이면 바로 사용
  try {
    const whole: unknown = JSON.parse(text);
    if (whole && typeof whole === 'object') return whole;
  } catch {
    // 아래에서 중괄호 범위를 직접 찾는다
  }

  const start = text.indexOf('{');
  if (start < 0) throw new Error('INVALID_LLM_OUTPUT');

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          throw new Error('INVALID_LLM_OUTPUT');
        }
      }
    }
  }
  throw new Error('INVALID_LLM_OUTPUT');
}

/** 문자열이면 공백을 정리해 돌려주고, 아니면 빈 문자열 */
export function cleanString(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

/** 문자열 배열만 남기고 정리한다 */
export function cleanStringArray(value: unknown, maxLen: number, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const s = cleanString(item, maxLen);
    if (s) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}
