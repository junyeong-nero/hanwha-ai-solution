-- 스몰토크도 사용자·모임·전역 예산을 예약한다. 장소 추천의 기존 모임 예산 키는 유지한다.
create or replace function public.consume_ai_budget(
  p_user uuid, p_function text, p_meeting uuid default null,
  p_user_limit integer default 10, p_meeting_limit integer default 3, p_daily_limit integer default 1000
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_now timestamptz;
  v_scopes text[];
  v_limits integer[];
  v_expiries timestamptz[];
  i integer;
begin
  if p_user is null or p_function is null or p_function not in ('recommend-meetings','suggest-meeting-plan','suggest-small-talk')
    or (p_function in ('suggest-meeting-plan','suggest-small-talk') and p_meeting is null)
    or p_user_limit is null or p_user_limit not between 1 and 100
    or p_meeting_limit is null or p_meeting_limit not between 1 and 100
    or p_daily_limit is null or p_daily_limit not between 1 and 100000 then
    raise exception '잘못된 AI 호출 제한 설정';
  end if;
  -- 전역 예산도 검사하므로 모든 인스턴스·사용자·함수 요청을 짧게 직렬화한다.
  perform pg_advisory_xact_lock(hashtextextended('ai-request-budget',0));
  v_now := clock_timestamp();
  v_scopes := array['global:day', 'user:' || p_function || ':' || p_user];
  v_limits := array[p_daily_limit, p_user_limit];
  v_expiries := array[
    (date_trunc('day',v_now at time zone 'UTC') + interval '1 day') at time zone 'UTC',
    v_now + interval '10 minutes'
  ];
  if p_function in ('suggest-meeting-plan','suggest-small-talk') then
    v_scopes := array_append(v_scopes, 'meeting:' || case when p_function = 'suggest-small-talk' then 'talk:' else '' end || p_meeting);
    v_limits := array_append(v_limits, p_meeting_limit);
    v_expiries := array_append(v_expiries, v_now + interval '10 minutes');
  end if;
  delete from ai_request_budgets where expires_at <= v_now;
  for i in 1..cardinality(v_scopes) loop
    if coalesce((select used from ai_request_budgets where scope = v_scopes[i]),0) >= v_limits[i] then
      return false;
    end if;
  end loop;
  for i in 1..cardinality(v_scopes) loop
    insert into ai_request_budgets(scope,used,expires_at) values(v_scopes[i],1,v_expiries[i])
      on conflict(scope) do update set used = ai_request_budgets.used + 1;
  end loop;
  return true;
end;
$$;
revoke all on function public.consume_ai_budget(uuid,text,uuid,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_ai_budget(uuid,text,uuid,integer,integer,integer) to service_role;
