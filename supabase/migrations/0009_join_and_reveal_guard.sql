-- 임의 참가 · 참가 이전 대화 열람 · 즉시 실명 노출 차단 (이슈 #11)
--
-- 로그인만 하면 아무 모임에나 스스로 참가해서, 그 방의 지난 익명 대화를 전부 읽고,
-- 곧바로 만남 완료를 눌러 이미 완료한 멤버의 실명까지 가져갈 수 있었다.
-- "만나기 전까지는 모두 익명" · "실명은 서로 만난 사람에게만" 을 서버에서 강제한다.
--
-- 1) 참가는 열려 있고(status='open') 정원이 남은 모임에만 — RLS 정책 + 경합까지 막는 트리거
-- 2) 메시지는 내가 참가한 시점(joined_at) 이후 것만 보인다 (채팅 목록 미리보기 포함)
-- 3) 체크인(실명 공개)은 확정된 약속이 있고, 그 약속이 확정되기 전부터 멤버였을 때만
--
-- 재실행해도 안전하도록 if exists · if not exists · create or replace 를 쓴다.

-- ============================================================
-- 1. joined_at — 메시지 가시성의 기준선
-- ============================================================

-- null 이면 "참가 이후" 비교가 통째로 null 이 되어 메시지가 하나도 보이지 않는다.
update public.meeting_members set joined_at = now() where joined_at is null;
alter table public.meeting_members alter column joined_at set default now();
alter table public.meeting_members alter column joined_at set not null;

-- ============================================================
-- 2. 참가 조건 — 열려 있고 정원이 남은 모임
-- ============================================================

-- meeting_members 의 정책 안에서 meeting_members 를 세면 RLS 가 걸려 "내가 볼 수 있는 행" 만
-- 세게 된다(참가 전에는 0). 정원 계산은 security definer 함수로 실제 인원을 센다.
create or replace function public.can_join_meeting(p_meeting_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
      from public.meetings m
     where m.id = p_meeting_id
       and m.status = 'open'
       and (select count(*) from public.meeting_members mm where mm.meeting_id = m.id) < m.capacity
  );
$$;

revoke all on function public.can_join_meeting(uuid) from public, anon;
grant execute on function public.can_join_meeting(uuid) to authenticated, service_role;

-- 이미 멤버인 경우도 통과시킨다 — 브라우저의 참가는 upsert(on conflict do nothing) 라
-- 정원이 찬 뒤 같은 행을 다시 보내도 오류가 되면 안 된다.
drop policy if exists "모임 참가 본인 등록" on public.meeting_members;
create policy "모임 참가 본인 등록" on public.meeting_members
for insert with check (
  user_id = auth.uid()
  and (
    public.is_meeting_member(meeting_id, auth.uid())
    or public.can_join_meeting(meeting_id)
  )
);

-- 정책만으로는 두 사람이 동시에 참가하면 둘 다 통과해 정원을 넘길 수 있다.
-- 모임 행을 잠그고 다시 세어 경합을 막는다. security definer 라 RLS 와 무관하게 실제 인원을 센다.
-- invite_to_meeting 처럼 RLS 를 우회하는 서버 경로에도 똑같이 걸린다.
create or replace function public.guard_meeting_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_capacity int;
  v_count int;
begin
  -- 이미 멤버면 그대로 둔다 (on conflict do nothing 으로 이어진다)
  if exists (
    select 1 from public.meeting_members mm
     where mm.meeting_id = new.meeting_id and mm.user_id = new.user_id
  ) then
    return new;
  end if;

  select m.status, m.capacity into v_status, v_capacity
    from public.meetings m
   where m.id = new.meeting_id
     for update;

  if v_status is null then
    raise exception '모임을 찾을 수 없습니다' using errcode = '42501';
  end if;

  if v_status <> 'open' then
    raise exception '마감된 모임에는 참가할 수 없습니다' using errcode = '42501';
  end if;

  select count(*) into v_count
    from public.meeting_members mm
   where mm.meeting_id = new.meeting_id;

  if v_count >= v_capacity then
    raise exception '정원이 찬 모임에는 참가할 수 없습니다' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists meeting_members_guard_capacity on public.meeting_members;
create trigger meeting_members_guard_capacity
before insert on public.meeting_members
for each row execute function public.guard_meeting_capacity();

