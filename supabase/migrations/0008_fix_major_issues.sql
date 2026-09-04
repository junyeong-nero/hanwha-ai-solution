-- 메이저 이슈 수정 (#2, #4)
-- #2: 닉네임·이름 길이를 서버에서도 제한한다 (클라이언트 maxlength 는 우회 가능)
-- #4: room_summaries 가 내 체크인 여부(attended)를 함께 내려 채팅 목록 배지가 방을 열고 닫아도 변하지 않게 한다
-- 재실행 가능하도록 if exists 를 쓴다.

alter table public.profiles drop constraint if exists profiles_nickname_length;
alter table public.profiles add constraint profiles_nickname_length
  check (char_length(nickname) between 1 and 8);

alter table public.profiles drop constraint if exists profiles_real_name_length;
alter table public.profiles add constraint profiles_real_name_length
  check (char_length(real_name) between 1 and 10);

-- 반환 컬럼이 늘어나므로 create or replace 로는 바꿀 수 없어 지우고 다시 만든다
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
      where a.meeting_id = m.id and a.user_id = auth.uid()
    ) as attended
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

revoke all on function public.room_summaries() from public, anon;
grant execute on function public.room_summaries() to authenticated, service_role;
