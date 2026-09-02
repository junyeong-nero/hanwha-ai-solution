-- MoonLight Hanwha 초기 스키마
-- 테이블 · 인덱스 · RLS 정책 · Realtime publication · security definer RPC 를 한 파일에 정의한다.
-- 모든 사용자 식별자는 auth.users.id 를 사용한다.

create extension if not exists pgcrypto with schema extensions;

-- ============================================================
-- 1. 테이블
-- ============================================================

-- 계열사 (행성 표시 정보)
create table public.companies (
  id text primary key,
  name text not null,
  color text not null,
  sort_order int not null
);

-- 모임
create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  emoji text not null default '🌙',
  tags text[] not null default '{}',
  region text not null,
  when_label text not null,
  capacity int not null default 6,
  status text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
  created_at timestamptz default now()
);

-- 프로필. real_name 은 본인·연결된 상대·완료된 모임에서만 노출된다.
-- employee_no 는 파일럿 단계 전용이며 발표 단계에서는 항상 비워 둔다.
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  employee_no text null,
  real_name text not null,
  nickname text not null,
  avatar text not null default '🌙',
  company_id text references public.companies(id),
  region text,
  age int,
  gender text null,
  mbti text null,
  interests text[] not null default '{}',
  hobbies text[] not null default '{}',
  group_size_min int not null default 4,
  group_size_max int not null default 6,
  matching_preferences jsonb not null default '{"balance":false,"scope":"all","direction":"wide"}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 모임 참가
create table public.meeting_members (
  meeting_id uuid references public.meetings(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz default now(),
  primary key (meeting_id, user_id)
);

-- 채팅 메시지 (500자 제한, Realtime 전송)
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references public.meetings(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete cascade,
  body text not null check (char_length(body) <= 500),
  created_at timestamptz default now()
);

-- AI 약속 추천 카드 (Realtime 전송)
create table public.meeting_plans (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references public.meetings(id) on delete cascade,
  created_by uuid references auth.users(id),
  place text not null,
  time_label text not null,
  activity text not null,
  nearby text[] not null default '{}',
  confirmed boolean not null default false,
  source text not null default 'llm' check (source in ('llm', 'fallback')),
  created_at timestamptz default now()
);

-- 만남이 성사된 사용자 쌍. (least, greatest) 순서로 저장하고 유니크 제약으로 중복을 막는다.
create table public.connections (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid references auth.users(id) on delete cascade,
  user_b_id uuid references auth.users(id) on delete cascade,
  meeting_id uuid references public.meetings(id) on delete set null,
  first_met_at timestamptz default now(),
  check (user_a_id < user_b_id),
  unique (user_a_id, user_b_id)
);

-- 모임별 사진첩 (발표 단계에서는 플레이스홀더만)
create table public.albums (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid unique references public.meetings(id) on delete cascade,
  created_at timestamptz default now()
);

-- 발표용 임시 입장 코드 (해시만 저장)
create table public.demo_access_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text unique not null,
  expires_at timestamptz not null,
  active boolean not null default true,
  use_count int not null default 0,
  max_uses int not null default 200,
  created_at timestamptz default now()
);

-- 입장 코드와 익명 세션의 결합
create table public.demo_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  code_id uuid references public.demo_access_codes(id),
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

-- 입장 시도 기록 (키당 10분 20회 레이트리밋 계산용)
create table public.demo_entry_attempts (
  id bigserial primary key,
  attempt_key text not null,
  attempted_at timestamptz default now()
);

-- LLM 호출 메타데이터. 원문 프롬프트·응답은 저장하지 않는다.
create table public.ai_recommendation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  function_name text not null,
  model text,
  meeting_ids uuid[] not null default '{}',
  success boolean not null,
  fallback boolean not null default false,
  latency_ms int,
  error_type text null,
  created_at timestamptz default now()
);

-- ============================================================
-- 2. 인덱스
-- ============================================================

create index meeting_members_user_id_idx on public.meeting_members (user_id);
create index messages_meeting_id_created_at_idx on public.messages (meeting_id, created_at);
create index connections_user_a_id_idx on public.connections (user_a_id);
create index connections_user_b_id_idx on public.connections (user_b_id);
create index demo_entry_attempts_key_at_idx on public.demo_entry_attempts (attempt_key, attempted_at);

-- ============================================================
-- 3. 보조 함수·트리거
-- ============================================================

