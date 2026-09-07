// 제한 설정은 서버 환경변수만 받는다. 잘못된 값은 안전한 기본값으로 돌아간다.
export function budgetLimit(value: string | undefined, fallback: number, max: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : fallback;
}

export async function consumeAIBudget(
  svc: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> },
  userId: string, functionName: string, meetingId: string | null,
  env: (key: string) => string | undefined,
): Promise<boolean> {
  try {
    const { data, error } = await svc.rpc('consume_ai_budget', {
      p_user: userId, p_function: functionName, p_meeting: meetingId,
      p_user_limit: budgetLimit(env('AI_USER_WINDOW_LIMIT'), 10, 100),
      p_meeting_limit: budgetLimit(env('AI_MEETING_WINDOW_LIMIT'), 3, 100),
      p_daily_limit: budgetLimit(env('AI_DAILY_REQUEST_LIMIT'), 1000, 100000),
    });
    // DB 오류·미배포도 외부 호출을 허용하지 않는다.
    if (error) console.error('[ai-limit] 예산 확인 실패');
    return !error && data === true;
  } catch {
    console.error('[ai-limit] 예산 저장소 연결 실패');
    return false;
  }
}
