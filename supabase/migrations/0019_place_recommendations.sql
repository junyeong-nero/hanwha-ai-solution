-- 새 추천은 후보 목록만 저장한다. 이전 약속 데이터는 보존하지만 새 화면에서 확정하지 않는다.
alter table public.meeting_plans add column recommendation_only boolean not null default false;
alter table public.meeting_plans alter column recommendation_only set default true;
alter table public.meeting_plans add column search_meta jsonb;
alter table public.meeting_plans add column context_since timestamptz;
alter table public.meeting_plans add constraint place_recommendation_no_schedule check (
  not recommendation_only or (not confirmed and meet_at is null and selected_place is null
    and schedule is null and not collecting and poll_id is null and confirm_reason is null and time_label='')
);

-- 외부 AI 응답을 기다리는 동안 탈퇴했더라도 후보가 저장되지 않게 재검사한다.
create function public.guard_place_recommendation_member() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.recommendation_only then
    perform 1 from public.meetings where id=new.meeting_id for update;
    if not exists(select 1 from public.meeting_members where meeting_id=new.meeting_id and user_id=new.created_by
      and joined_at<=coalesce(new.context_since,new.created_at)) then
      raise exception '현재 모임 멤버만 장소를 추천할 수 있어요' using errcode='42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger meeting_plans_guard_place_member before insert on public.meeting_plans
for each row execute function public.guard_place_recommendation_member();

-- 확정 RPC뿐 아니라 전원 투표 트리거·의견 수집 RPC가 간접 갱신하는 경로도 막는다.
create function public.guard_place_recommendation() returns trigger
language plpgsql set search_path=public as $$
begin
  if old.recommendation_only and new is distinct from old then
    raise exception '장소 후보는 시간이나 장소를 확정할 수 없어요' using errcode='55000';
  end if;
  return new;
end;
$$;
create trigger meeting_plans_guard_place_recommendation before update on public.meeting_plans
for each row execute function public.guard_place_recommendation();

create function public.guard_place_recommendation_vote() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.meeting_plans where id=new.plan_id and recommendation_only) then
    raise exception '장소 후보는 확정 투표를 받지 않아요' using errcode='55000';
  end if;
  return new;
end;
$$;
create trigger meeting_plan_votes_guard_place before insert or update on public.meeting_plan_votes
for each row execute function public.guard_place_recommendation_vote();

-- 추천 생성 중 들어온 멤버에게도 참가 이전 대화의 요약이 새어 나가지 않게 한다.
-- 실제 사용한 가장 오래된 대화보다 먼저 참가한 멤버만 후보 이유를 읽는다.
drop policy if exists "참가 모임 약속 조회" on public.meeting_plans;
create policy "참가 모임 약속 조회" on public.meeting_plans for select to authenticated
using (exists(select 1 from public.meeting_members mm where mm.meeting_id=meeting_plans.meeting_id
  and mm.user_id=auth.uid() and mm.joined_at<=coalesce(meeting_plans.context_since,meeting_plans.created_at)));

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

  -- 첫 체크인이 만남 참여자의 경계다. 이후 들어온 사람은 기존 실명을 열 수 없다.
  -- 약속 추천 사용 여부와는 무관하며 같은 모임 행 잠금 아래 검사한다.
  if exists (
    select 1 from public.meeting_members mm
    where mm.meeting_id=p_meeting_id and mm.user_id=v_uid
      and mm.joined_at > (select min(attended_at) from public.meeting_attendance where meeting_id=p_meeting_id)
  ) then
    raise exception '첫 만남 완료 이후 참가한 멤버예요' using errcode='55000';
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
