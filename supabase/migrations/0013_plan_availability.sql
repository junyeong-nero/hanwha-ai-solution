-- 약속 행 잠금으로 범위 변경·개인 응답·최종 선택·확정 투표를 직렬화한다.
alter table public.meeting_plans add column schedule jsonb;
alter table public.meeting_plans add column schedule_host uuid references auth.users(id);
update public.meeting_plans p set schedule_host = coalesce(m.created_by,p.created_by)
from public.meetings m where m.id=p.meeting_id;
create function public.set_schedule_host() returns trigger language plpgsql security definer set search_path=public as $$
begin
  new.schedule_host := coalesce((select created_by from public.meetings where id=new.meeting_id),new.created_by);
  return new;
end $$;
create trigger meeting_plan_schedule_host before insert on public.meeting_plans
for each row execute function public.set_schedule_host();

create function public.update_plan_schedule(p_plan_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  p public.meeting_plans;
  c jsonb;
  d1 date; d2 date; lo integer; hi integer;
  valid_slots text[];
  submitted text[];
  selected_at timestamptz;
  member_count integer;
  best_count integer;
  selected_count integer;
begin
  select * into p from public.meeting_plans where id=p_plan_id for update;
  if p.id is null or not exists(select 1 from public.meeting_members where meeting_id=p.meeting_id and user_id=auth.uid() and joined_at<=p.created_at) then
    raise exception '참가 이후 약속만 수정할 수 있어요' using errcode='42501';
  end if;
  if p.confirmed or p.meet_at<=now() or exists(select 1 from public.meeting_plan_votes where plan_id=p.id) then
    raise exception '확정 투표가 시작됐거나 지난 약속이에요' using errcode='55000';
  end if;
  if p_action in ('configure','select') and p.schedule_host is distinct from auth.uid() then
    raise exception '방장만 범위와 최종 시간을 선택할 수 있어요' using errcode='42501';
  end if;
  c:=p.schedule;
  if coalesce((p_payload->>'revision')::integer,0)<>coalesce((c->>'revision')::integer,0) then
    raise exception '다른 참여자가 일정을 변경했어요. 닫았다 다시 열어 주세요' using errcode='40001';
  end if;
  if p_action='configure' then
    d1:=(p_payload->>'start')::date; d2:=(p_payload->>'end')::date;
    lo:=(p_payload->>'from')::integer; hi:=(p_payload->>'to')::integer;
    if d1 is null or d2 is null or lo is null or hi is null or d2<d1 or d2-d1>6 or lo<0 or hi>1440 or lo>=hi or lo%30<>0 or hi%30<>0 then
      raise exception '최대 7일, 30분 단위의 범위를 설정해 주세요' using errcode='23514';
    end if;
    c:=jsonb_build_object('start',d1::text,'end',d2::text,'from',lo,'to',hi,'responses','{}'::jsonb,'selected',null);
  elsif p_action in ('save','select') then
    if c is null then raise exception '먼저 조율 범위를 설정해 주세요'; end if;
    d1:=(c->>'start')::date; d2:=(c->>'end')::date;lo:=(c->>'from')::integer;hi:=(c->>'to')::integer;
    select array_agg(to_char((d1+day+(minute*interval '1 minute')) at time zone 'Asia/Seoul' at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) into valid_slots
    from generate_series(0,d2-d1) day cross join generate_series(lo,hi-30,30) minute;
    if p_action='save' then
      if jsonb_typeof(p_payload->'slots') is distinct from 'array' then raise exception '시간 목록을 보내 주세요'; end if;
      select coalesce(array_agg(distinct value),'{}'::text[]) into submitted from jsonb_array_elements_text(p_payload->'slots');
      if not submitted <@ valid_slots then raise exception '범위 밖 시간은 저장할 수 없어요' using errcode='23514'; end if;
      c:=jsonb_set(c,array['responses',auth.uid()::text],to_jsonb(submitted));
      c:=jsonb_set(c,'{selected}','null');
    else
      if not coalesce((p_payload->>'slot')=any(valid_slots),false) then raise exception '범위 밖 시간이에요'; end if;
      select count(*) into member_count from public.meeting_members where meeting_id=p.meeting_id;
      select max(n) into best_count from (
        select slot,count(mm.user_id) filter(where coalesce(c->'responses'->mm.user_id::text,'[]'::jsonb) ? slot) n
        from unnest(valid_slots) slot cross join public.meeting_members mm where mm.meeting_id=p.meeting_id group by slot
      ) counts;
      select count(*) into selected_count from public.meeting_members mm where mm.meeting_id=p.meeting_id and coalesce(c->'responses'->mm.user_id::text,'[]'::jsonb) ? (p_payload->>'slot');
      if selected_count=0 or selected_count<>best_count then raise exception '최다 가능 후보를 선택해 주세요'; end if;
      selected_at:=(p_payload->>'slot')::timestamptz;
      if selected_at<=now() then raise exception '미래 시간을 선택해 주세요'; end if;
      c:=jsonb_set(c,'{selected}',p_payload->'slot');
    end if;
  else raise exception '지원하지 않는 일정 작업이에요';
  end if;
  c:=jsonb_set(c,'{revision}',to_jsonb(coalesce((p.schedule->>'revision')::integer,0)+1));
  update public.meeting_plans set schedule=c,meet_at=selected_at,
    time_label=case when selected_at is null then '시간 조율 중' else to_char(selected_at at time zone 'Asia/Seoul','MM/DD HH24:MI')||' (한국 시간)' end
  where id=p.id returning * into p;
  return to_jsonb(p);
end $$;
revoke all on function public.update_plan_schedule(uuid,text,jsonb) from public,anon;
grant execute on function public.update_plan_schedule(uuid,text,jsonb) to authenticated;

-- 기존 투표 트리거보다 먼저 잠그고 시간 미선택 약속의 투표를 거절한다.
create function public.guard_schedule_vote() returns trigger language plpgsql security definer set search_path=public as $$
declare p public.meeting_plans;
begin
  select * into p from public.meeting_plans where id=new.plan_id for update;
  if p.schedule is not null and p.schedule->>'selected' is null then
    raise exception '방장이 시간을 먼저 선택해 주세요' using errcode='23514';
  end if;
  return new;
end $$;
create trigger schedule_vote_guard before insert on public.meeting_plan_votes
for each row execute function public.guard_schedule_vote();