-- 방장 초대도 정원을 지킨다. 남은 자리보다 많이 고르면 트리거가 예외를 던져 초대 전체가
-- 실패하므로, 여기서 남은 자리만큼만 넣고 실제로 추가된 수를 돌려준다.
create or replace function public.invite_to_meeting(p_meeting_id uuid, p_user_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_remaining int;
  v_rows int;
begin
  if v_uid is null or not exists (
    select 1 from public.meetings m where m.id = p_meeting_id and m.created_by = v_uid
  ) then
    raise exception '모임을 만든 사람만 초대할 수 있습니다' using errcode = '42501';
  end if;

  -- 참가 트리거와 같은 순서로 모임 행을 먼저 잠그고 남은 자리를 센다
  perform 1 from public.meetings m
   where m.id = p_meeting_id and m.status = 'open'
     for update;
  if not found then
    return 0;
  end if;

  select greatest(m.capacity - (select count(*) from public.meeting_members mm where mm.meeting_id = m.id), 0)
    into v_remaining
    from public.meetings m
   where m.id = p_meeting_id;

  v_remaining := coalesce(v_remaining, 0);
  if v_remaining = 0 then
    return 0;
  end if;

  insert into public.meeting_members (meeting_id, user_id)
  select p_meeting_id, s.u
    from (
      select u
        from unnest(p_user_ids) as u
       where u <> v_uid
         and exists (select 1 from public.connections c
                     where c.user_a_id = least(v_uid, u) and c.user_b_id = greatest(v_uid, u))
         and not exists (select 1 from public.meeting_members mm
                         where mm.meeting_id = p_meeting_id and mm.user_id = u)
       limit v_remaining
    ) s
  on conflict do nothing;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.invite_to_meeting(uuid, uuid[]) from public, anon;
grant execute on function public.invite_to_meeting(uuid, uuid[]) to authenticated, service_role;

-- ============================================================
-- 3. 참가 이전 대화는 보이지 않는다
-- ============================================================

drop policy if exists "참가 모임 메시지 조회" on public.messages;
create policy "참가 모임 메시지 조회" on public.messages
for select using (
  exists (select 1 from public.meeting_members mm
           where mm.meeting_id = messages.meeting_id
             and mm.user_id = auth.uid()
             and messages.created_at >= mm.joined_at)
);

-- 채팅 목록의 마지막 메시지 미리보기도 같은 기준을 따른다 (security definer 라 정책을 우회한다).
-- 0008 과 반환 컬럼이 같아 create or replace 로 바꿀 수 있다.
create or replace function public.room_summaries()
returns table (
  meeting_id uuid,
  title text,
  emoji text,
  status text,
  member_count int,
  last_body text,
  last_at timestamptz,
  attended boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    m.id,
    m.title,
    m.emoji,
    m.status,
    (select count(*)::int from public.meeting_members mc where mc.meeting_id = m.id),
    lm.body,
    lm.created_at,
    exists (
      select 1 from public.meeting_attendance a
      where a.meeting_id = m.id and a.user_id = auth.uid()
    ) as attended
  from public.meeting_members mm
  join public.meetings m on m.id = mm.meeting_id
  left join lateral (
    select msg.body, msg.created_at
    from public.messages msg
    where msg.meeting_id = m.id
      and msg.created_at >= mm.joined_at
    order by msg.created_at desc
    limit 1
  ) lm on true
  where auth.uid() is not null
    and mm.user_id = auth.uid()
  order by lm.created_at desc nulls last, mm.joined_at desc;
$$;

revoke all on function public.room_summaries() from public, anon;
grant execute on function public.room_summaries() to authenticated, service_role;

-- ============================================================
-- 4. 실명 공개 근거 — 약속이 확정된 시각
-- ============================================================

alter table public.meeting_plans add column if not exists confirmed_at timestamptz;

-- 이미 확정된 카드의 확정 시각을 채운다. 시간 경과로 확정된 카드는 약속 시각이 그 근거다.
update public.meeting_plans
   set confirmed_at = case when confirm_reason = 'due' then coalesce(meet_at, created_at) else created_at end
 where confirmed and confirmed_at is null;

-- 확정 경로가 여러 개다 — 전원 투표 트리거 · settle_due_plans · 브라우저의 confirmed 직접 수정.
-- 어느 경로로 확정되든 시각이 남도록 테이블 트리거로 찍는다.
create or replace function public.stamp_plan_confirmed_at()
returns trigger
language plpgsql
as $$
begin
  if new.confirmed and (tg_op = 'INSERT' or not old.confirmed) then
    new.confirmed_at := coalesce(new.confirmed_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists meeting_plans_stamp_confirmed_at on public.meeting_plans;
create trigger meeting_plans_stamp_confirmed_at
before insert or update on public.meeting_plans
for each row execute function public.stamp_plan_confirmed_at();

-- 시간 경과로 확정되는 카드는 "정리가 돌아간 시각" 이 아니라 약속 시각에 확정된 것으로 본다.
-- 정리는 멤버가 방을 열 때 도는데(0007), 그러지 않으면 지나간 약속이 있는 방에 방금 들어와도
-- 곧바로 정리가 돌면서 확정 시각이 참가 시각보다 늦어져 체크인이 열려 버린다.
create or replace function public.settle_due_plans(p_meeting_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.is_meeting_member(p_meeting_id, auth.uid()) then
    raise exception '모임 멤버가 아닙니다' using errcode = '42501';
  end if;

  update public.meeting_plans
     set confirmed = true, confirm_reason = 'due', confirmed_at = meet_at
   where meeting_id = p_meeting_id
     and not confirmed
     and meet_at is not null
     and meet_at <= now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.settle_due_plans(uuid) from public, anon;
grant execute on function public.settle_due_plans(uuid) to authenticated, service_role;

create or replace function public.settle_all_due_plans()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.meeting_plans
     set confirmed = true, confirm_reason = 'due', confirmed_at = meet_at
   where not confirmed
     and meet_at is not null
     and meet_at <= now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.settle_all_due_plans() from public, anon, authenticated;
grant execute on function public.settle_all_due_plans() to service_role;

-- ============================================================
-- 5. 체크인 자격 — 약속이 확정되기 전부터 멤버였을 것
-- ============================================================

-- 0004 의 attend_meeting_tx 에 자격 검사를 추가한 것이다. 나머지 동작(연결 쌍 · 사진첩 ·
-- 전원 완료 시 모임 종료)은 그대로다.
-- "확정된 약속이 있는 모임" 만으로는 부족하다 — 확정된 방에 방금 들어와 곧바로 체크인하면
-- 이미 완료한 멤버의 실명이 바로 열린다. 그래서 확정 시점에 이미 멤버였는지까지 본다.
create or replace function public.attend_meeting_tx(p_meeting_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_album_id uuid;
  v_attended_count int;
  v_member_count int;
  v_connection_count int;
begin
  if v_uid is null or not exists (
    select 1 from public.meeting_members mm
    where mm.meeting_id = p_meeting_id
      and mm.user_id = v_uid
  ) then
    raise exception '모임 멤버가 아닙니다' using errcode = '42501';
  end if;

  if not exists (
    select 1
      from public.meeting_plans p
      join public.meeting_members mm
        on mm.meeting_id = p.meeting_id
       and mm.user_id = v_uid
     where p.meeting_id = p_meeting_id
       and p.confirmed
       and coalesce(p.confirmed_at, p.created_at) >= mm.joined_at
  ) then
    raise exception '확정된 약속이 있어야 만남을 완료할 수 있습니다' using errcode = '55000';
  end if;

  insert into public.meeting_attendance (meeting_id, user_id)
  values (p_meeting_id, v_uid)
  on conflict do nothing;

  -- 이미 체크인한 다른 멤버와 (least, greatest) 순서로 연결한다
  insert into public.connections (user_a_id, user_b_id, meeting_id, first_met_at)
  select least(v_uid, a.user_id), greatest(v_uid, a.user_id), p_meeting_id, now()
    from public.meeting_attendance a
    join public.meeting_members mm
      on mm.meeting_id = a.meeting_id
     and mm.user_id = a.user_id
   where a.meeting_id = p_meeting_id
     and a.user_id <> v_uid
  on conflict (user_a_id, user_b_id) do nothing;

  insert into public.albums (meeting_id)
  values (p_meeting_id)
  on conflict (meeting_id) do nothing;

  select al.id into v_album_id
    from public.albums al
   where al.meeting_id = p_meeting_id;

  select count(*)::int into v_attended_count
    from public.meeting_attendance a
    join public.meeting_members mm
      on mm.meeting_id = a.meeting_id
     and mm.user_id = a.user_id
   where a.meeting_id = p_meeting_id;

  select count(*)::int into v_member_count
    from public.meeting_members mm
   where mm.meeting_id = p_meeting_id;

  if v_attended_count >= v_member_count then
    update public.meetings m
       set status = 'completed'
     where m.id = p_meeting_id
       and m.status <> 'completed';
  end if;

  -- 현재 멤버끼리의 연결 행 수 (이전 모임에서 이미 연결된 쌍도 포함)
  select count(*)::int into v_connection_count
    from public.connections c
   where exists (select 1 from public.meeting_members ma
                  where ma.meeting_id = p_meeting_id and ma.user_id = c.user_a_id)
     and exists (select 1 from public.meeting_members mb
                  where mb.meeting_id = p_meeting_id and mb.user_id = c.user_b_id);

  return json_build_object(
    'attended_count', v_attended_count,
    'member_count', v_member_count,
    'connection_count', v_connection_count,
    'album_id', v_album_id
  );
end;
$$;

revoke all on function public.attend_meeting_tx(uuid) from public, anon;
grant execute on function public.attend_meeting_tx(uuid) to authenticated, service_role;
