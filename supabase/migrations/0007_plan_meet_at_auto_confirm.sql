-- 약속 시간이 지나면 자동 확정 (이슈 #22)
-- 1) meeting_plans.meet_at — 기계가 읽을 수 있는 약속 시각. time_label 은 사람이 읽는 문구로 그대로 둔다.
-- 2) meeting_plans.confirm_reason — 'vote'(전원 투표) / 'due'(시간 경과) 로 확정 경로를 구분한다.
-- 3) settle_due_plans() — 시간이 지난 미확정 카드를 확정한다. 브라우저는 confirmed 만 바꿀 수 있고
--    confirm_reason 은 못 바꾸므로, security definer 함수로만 자동 확정이 일어난다.
--
-- meet_at 이 null 인 카드("평일 저녁"처럼 날짜를 짚을 수 없는 문구)는 자동 확정 대상이 아니며
-- 기존대로 전원 투표로만 확정된다.

-- ============================================================
-- 1. 컬럼
-- ============================================================

alter table public.meeting_plans
  add column if not exists meet_at timestamptz,
  add column if not exists confirm_reason text;

alter table public.meeting_plans drop constraint if exists meeting_plans_confirm_reason_check;
alter table public.meeting_plans add constraint meeting_plans_confirm_reason_check
  check (confirm_reason is null or confirm_reason in ('vote', 'due'));

-- 이미 확정된 기존 카드는 전원 투표로 확정된 것이다
update public.meeting_plans set confirm_reason = 'vote' where confirmed and confirm_reason is null;

-- 자동 확정 대상만 훑도록 부분 인덱스를 둔다
create index if not exists meeting_plans_due_idx
  on public.meeting_plans (meet_at) where not confirmed;

-- 브라우저는 여전히 confirmed 만 쓸 수 있다 (meet_at · confirm_reason 은 서버 전용)
revoke update on table public.meeting_plans from anon, authenticated;
grant update (confirmed) on table public.meeting_plans to authenticated;

-- ============================================================
-- 2. 전원 투표 확정에 경로를 남긴다
-- ============================================================

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
    update public.meeting_plans
       set confirmed = true, confirm_reason = coalesce(confirm_reason, 'vote')
     where id = new.plan_id and not confirmed;
  end if;
  return new;
end;
$$;

drop trigger if exists meeting_plan_votes_confirm_when_unanimous on public.meeting_plan_votes;
create trigger meeting_plan_votes_confirm_when_unanimous
after insert on public.meeting_plan_votes
for each row execute function public.confirm_plan_when_unanimous();

-- ============================================================
-- 3. 약속 시간이 지난 카드 자동 확정
-- ============================================================

-- 한 모임만 정리한다. 그 모임의 멤버가 채팅방을 열 때 호출한다.
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
     set confirmed = true, confirm_reason = 'due'
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

-- 전체를 한 번에 정리한다. 서비스 역할 전용 — pg_cron 을 쓸 수 있으면 주기 실행에 건다.
--   select cron.schedule('settle-due-plans', '*/10 * * * *', $$select public.settle_all_due_plans()$$);
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
     set confirmed = true, confirm_reason = 'due'
   where not confirmed
     and meet_at is not null
     and meet_at <= now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.settle_all_due_plans() from public, anon, authenticated;
grant execute on function public.settle_all_due_plans() to service_role;
