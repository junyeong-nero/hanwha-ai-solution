-- 이슈 #11: 모임 참가·채팅·만남 완료의 서버 보안 경계를 강화한다.
-- 브라우저가 임의 행을 직접 삽입하지 않고, 모든 참가 검사를 하나의 트랜잭션으로 수행한다.

-- ============================================================
-- 1. 원자적인 모임 참가
-- ============================================================

-- 기존 데이터에 NULL이 남아 있으면 가입 시점 비교가 UNKNOWN이 되어 모든 과거 데이터가
-- 보이지 않으므로, 마이그레이션 시각을 기준으로 보정하고 이후에는 반드시 기록한다.
update public.meeting_members set joined_at = now() where joined_at is null;
alter table public.meeting_members alter column joined_at set default now();
alter table public.meeting_members alter column joined_at set not null;

revoke insert on table public.meeting_members from anon, authenticated;
drop policy if exists "모임 참가 본인 등록" on public.meeting_members;

create or replace function public.join_meeting(p_meeting_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_capacity int;
  v_member_count int;
  v_joined_at timestamptz;
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다' using errcode = '42501';
  end if;

  -- 모임 행을 잠가 정원 확인과 등록 사이의 경쟁 조건을 막는다.
  select m.status, m.capacity
    into v_status, v_capacity
    from public.meetings m
   where m.id = p_meeting_id
   for update;

  if not found then
    raise exception '모임을 찾을 수 없습니다' using errcode = 'P0002';
  end if;

  -- 재시도는 멱등적으로 성공시킨다.
  if exists (
    select 1 from public.meeting_members mm
     where mm.meeting_id = p_meeting_id and mm.user_id = v_uid
  ) then
    select mm.joined_at into v_joined_at
      from public.meeting_members mm
     where mm.meeting_id = p_meeting_id and mm.user_id = v_uid;
    return json_build_object('meeting_id', p_meeting_id, 'joined_at', v_joined_at, 'already_member', true);
  end if;

  if v_status <> 'open' then
    raise exception '열린 모임만 참가할 수 있습니다' using errcode = '42501';
  end if;

  -- 약속이 확정된 뒤에는 새로운 참가자가 과거 대화·만남에 끼어들 수 없다.
  if exists (
    select 1 from public.meeting_plans p
     where p.meeting_id = p_meeting_id
  ) then
    raise exception '약속이 확정된 모임은 더 이상 참가할 수 없습니다' using errcode = '42501';
  end if;

  select count(*)::int into v_member_count
    from public.meeting_members mm
   where mm.meeting_id = p_meeting_id;

  if v_member_count >= v_capacity then
    raise exception '모임 정원이 가득 찼습니다' using errcode = '42501';
  end if;

  insert into public.meeting_members (meeting_id, user_id)
  values (p_meeting_id, v_uid)
  returning joined_at into v_joined_at;

  return json_build_object('meeting_id', p_meeting_id, 'joined_at', v_joined_at, 'already_member', false);
end;
$$;

revoke all on function public.join_meeting(uuid) from public, anon;
grant execute on function public.join_meeting(uuid) to authenticated, service_role;

-- 기존 초대 경로도 같은 상태·정원 경계를 사용한다. 방장이 이미 참가한 뒤 친구를 초대한다.
create or replace function public.invite_to_meeting(p_meeting_id uuid, p_user_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_capacity int;
  v_rows int;
  v_inserted int;
  v_target uuid;
begin
  if v_uid is null or not exists (
    select 1 from public.meetings m where m.id = p_meeting_id and m.created_by = v_uid
  ) then
    raise exception '모임을 만든 사람만 초대할 수 있습니다' using errcode = '42501';
  end if;

  select m.status, m.capacity into v_status, v_capacity
    from public.meetings m where m.id = p_meeting_id for update;
  if v_status <> 'open' then
    raise exception '열린 모임만 초대할 수 있습니다' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.meeting_plans p
     where p.meeting_id = p_meeting_id
  ) then
    raise exception '약속이 확정된 모임은 더 이상 초대할 수 없습니다' using errcode = '42501';
  end if;

  v_rows := 0;
  foreach v_target in array coalesce(p_user_ids, '{}'::uuid[]) loop
    if v_target = v_uid
       or not exists (
         select 1 from public.connections c
          where c.user_a_id = least(v_uid, v_target)
            and c.user_b_id = greatest(v_uid, v_target)
       )
       or exists (
         select 1 from public.meeting_members mm
          where mm.meeting_id = p_meeting_id and mm.user_id = v_target
       ) then
      continue;
    end if;

    if (select count(*) from public.meeting_members mm where mm.meeting_id = p_meeting_id) >= v_capacity then
      exit;
    end if;

    insert into public.meeting_members (meeting_id, user_id)
    values (p_meeting_id, v_target)
    on conflict do nothing;
    get diagnostics v_inserted = row_count;
    v_rows := v_rows + v_inserted;
  end loop;
  return v_rows;
end;
$$;

revoke all on function public.invite_to_meeting(uuid, uuid[]) from public, anon;
grant execute on function public.invite_to_meeting(uuid, uuid[]) to authenticated, service_role;

-- ============================================================
-- 2. 가입 시점 이전 데이터 차단
-- ============================================================

drop policy if exists "참가 모임 메시지 조회" on public.messages;
create policy "참가 모임 메시지 조회" on public.messages
for select using (
  exists (
    select 1 from public.meeting_members mm
     where mm.meeting_id = messages.meeting_id
       and mm.user_id = auth.uid()
       and messages.created_at >= mm.joined_at
  )
);

drop policy if exists "참가 모임 약속 조회" on public.meeting_plans;
create policy "참가 모임 약속 조회" on public.meeting_plans
for select using (
  exists (
    select 1 from public.meeting_members mm
     where mm.meeting_id = meeting_plans.meeting_id
       and mm.user_id = auth.uid()
       and meeting_plans.created_at >= mm.joined_at
  )
);

-- 가입 전 약속을 직접 수정하거나 그 약속에 투표해 확정시키는 우회도 차단한다.
drop policy if exists "참가 모임 약속 확정" on public.meeting_plans;
create policy "참가 모임 약속 확정" on public.meeting_plans
for update using (
  exists (
    select 1 from public.meeting_members mm
     where mm.meeting_id = meeting_plans.meeting_id
       and mm.user_id = auth.uid()
       and meeting_plans.created_at >= mm.joined_at
  )
)
with check (
  exists (
    select 1 from public.meeting_members mm
     where mm.meeting_id = meeting_plans.meeting_id
       and mm.user_id = auth.uid()
       and meeting_plans.created_at >= mm.joined_at
  )
);

drop policy if exists "참가 모임 투표 조회" on public.meeting_plan_votes;
create policy "참가 모임 투표 조회" on public.meeting_plan_votes
for select using (
  exists (
    select 1 from public.meeting_members mm
     join public.meeting_plans p on p.id = meeting_plan_votes.plan_id
     where mm.meeting_id = meeting_plan_votes.meeting_id
       and mm.user_id = auth.uid()
       and p.created_at >= mm.joined_at
       and meeting_plan_votes.created_at >= mm.joined_at
  )
);

drop policy if exists "참가 모임 투표 본인 등록" on public.meeting_plan_votes;
create policy "참가 모임 투표 본인 등록" on public.meeting_plan_votes
for insert with check (
  user_id = auth.uid()
  and exists (
    select 1
      from public.meeting_members mm
      join public.meeting_plans p
        on p.meeting_id = mm.meeting_id
       and p.id = meeting_plan_votes.plan_id
     where mm.meeting_id = meeting_plan_votes.meeting_id
       and mm.user_id = auth.uid()
       and p.created_at >= mm.joined_at
  )
);

drop policy if exists "참가 모임 체크인 조회" on public.meeting_attendance;
create policy "참가 모임 체크인 조회" on public.meeting_attendance
for select using (
  exists (
    select 1 from public.meeting_members mm
     where mm.meeting_id = meeting_attendance.meeting_id
       and mm.user_id = auth.uid()
       and meeting_attendance.attended_at >= mm.joined_at
  )
);

-- 가입 시점 이후 메시지만 채팅 목록 미리보기에 사용한다.
drop function if exists public.room_summaries();
create function public.room_summaries()
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
       where a.meeting_id = m.id
         and a.user_id = auth.uid()
         and a.attended_at >= mm.joined_at
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
-- 3. 약속 확정 시각을 기록해 늦은 참가자의 체크인을 차단
-- ============================================================

alter table public.meeting_plans add column if not exists confirmed_at timestamptz;

-- 기존 확정 카드도 확정 경로에 맞는 보수적인 시각을 채운다.
update public.meeting_plans
   set confirmed_at = case
     when confirm_reason = 'due' then coalesce(meet_at, created_at)
     else created_at
   end
 where confirmed and confirmed_at is null;

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

-- 시간 경과 자동 확정은 정리 작업이 실행된 시각이 아니라 약속 시각을 근거로 남긴다.
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

  -- 같은 모임의 체크인을 직렬화해 서로의 출석과 연결을 놓치지 않게 한다.
  perform 1 from public.meetings where id = p_meeting_id for update;

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
-- 4. 실제 만남 시점 이후에만 체크인·연결 생성
-- ============================================================

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
  -- 같은 모임의 체크인을 직렬화해 서로의 출석과 연결을 놓치지 않게 한다.
  perform 1 from public.meetings where id = p_meeting_id for update;

  if v_uid is null or not exists (
    select 1 from public.meeting_members mm
     where mm.meeting_id = p_meeting_id and mm.user_id = v_uid
  ) then
    raise exception '모임 멤버가 아닙니다' using errcode = '42501';
  end if;

  -- 시간이 지난 카드의 자동 확정을 체크인 시점에도 보장한다. 확정 시각은 meet_at이다.
  update public.meeting_plans
     set confirmed = true, confirm_reason = 'due', confirmed_at = meet_at
   where meeting_id = p_meeting_id
     and not confirmed
     and meet_at is not null
     and meet_at <= now();

  if not exists (
    select 1
      from public.meeting_plans p
      join public.meeting_members mm
        on mm.meeting_id = p.meeting_id
       and mm.user_id = v_uid
     where p.meeting_id = p_meeting_id
       and p.confirmed
       and coalesce(p.confirmed_at, p.created_at) >= mm.joined_at
       and p.created_at >= mm.joined_at
       and (p.meet_at is null or p.meet_at <= now())
  ) then
    raise exception '확정된 약속이 있어야 만남을 완료할 수 있습니다' using errcode = '55000';
  end if;

  insert into public.meeting_attendance (meeting_id, user_id)
  values (p_meeting_id, v_uid)
  on conflict do nothing;

  insert into public.connections (user_a_id, user_b_id, meeting_id, first_met_at)
  select least(v_uid, a.user_id), greatest(v_uid, a.user_id), p_meeting_id, now()
    from public.meeting_attendance a
    join public.meeting_members mm
     on mm.meeting_id = a.meeting_id and mm.user_id = a.user_id
   where a.meeting_id = p_meeting_id
     and a.user_id <> v_uid
     and a.attended_at >= mm.joined_at
  on conflict (user_a_id, user_b_id) do nothing;

  insert into public.albums (meeting_id)
  values (p_meeting_id)
  on conflict (meeting_id) do nothing;

  select al.id into v_album_id from public.albums al where al.meeting_id = p_meeting_id;

  select count(*)::int into v_attended_count
    from public.meeting_attendance a
    join public.meeting_members mm
      on mm.meeting_id = a.meeting_id and mm.user_id = a.user_id
   where a.meeting_id = p_meeting_id
     and a.attended_at >= mm.joined_at;

  select count(*)::int into v_member_count
    from public.meeting_members mm where mm.meeting_id = p_meeting_id;

  if v_attended_count >= v_member_count then
    update public.meetings
       set status = 'completed'
     where id = p_meeting_id and status <> 'completed';
  end if;

  select count(*)::int into v_connection_count
    from public.connections c
   where exists (select 1 from public.meeting_members ma where ma.meeting_id = p_meeting_id and ma.user_id = c.user_a_id)
     and exists (select 1 from public.meeting_members mb where mb.meeting_id = p_meeting_id and mb.user_id = c.user_b_id);

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

-- 확정은 투표 트리거·시간 정리 함수만 수행한다. 브라우저가 확정을 되돌려
-- 모임을 다시 열거나 다른 참석자의 실명을 재사용하지 못하도록 단조성을 보장한다.
revoke update on table public.meeting_plans from anon, authenticated;

create or replace function public.prevent_plan_unconfirm()
returns trigger
language plpgsql
as $$
begin
  if old.confirmed and not new.confirmed then
    raise exception '확정된 약속은 취소할 수 없습니다' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists meeting_plans_prevent_unconfirm on public.meeting_plans;
create trigger meeting_plans_prevent_unconfirm
before update on public.meeting_plans
for each row execute function public.prevent_plan_unconfirm();

-- 메시지 시각은 클라이언트가 과거·미래로 위조하지 못하게 서버 시각으로 기록한다.
create or replace function public.stamp_message_created_at()
returns trigger
language plpgsql
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists messages_stamp_created_at on public.messages;
create trigger messages_stamp_created_at
before insert on public.messages
for each row execute function public.stamp_message_created_at();

drop policy if exists "참가 모임 메시지 작성" on public.messages;
create policy "참가 모임 메시지 작성" on public.messages
for insert with check (
  sender_id = auth.uid()
  and exists (
    select 1 from public.meeting_members mm
     where mm.meeting_id = messages.meeting_id
       and mm.user_id = auth.uid()
       and messages.created_at >= mm.joined_at
  )
);

-- 장소 선택 RPC도 RLS를 우회하므로 호출자의 참가 시점 이후 카드만 수정할 수 있게 한다.
create or replace function public.select_plan_place(
  p_plan_id uuid,
  p_place_id text default null,
  p_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meeting_id uuid;
  v_created_at timestamptz;
  v_joined_at timestamptz;
  v_confirmed boolean;
  v_candidate jsonb;
begin
  select meeting_id, created_at, confirmed
    into v_meeting_id, v_created_at, v_confirmed
    from public.meeting_plans where id = p_plan_id;
  if v_meeting_id is null then
    raise exception '약속 카드를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  select joined_at into v_joined_at
    from public.meeting_members
   where meeting_id = v_meeting_id and user_id = auth.uid();
  if v_joined_at is null or v_created_at < v_joined_at then
    raise exception '참가 이후에 만들어진 약속만 수정할 수 있습니다' using errcode = '42501';
  end if;
  if v_confirmed then
    raise exception '이미 확정된 약속의 장소는 바꿀 수 없습니다' using errcode = '55000';
  end if;
  select c into v_candidate
    from public.meeting_plans p,
         lateral jsonb_array_elements(coalesce(p.candidates, '[]'::jsonb)) c
   where p.id = p_plan_id
     and ((nullif(p_place_id, '') is not null and c ->> 'id' = p_place_id)
       or (nullif(p_place_id, '') is null and nullif(p_name, '') is not null and c ->> 'name' = p_name))
   limit 1;
  if v_candidate is null then
    raise exception '후보지 목록에 없는 장소입니다' using errcode = '23514';
  end if;
  update public.meeting_plans
     set selected_place = v_candidate,
         place = coalesce(nullif(v_candidate ->> 'name', ''), place)
   where id = p_plan_id;
  return v_candidate;
end;
$$;

revoke all on function public.select_plan_place(uuid, text, text) from public, anon;
grant execute on function public.select_plan_place(uuid, text, text) to authenticated, service_role;

-- 투표 확정은 약속 행을 잠근 뒤 최신 투표 수를 계산해 동시 투표 누락을 막는다.
create or replace function public.confirm_plan_when_unanimous()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meeting_id uuid;
begin
  select meeting_id into v_meeting_id
    from public.meeting_plans
   where id = new.plan_id
   for update;
  if v_meeting_id is null or v_meeting_id <> new.meeting_id then
    raise exception '약속 카드가 이 모임에 속하지 않습니다' using errcode = '23503';
  end if;
  if (select count(*) from public.meeting_plan_votes v where v.plan_id = new.plan_id)
     >= (select count(*) from public.meeting_members mm where mm.meeting_id = new.meeting_id) then
    update public.meeting_plans set confirmed = true where id = new.plan_id and not confirmed;
  end if;
  return new;
end;
$$;
