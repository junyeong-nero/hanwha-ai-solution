-- 만남 평가(별 0.5~5) 학습용 DB · 새 모임 친구 초대
-- 1) meeting_feedback — 만남 완료 후 별점·코멘트. 트리거가 그 시점의 특성 스냅샷(features)을 채워
--    "특성 → 별점" 형태의 AI 학습용 예시가 쌓인다. 학습 자체는 이번 범위가 아니다.
-- 2) ai_training_examples — 학습 데이터 내보내기용 뷰 (서비스 역할 전용)
-- 3) invite_to_meeting — 방장이 연결된(서로 만남 완료한) 친구만 모임에 초대한다

-- ============================================================
-- 1. 만남 평가
-- ============================================================

create table if not exists public.meeting_feedback (
  meeting_id uuid references public.meetings(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  rating numeric(2,1) not null check (rating >= 0.5 and rating <= 5 and rating * 2 = floor(rating * 2)),
  comment text check (comment is null or char_length(comment) <= 300),
  features jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (meeting_id, user_id)
);

alter table public.meeting_feedback enable row level security;

-- 본인 평가만 읽고 쓴다. 다른 사람의 별점은 보이지 않는다 (집계는 서버·학습 파이프라인에서만).
drop policy if exists "만남 평가 본인 조회" on public.meeting_feedback;
create policy "만남 평가 본인 조회" on public.meeting_feedback
for select using (user_id = auth.uid());

drop policy if exists "만남 평가 본인 등록" on public.meeting_feedback;
create policy "만남 평가 본인 등록" on public.meeting_feedback
for insert with check (
  user_id = auth.uid()
  and exists (select 1 from public.meeting_attendance a
              where a.meeting_id = meeting_feedback.meeting_id and a.user_id = auth.uid())
);

drop policy if exists "만남 평가 본인 수정" on public.meeting_feedback;
create policy "만남 평가 본인 수정" on public.meeting_feedback
for update using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke delete on table public.meeting_feedback from anon, authenticated;

-- 평가 시점의 특성 스냅샷. 사번·실명은 넣지 않는다.
create or replace function public.fill_feedback_features()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gender text;
  v_members uuid[];
  v_member_count int;
  v_known_count int;
  v_same_gender numeric;
  v_plan record;
begin
  select array_agg(mm.user_id) into v_members
    from public.meeting_members mm where mm.meeting_id = new.meeting_id;
  v_member_count := coalesce(cardinality(v_members), 0);

  select p.gender into v_gender from public.profiles p where p.user_id = new.user_id;

  -- 이 모임 멤버 중 평가 시점 기준으로 나와 연결된 사람 수 (이 모임에서 처음 연결된 사람 포함)
  select count(*)::int into v_known_count
    from public.connections c
   where (c.user_a_id = new.user_id and c.user_b_id = any(v_members))
      or (c.user_b_id = new.user_id and c.user_a_id = any(v_members));

  -- 다른 멤버 중 같은 성별 비율
  select case when v_gender is null or count(*) = 0 then null
              else round(count(*) filter (where p.gender = v_gender)::numeric / count(*), 2) end
    into v_same_gender
    from public.profiles p
   where p.user_id = any(v_members) and p.user_id <> new.user_id;

  select pl.source, pl.confirmed, cardinality(pl.nearby) as nearby_count, jsonb_array_length(pl.candidates) as candidate_count
    into v_plan
    from public.meeting_plans pl
   where pl.meeting_id = new.meeting_id
   order by pl.created_at desc limit 1;

  new.features := jsonb_build_object(
    'meeting', (select jsonb_build_object(
        'region', m.region, 'tags', to_jsonb(m.tags), 'capacity', m.capacity, 'when_label', m.when_label,
        'member_count', v_member_count, 'created_by_me', m.created_by = new.user_id,
        'attended_count', (select count(*) from public.meeting_attendance a where a.meeting_id = m.id))
      from public.meetings m where m.id = new.meeting_id),
    'rater', (select jsonb_build_object(
        'company_id', p.company_id, 'regions', to_jsonb(p.regions), 'interests', to_jsonb(p.interests),
        'hobbies', to_jsonb(p.hobbies), 'gender', p.gender, 'age', p.age, 'mbti', p.mbti,
        'group_size', jsonb_build_array(p.group_size_min, p.group_size_max),
        'matching_preferences', p.matching_preferences)
      from public.profiles p where p.user_id = new.user_id),
    'known_count', v_known_count,
    'same_gender_ratio', v_same_gender,
    'plan', case when v_plan is null then null else jsonb_build_object(
        'source', v_plan.source, 'confirmed', v_plan.confirmed,
        'nearby_count', v_plan.nearby_count, 'candidate_count', v_plan.candidate_count) end,
    'snapshot_at', now()
  );
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists meeting_feedback_fill_features on public.meeting_feedback;
create trigger meeting_feedback_fill_features
before insert or update on public.meeting_feedback
for each row execute function public.fill_feedback_features();

-- ============================================================
-- 2. 학습 데이터 내보내기 뷰 (서비스 역할 전용)
-- ============================================================

create or replace view public.ai_training_examples as
select f.meeting_id, f.user_id, f.features, f.rating as label, f.comment, f.created_at
  from public.meeting_feedback f;

revoke all on public.ai_training_examples from anon, authenticated;
grant select on public.ai_training_examples to service_role;

-- ============================================================
-- 3. 친구 초대 RPC
-- ============================================================

-- 방장(created_by)이 연결된 친구만 초대한다. 반환값은 새로 추가된 멤버 수.
create or replace function public.invite_to_meeting(p_meeting_id uuid, p_user_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rows int;
begin
  if v_uid is null or not exists (
    select 1 from public.meetings m where m.id = p_meeting_id and m.created_by = v_uid
  ) then
    raise exception '모임을 만든 사람만 초대할 수 있습니다' using errcode = '42501';
  end if;

  insert into public.meeting_members (meeting_id, user_id)
  select p_meeting_id, u
    from unnest(p_user_ids) as u
   where u <> v_uid
     and exists (select 1 from public.connections c
                 where c.user_a_id = least(v_uid, u) and c.user_b_id = greatest(v_uid, u))
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.invite_to_meeting(uuid, uuid[]) from public, anon;
grant execute on function public.invite_to_meeting(uuid, uuid[]) to authenticated, service_role;
