-- 약속 잡기를 공유 시간표로 통합한다. 생성자가 없는 기본 모임은 약속 제안자가 방장이다.
create or replace function public.create_meeting_poll(p_plan_id uuid, p_deadline timestamptz, p_slots timestamptz[])
returns uuid language plpgsql security definer set search_path = public as $$
declare p meeting_plans; qid uuid;
begin
  select * into p from meeting_plans where id=p_plan_id for update;
  if not exists(select 1 from meetings m join meeting_members mm on mm.meeting_id=m.id
    where m.id=p.meeting_id and coalesce(m.created_by,p.schedule_host)=auth.uid() and mm.user_id=auth.uid() and mm.joined_at<=p.created_at) then
    raise exception '방장만 의견 수집을 시작할 수 있어요' using errcode='42501';
  end if;
  select id into qid from meeting_polls where plan_id=p_plan_id;
  if qid is not null then return qid; end if;
  if p.confirmed then raise exception '이미 확정된 약속이에요'; end if;
  if p_deadline is null or p_deadline<=now() or p_deadline>now()+interval '30 days'
    or coalesce(cardinality(p_slots),0) not between 1 and 336
    or exists(select 1 from unnest(p_slots) s where s is null or s<=p_deadline or s>now()+interval '60 days'
      or extract(second from s)<>0 or extract(minute from s)::int % 30<>0)
    or (select count(distinct s) from unnest(p_slots) s)<>cardinality(p_slots) then
    raise exception '마감 이후의 30분 단위 후보 시간을 선택해 주세요';
  end if;
  if jsonb_array_length(coalesce(p.candidates,'[]'))=0 then raise exception '먼저 장소 후보를 추천받아 주세요'; end if;
  insert into meeting_polls(plan_id,meeting_id,deadline,slots,candidates)
    values(p.id,p.meeting_id,p_deadline,p_slots,p.candidates) returning id into qid;
  update meeting_plans set collecting=true,poll_id=qid where id=p.id;
  return qid;
end;
$$;

create or replace function public.get_meeting_poll(p_poll_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q meeting_polls; host boolean; result jsonb;
begin
  if not poll_member(p_poll_id) then raise exception '이 링크를 받을 당시의 모임 참여자만 열 수 있어요' using errcode='42501'; end if;
  select * into q from meeting_polls where id=p_poll_id;
  select coalesce(m.created_by,p.schedule_host)=auth.uid() into host from meetings m join meeting_plans p on p.id=q.plan_id where m.id=q.meeting_id;
  select jsonb_build_object('id',q.id,'meeting_id',q.meeting_id,'plan_id',q.plan_id,'deadline',q.deadline,
    'slots',q.slots,'candidates',q.candidates,'host',coalesce(host,false),'title',m.title,
    'activity',p.activity,'confirmed',p.confirmed,'plan',to_jsonb(p),
    'responses',coalesce((select jsonb_agg(to_jsonb(r)) from meeting_responses r
      join meeting_members mm on mm.meeting_id=q.meeting_id and mm.user_id=r.user_id
      where r.poll_id=q.id and r.updated_at>=mm.joined_at and (host or r.user_id=auth.uid())),'[]'::jsonb),
    'members',case when host then coalesce((select jsonb_agg(jsonb_build_object('id',mm.user_id,'name',pr.nickname))
      from meeting_members mm join profiles pr on pr.user_id=mm.user_id
      where mm.meeting_id=q.meeting_id and mm.joined_at<=q.created_at),'[]'::jsonb) else '[]'::jsonb end)
    into result from meetings m join meeting_plans p on p.id=q.plan_id where m.id=q.meeting_id;
  return result;
end;
$$;

create or replace function public.finalize_meeting_poll(p_poll_id uuid, p_candidate integer, p_slot timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare q meeting_polls; p meeting_plans; chosen jsonb;
begin
  select * into q from meeting_polls where id=p_poll_id;
  select * into p from meeting_plans where id=q.plan_id for update;
  if not poll_member(p_poll_id) or not exists(select 1 from meetings where id=q.meeting_id and coalesce(created_by,p.schedule_host)=auth.uid()) then
    raise exception '방장만 확정할 수 있어요' using errcode='42501';
  end if;
  if p.confirmed then raise exception '이미 확정된 약속이에요'; end if;
  if p_candidate is null or p_candidate<0 or p_candidate>=jsonb_array_length(q.candidates)
    or p_slot is null or not(p_slot=any(q.slots)) or p_slot<=now() then raise exception '장소와 미래의 후보 시간을 선택해 주세요'; end if;
  chosen:=q.candidates->p_candidate;
  update meeting_plans set selected_place=chosen,place=chosen->>'name',meet_at=p_slot,
    time_label=to_char(p_slot at time zone 'Asia/Seoul','MM/DD HH24:MI')||' (한국 시간)',
    confirmed=true,confirm_reason='host' where id=p.id returning * into p;
  insert into messages(meeting_id,sender_id,body)
    values(q.meeting_id,null,left('방장이 약속을 확정했어요 — '||p.place||' · '||p.time_label,500));
  return to_jsonb(p);
end;
$$;
