-- 0015 — 모임 나가기 · 확정 투표 취소 · 멤버 관심사 태그
-- 사용자 점검(UX 제안)에서 나온 세 가지를 서버에 붙인다.
--   1) leave_meeting: 만남 완료 전이면 내 참가와 내 투표를 함께 지운다 (원자적 · 멱등)
--   2) withdraw_plan_vote: 아직 확정되지 않은 약속의 내 투표를 거둔다. 삭제 이벤트를 Realtime 으로 흘리기 위해
--      meeting_plan_votes 는 replica identity full 로 둔다 (old 행에 plan_id · meeting_id · user_id 가 실린다)
--   3) room_members: 멤버의 관심사·취미 상위 4개를 함께 돌려준다 — 익명 상태에서도 대화 소재가 되도록
--      (실명·사번은 그대로 연결된 상대에게만)

-- ============================================================
-- 1. 모임 나가기
-- ============================================================
create or replace function public.leave_meeting(p_meeting_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_left integer := 0;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  -- 만남을 완료한 모임은 연결(실명 공개)의 근거라 나갈 수 없다
  if exists (
    select 1 from public.meeting_attendance a
     where a.meeting_id = p_meeting_id and a.user_id = v_uid
  ) then
    raise exception using errcode = 'P0001', message = '만남을 완료한 모임은 나갈 수 없어요';
  end if;
  delete from public.meeting_plan_votes v
   where v.meeting_id = p_meeting_id and v.user_id = v_uid;
  delete from public.meeting_members mm
   where mm.meeting_id = p_meeting_id and mm.user_id = v_uid;
  get diagnostics v_left = row_count;
  return v_left > 0;
end;
$$;
revoke all on function public.leave_meeting(uuid) from public, anon;
grant execute on function public.leave_meeting(uuid) to authenticated, service_role;

-- ============================================================
-- 2. 확정 투표 취소
-- ============================================================
alter table public.meeting_plan_votes replica identity full;

create or replace function public.withdraw_plan_vote(p_plan_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n integer := 0;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  perform 1 from public.meeting_plans where id = p_plan_id for update;
  if exists (select 1 from public.meeting_plans p where p.id = p_plan_id and (p.confirmed or p.collecting)) then
    raise exception using errcode = 'P0001', message = '이미 확정된 약속이에요';
  end if;
  delete from public.meeting_plan_votes v
   where v.plan_id = p_plan_id and v.user_id = v_uid;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;
revoke all on function public.withdraw_plan_vote(uuid) from public, anon;
grant execute on function public.withdraw_plan_vote(uuid) to authenticated, service_role;

-- ============================================================
-- 3. room_members — 관심사·취미 태그 추가 (반환 컬럼이 늘어나 지우고 다시 만든다)
-- ============================================================
drop function if exists public.room_members(uuid);
create or replace function public.room_members(p_meeting_id uuid)
returns table (user_id uuid, nickname text, avatar text, company_id text, real_name text, interests text[])
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
    end as real_name,
    (
      select coalesce(array_agg(x order by ord), '{}'::text[])
        from (
          select x, row_number() over () as ord
            from unnest(coalesce(p.interests, '{}'::text[]) || coalesce(p.hobbies, '{}'::text[])) as x
           limit 4
        ) t
    ) as interests
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
revoke all on function public.room_members(uuid) from public, anon;
grant execute on function public.room_members(uuid) to authenticated, service_role;
