-- 약속 투표 · 개인별 만남 체크인 · 다중 선호 지역 · 약속 후보지
-- 1) profiles.regions   — 선호 지역을 여러 개 저장하고 기존 region 값을 백필한다
-- 2) meeting_plans.candidates — 웹 검색으로 찾은 후보지 목록(jsonb)
-- 3) meeting_plan_votes — 멤버 전원이 투표하면 트리거가 약속을 확정한다
-- 4) meeting_attendance — 각자 만남 완료를 체크인하면 attend_meeting_tx 가 체크인한 사람끼리만 연결한다
-- 5) room_members       — 실명은 본인 또는 connections 로 연결된 상대에게만 보인다 (모임 완료 여부와 무관)
-- 재실행해도 안전하도록 if not exists · create or replace · drop policy if exists 를 쓴다.

-- ============================================================
-- 1. 프로필 다중 선호 지역
-- ============================================================

alter table public.profiles add column if not exists regions text[] not null default '{}';

-- 기존 단일 region 을 regions 로 옮긴다 (이미 채워진 행은 건드리지 않는다)
update public.profiles set regions = array[region] where region is not null and cardinality(regions) = 0;

-- ============================================================
-- 2. 약속 카드 후보지
-- ============================================================

-- [{ name, address, url, why }] 형태. 등록은 suggest-meeting-plan 이 서비스 역할로만 한다.
alter table public.meeting_plans add column if not exists candidates jsonb not null default '[]'::jsonb;

-- ============================================================
-- 3. 약속 투표
-- ============================================================

-- 한 사용자는 한 약속 카드에 한 번만 투표한다. 취소·변경은 브라우저에서 할 수 없다.
create table if not exists public.meeting_plan_votes (
  plan_id uuid references public.meeting_plans(id) on delete cascade,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (plan_id, user_id)
);

create index if not exists meeting_plan_votes_meeting_id_idx on public.meeting_plan_votes (meeting_id);

alter table public.meeting_plan_votes enable row level security;

drop policy if exists "참가 모임 투표 조회" on public.meeting_plan_votes;
create policy "참가 모임 투표 조회" on public.meeting_plan_votes
for select using (public.is_meeting_member(meeting_id, auth.uid()));

drop policy if exists "참가 모임 투표 본인 등록" on public.meeting_plan_votes;
create policy "참가 모임 투표 본인 등록" on public.meeting_plan_votes
for insert with check (
  user_id = auth.uid()
  and public.is_meeting_member(meeting_id, auth.uid())
);

-- 브라우저는 투표를 바꾸거나 지울 수 없다 (정책이 없는 데 더해 권한도 회수한다)
revoke update, delete on table public.meeting_plan_votes from anon, authenticated;

-- 멤버 전원이 투표하면 약속을 확정한다.
-- 브라우저는 meeting_plans.confirmed 만 바꿀 수 있지만, 이 트리거는 security definer 라 RLS 와 무관하게 동작한다.
create or replace function public.confirm_plan_when_unanimous()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 다른 모임의 약속 카드에 투표해 적은 표로 확정되는 일을 막는다
  if not exists (
    select 1 from public.meeting_plans p
    where p.id = new.plan_id
      and p.meeting_id = new.meeting_id
  ) then
    raise exception '약속 카드가 이 모임의 것이 아닙니다' using errcode = '23503';
  end if;

  if (select count(*) from public.meeting_plan_votes v where v.plan_id = new.plan_id)
     >= (select count(*) from public.meeting_members mm where mm.meeting_id = new.meeting_id) then
    update public.meeting_plans set confirmed = true where id = new.plan_id and not confirmed;
  end if;
  return new;
end;
$$;

drop trigger if exists meeting_plan_votes_confirm_when_unanimous on public.meeting_plan_votes;
create trigger meeting_plan_votes_confirm_when_unanimous
after insert on public.meeting_plan_votes
for each row execute function public.confirm_plan_when_unanimous();

-- ============================================================
-- 4. 개인별 만남 체크인
-- ============================================================

create table if not exists public.meeting_attendance (
  meeting_id uuid references public.meetings(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  attended_at timestamptz default now(),
  primary key (meeting_id, user_id)
);

alter table public.meeting_attendance enable row level security;

drop policy if exists "참가 모임 체크인 조회" on public.meeting_attendance;
create policy "참가 모임 체크인 조회" on public.meeting_attendance
for select using (public.is_meeting_member(meeting_id, auth.uid()));

-- 체크인은 attend_meeting_tx RPC 로만 한다 (브라우저 직접 등록 금지)
revoke insert, update, delete on table public.meeting_attendance from anon, authenticated;

-- ============================================================
-- 5. Realtime
-- ============================================================

alter publication supabase_realtime add table public.meeting_plan_votes, public.meeting_attendance;

-- ============================================================
-- 6. RPC: 개인별 만남 체크인
-- ============================================================

-- 호출자를 체크인하고, 이미 체크인한 다른 멤버와 연결 쌍을 만들고, 사진첩을 준비한다.
-- 멤버 전원이 체크인하면 모임을 completed 로 바꾼다. 재호출해도 결과가 같다(멱등).
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

-- 모임 단위 완료 RPC 는 개인별 체크인으로 대체한다
drop function if exists public.complete_meeting_tx(uuid);

-- ============================================================
-- 7. room_members — 실명 공개 기준을 "연결된 상대" 로만 좁힌다
-- ============================================================

-- 모임 멤버 목록 (호출자 포함). real_name 은 본인 또는 connections 로 연결된 상대에게만 채운다.
-- 모임이 completed 여도 서로 체크인하지 않은 사람의 실명은 보이지 않는다. 호출자가 멤버가 아니면 빈 결과.
create or replace function public.room_members(p_meeting_id uuid)
returns table (user_id uuid, nickname text, avatar text, company_id text, real_name text)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.user_id,
    p.nickname,
    p.avatar,
    p.company_id,
    case
      when p.user_id = auth.uid() then p.real_name
      when exists (
        select 1 from public.connections c
        where c.user_a_id = least(auth.uid(), p.user_id)
          and c.user_b_id = greatest(auth.uid(), p.user_id)
      ) then p.real_name
      else null
    end as real_name
  from public.meeting_members mm
  join public.profiles p on p.user_id = mm.user_id
  join public.meetings m on m.id = mm.meeting_id
  where mm.meeting_id = p_meeting_id
    and auth.uid() is not null
    and exists (
      select 1 from public.meeting_members me
      where me.meeting_id = p_meeting_id
        and me.user_id = auth.uid()
    )
  order by mm.joined_at, p.user_id;
$$;