-- profiles.updated_at 자동 갱신
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- 모임 멤버 여부. RLS 정책 안에서 meeting_members 를 다시 조회하면 재귀가 생기므로
-- security definer 함수로 우회한다.
create or replace function public.is_meeting_member(p_meeting_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.meeting_members mm
    where mm.meeting_id = p_meeting_id
      and mm.user_id = p_user_id
  );
$$;

revoke all on function public.is_meeting_member(uuid, uuid) from public, anon;
grant execute on function public.is_meeting_member(uuid, uuid) to authenticated, service_role;

-- 입장 코드 사용 횟수를 원자적으로 증가시킨다. 한도를 넘으면 false.
-- 서비스 역할(Edge Function) 전용.
create or replace function public.consume_demo_code(p_code_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  update public.demo_access_codes
     set use_count = use_count + 1
   where id = p_code_id
     and active
     and expires_at > now()
     and use_count < max_uses;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.consume_demo_code(uuid) from public, anon, authenticated;
grant execute on function public.consume_demo_code(uuid) to service_role;

-- ============================================================
-- 4. RLS
-- ============================================================

alter table public.companies enable row level security;
alter table public.meetings enable row level security;
alter table public.profiles enable row level security;
alter table public.meeting_members enable row level security;
alter table public.messages enable row level security;
alter table public.meeting_plans enable row level security;
alter table public.connections enable row level security;
alter table public.albums enable row level security;
alter table public.demo_access_codes enable row level security;
alter table public.demo_sessions enable row level security;
alter table public.demo_entry_attempts enable row level security;
alter table public.ai_recommendation_runs enable row level security;

-- 계열사·모임 목록: 로그인 사용자 누구나 조회
create policy "계열사 목록 조회" on public.companies
for select to authenticated using (true);

create policy "모임 목록 조회" on public.meetings
for select to authenticated using (true);

-- 프로필: 본인 행만 조회·등록·수정
create policy "프로필 본인 조회" on public.profiles
for select using (auth.uid() = user_id);

create policy "프로필 본인 등록" on public.profiles
for insert with check (auth.uid() = user_id);

create policy "프로필 본인 수정" on public.profiles
for update using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- 모임 참가: 내가 속한 모임의 멤버 목록 조회, 본인 행만 등록
create policy "참가 모임 멤버 조회" on public.meeting_members
for select using (
  user_id = auth.uid()
  or public.is_meeting_member(meeting_id, auth.uid())
);

create policy "모임 참가 본인 등록" on public.meeting_members
for insert with check (user_id = auth.uid());

-- 메시지: 참가 중인 모임만 조회·작성
create policy "참가 모임 메시지 조회" on public.messages
for select using (
  exists (select 1 from public.meeting_members mm
          where mm.meeting_id = messages.meeting_id
            and mm.user_id = auth.uid())
);

create policy "참가 모임 메시지 작성" on public.messages
for insert with check (
  sender_id = auth.uid()
  and exists (select 1 from public.meeting_members mm
              where mm.meeting_id = messages.meeting_id
                and mm.user_id = auth.uid())
);

-- 약속 카드: 참가 중인 모임만 조회, 멤버는 confirmed 만 수정 가능
-- (등록은 Edge Function 이 서비스 역할로만 수행한다)
create policy "참가 모임 약속 조회" on public.meeting_plans
for select using (public.is_meeting_member(meeting_id, auth.uid()));

create policy "참가 모임 약속 확정" on public.meeting_plans
for update using (public.is_meeting_member(meeting_id, auth.uid()))
with check (public.is_meeting_member(meeting_id, auth.uid()));

-- 컬럼 단위 권한으로 브라우저가 confirmed 외의 컬럼을 바꾸지 못하게 한다.
revoke update on table public.meeting_plans from anon, authenticated;
grant update (confirmed) on table public.meeting_plans to authenticated;

-- 사진첩: 참가 중인 모임만 조회
create policy "참가 모임 사진첩 조회" on public.albums
for select using (public.is_meeting_member(meeting_id, auth.uid()));

-- connections · demo_access_codes · demo_sessions · demo_entry_attempts · ai_recommendation_runs
-- 는 브라우저 정책이 없다 (서비스 역할과 security definer RPC 만 접근).
-- RLS 에 더해 권한 자체를 회수해 이중으로 막는다.
revoke all on table public.connections from anon, authenticated;
revoke all on table public.demo_access_codes from anon, authenticated;
revoke all on table public.demo_sessions from anon, authenticated;
revoke all on table public.demo_entry_attempts from anon, authenticated;
revoke all on table public.ai_recommendation_runs from anon, authenticated;

-- ============================================================
-- 5. Realtime
-- ============================================================

alter publication supabase_realtime add table public.messages, public.meeting_plans;

-- ============================================================
-- 6. RPC (security definer)
-- ============================================================

-- 나와 연결된 사용자 목록 (홈 탭 행성 점등·위성 표시용)
create or replace function public.my_connections()
returns table (user_id uuid, real_name text, nickname text, avatar text, company_id text)
language sql
security definer
set search_path = public
stable
as $$
  select p.user_id, p.real_name, p.nickname, p.avatar, p.company_id
  from public.connections c
  join public.profiles p
    on p.user_id = case when c.user_a_id = auth.uid() then c.user_b_id else c.user_a_id end
  where auth.uid() is not null
    and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
  order by c.first_met_at desc;
$$;

-- 모임 멤버 목록 (호출자 포함). real_name 은 본인·연결된 상대·완료된 모임에서만 채운다.
-- 호출자가 멤버가 아니면 빈 결과.
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
      when m.status = 'completed' then p.real_name
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

-- 내가 참가한 모임 요약과 마지막 메시지 (채팅 목록용)
create or replace function public.room_summaries()
returns table (
  meeting_id uuid,
  title text,
  emoji text,
  status text,
  member_count int,
  last_body text,
  last_at timestamptz
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
    lm.created_at
  from public.meeting_members mm
  join public.meetings m on m.id = mm.meeting_id
  left join lateral (
    select msg.body, msg.created_at
    from public.messages msg
    where msg.meeting_id = m.id
    order by msg.created_at desc
    limit 1
  ) lm on true
  where auth.uid() is not null
    and mm.user_id = auth.uid()
  order by lm.created_at desc nulls last, mm.joined_at desc;
$$;

-- 모임 완료 · 연결 쌍 upsert · 사진첩 생성을 한 트랜잭션으로 처리한다. 재호출해도 결과가 같다.
create or replace function public.complete_meeting_tx(p_meeting_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_album_id uuid;
  v_connection_count int;
begin
  if v_uid is null or not exists (
    select 1 from public.meeting_members mm
    where mm.meeting_id = p_meeting_id
      and mm.user_id = v_uid
  ) then
    raise exception '모임 멤버가 아닙니다' using errcode = '42501';
  end if;

  update public.meetings m
     set status = 'completed'
   where m.id = p_meeting_id
     and m.status <> 'completed';

  -- 멤버의 모든 순서 없는 쌍을 (least, greatest) 순서로 저장한다.
  insert into public.connections (user_a_id, user_b_id, meeting_id, first_met_at)
  select least(a.user_id, b.user_id), greatest(a.user_id, b.user_id), p_meeting_id, now()
    from public.meeting_members a
    join public.meeting_members b
      on b.meeting_id = a.meeting_id
     and a.user_id < b.user_id
   where a.meeting_id = p_meeting_id
  on conflict (user_a_id, user_b_id) do nothing;

  insert into public.albums (meeting_id)
  values (p_meeting_id)
  on conflict (meeting_id) do nothing;

  select al.id into v_album_id
    from public.albums al
   where al.meeting_id = p_meeting_id;

  -- 현재 멤버끼리의 연결 행 수 (이전 모임에서 이미 연결된 쌍도 포함)
  select count(*)::int into v_connection_count
    from public.connections c
   where exists (select 1 from public.meeting_members ma
                  where ma.meeting_id = p_meeting_id and ma.user_id = c.user_a_id)
     and exists (select 1 from public.meeting_members mb
                  where mb.meeting_id = p_meeting_id and mb.user_id = c.user_b_id);

  return json_build_object('connection_count', v_connection_count, 'album_id', v_album_id);
end;
$$;

-- RPC 실행 권한: 로그인 사용자와 서비스 역할만
revoke all on function public.my_connections() from public, anon;
revoke all on function public.room_members(uuid) from public, anon;
revoke all on function public.room_summaries() from public, anon;
revoke all on function public.complete_meeting_tx(uuid) from public, anon;

grant execute on function public.my_connections() to authenticated, service_role;
grant execute on function public.room_members(uuid) to authenticated, service_role;
grant execute on function public.room_summaries() to authenticated, service_role;
grant execute on function public.complete_meeting_tx(uuid) to authenticated, service_role;
