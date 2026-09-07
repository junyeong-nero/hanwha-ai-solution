-- 이슈 #32: 인증된 공유 링크, 개인별 의견, 방장 비교·원자적 확정.
alter table public.meeting_plans add column collecting boolean not null default false;
alter table public.meeting_plans drop constraint meeting_plans_confirm_reason_check;
alter table public.meeting_plans add constraint meeting_plans_confirm_reason_check
  check (confirm_reason is null or confirm_reason in ('vote', 'due', 'host'));

create table public.meeting_polls (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null unique references public.meeting_plans(id) on delete cascade,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  deadline timestamptz not null,
  slots timestamptz[] not null,
  candidates jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.meeting_plans add column poll_id uuid references public.meeting_polls(id);
create table public.meeting_responses (
  poll_id uuid not null references public.meeting_polls(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  candidate integer not null check(candidate >= 0),
  slots timestamptz[] not null,
  comment text not null default '' check(char_length(comment) <= 1000),
  updated_at timestamptz not null default now(),
  primary key(poll_id, user_id)
);
alter table public.meeting_polls enable row level security;
alter table public.meeting_responses enable row level security;
-- 테이블 직접 접근은 닫고, 아래 RPC에서 매 요청마다 현재 참여·방장 권한을 검사한다.
revoke all on public.meeting_polls, public.meeting_responses from anon, authenticated;

create function public.poll_member(p_poll_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from meeting_polls q join meeting_members mm on mm.meeting_id=q.meeting_id
    where q.id=p_poll_id and mm.user_id=auth.uid() and mm.joined_at<=q.created_at);
$$;

create function public.create_meeting_poll(p_plan_id uuid, p_deadline timestamptz, p_slots timestamptz[])
returns uuid language plpgsql security definer set search_path = public as $$
declare p meeting_plans; qid uuid;
begin
  select * into p from meeting_plans where id=p_plan_id for update;
  if not exists(select 1 from meetings m join meeting_members mm on mm.meeting_id=m.id
    where m.id=p.meeting_id and m.created_by=auth.uid() and mm.user_id=auth.uid() and mm.joined_at<=p.created_at) then
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

create function public.get_meeting_poll(p_poll_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q meeting_polls; host boolean; result jsonb;
begin
  if not poll_member(p_poll_id) then raise exception '이 링크를 받을 당시의 모임 참여자만 열 수 있어요' using errcode='42501'; end if;
  select * into q from meeting_polls where id=p_poll_id;
  select created_by=auth.uid() into host from meetings where id=q.meeting_id;
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

create function public.submit_meeting_response(p_poll_id uuid, p_candidate integer, p_slots timestamptz[], p_comment text)
returns void language plpgsql security definer set search_path = public as $$
declare q meeting_polls; p meeting_plans;
begin
  select * into q from meeting_polls where id=p_poll_id;
  select * into p from meeting_plans where id=q.plan_id for update;
  -- 참여 행을 잠가 탈퇴와 응답 저장이 엇갈리지 않도록 한다.
  perform 1 from meeting_members where meeting_id=q.meeting_id and user_id=auth.uid() for share;
  if not poll_member(p_poll_id) then raise exception '모임 참여자만 제출할 수 있어요' using errcode='42501'; end if;
  if p.confirmed or q.deadline<=now() then raise exception '의견 제출이 마감되었어요'; end if;
  if p_candidate is null or p_candidate<0 or p_candidate>=jsonb_array_length(q.candidates)
    or p_slots is null or not(p_slots<@q.slots) or array_position(p_slots,null) is not null
    or cardinality(p_slots)>cardinality(q.slots) or coalesce(char_length(p_comment),0)>1000 then
    raise exception '후보와 가능한 시간을 다시 확인해 주세요';
  end if;
  insert into meeting_responses(poll_id,user_id,candidate,slots,comment)
    values(q.id,auth.uid(),p_candidate,array(select distinct s from unnest(p_slots) s),coalesce(p_comment,''))
    on conflict(poll_id,user_id) do update set candidate=excluded.candidate,slots=excluded.slots,
      comment=excluded.comment,updated_at=now();
end;
$$;

create function public.finalize_meeting_poll(p_poll_id uuid, p_candidate integer, p_slot timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare q meeting_polls; p meeting_plans; chosen jsonb;
begin
  select * into q from meeting_polls where id=p_poll_id;
  select * into p from meeting_plans where id=q.plan_id for update;
  if not poll_member(p_poll_id) or not exists(select 1 from meetings where id=q.meeting_id and created_by=auth.uid()) then
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

-- 수집 시작 이후 기존 투표·시간 경과 확정은 적용하지 않는다.
-- 모든 UPDATE가 같은 약속 행 잠금을 거치므로 수집 시작·제출·확정의 경합도 직렬화된다.
create function public.guard_collecting_plan() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.collecting then
    if old.confirmed and (new.place is distinct from old.place or new.meet_at is distinct from old.meet_at
      or new.selected_place is distinct from old.selected_place) then raise exception '확정된 약속은 변경할 수 없어요'; end if;
    if not old.confirmed and new.confirmed and new.confirm_reason is distinct from 'host' then return null; end if;
    if new.schedule is distinct from old.schedule then raise exception '의견 비교 화면에서 일정을 조율해 주세요'; end if;
    if not new.confirmed and (new.meet_at is distinct from old.meet_at or new.place is distinct from old.place or new.selected_place is distinct from old.selected_place) then
      raise exception '의견 비교 화면에서 장소와 시간을 함께 확정해 주세요';
    end if;
    if new.candidates is distinct from old.candidates or not new.collecting then raise exception '의견 수집 후보는 변경할 수 없어요'; end if;
  end if;
  return new;
end;
$$;
create trigger meeting_plans_guard_collecting before update on meeting_plans
  for each row execute function guard_collecting_plan();

revoke all on function public.poll_member(uuid), public.create_meeting_poll(uuid,timestamptz,timestamptz[]),
  public.get_meeting_poll(uuid),public.submit_meeting_response(uuid,integer,timestamptz[],text),
  public.finalize_meeting_poll(uuid,integer,timestamptz) from public,anon;
grant execute on function public.create_meeting_poll(uuid,timestamptz,timestamptz[]),public.get_meeting_poll(uuid),
  public.submit_meeting_response(uuid,integer,timestamptz[],text),public.finalize_meeting_poll(uuid,integer,timestamptz) to authenticated;
