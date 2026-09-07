-- 검사와 기록을 한 트랜잭션에서 수행해 동시 입장 시도도 제한한다.
create or replace function public.consume_login_attempt(p_keys text[])
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_key text;
  v_now timestamptz;
begin
  if cardinality(p_keys) <> 2 or p_keys is null or exists (
    select 1 from unnest(p_keys) k where k is null or k !~ '^[a-f0-9]{64}$'
  ) then raise exception '잘못된 입장 제한 키'; end if;
  -- 동일한 순서로 잠가 여러 키를 쓰는 요청 사이의 교착을 피한다.
  for v_key in select distinct k from unnest(p_keys) k order by k loop
    perform pg_advisory_xact_lock(hashtextextended('login:' || v_key, 0));
  end loop;
  v_now := clock_timestamp();
  foreach v_key in array p_keys loop
    if (select count(*) from demo_entry_attempts where attempt_key = v_key
      and attempted_at > v_now - interval '10 minutes') >= 20 then return false; end if;
  end loop;
  delete from demo_entry_attempts where attempted_at <= v_now - interval '1 day';
  insert into demo_entry_attempts(attempt_key, attempted_at)
    select distinct k, v_now from unnest(p_keys) k;
  return true;
end;
$$;
revoke all on function public.consume_login_attempt(text[]) from public, anon, authenticated;
grant execute on function public.consume_login_attempt(text[]) to service_role;
