-- 메이저 이슈 수정 (#2, #4)
-- #2: 닉네임·이름·모임 텍스트 길이를 서버에서도 제한한다 (클라이언트 maxlength 는 우회 가능)
-- #4: room_summaries 가 내 체크인 여부(attended)를 함께 내려 채팅 목록 배지가 방을 열고 닫아도 변하지 않게 한다
-- 재실행 가능하도록 if exists 를 쓴다.

-- 제약을 걸기 전에 기존 행을 정리한다 (앞뒤 공백 제거·길이 절단·빈 값은 기본값). 그래야 db push 가 중간에 실패하지 않는다
update public.profiles set nickname = coalesce(nullif(left(btrim(nickname), 8), ''), '달토끼')
 where nickname is distinct from coalesce(nullif(left(btrim(nickname), 8), ''), '달토끼');
update public.profiles set real_name = coalesce(nullif(left(btrim(real_name), 10), ''), nickname)
 where real_name is distinct from coalesce(nullif(left(btrim(real_name), 10), ''), nickname);

-- 공백만 있는 이름을 막기 위해 btrim 기준으로 센다
alter table public.profiles drop constraint if exists profiles_nickname_length;
alter table public.profiles add constraint profiles_nickname_length
  check (char_length(btrim(nickname)) between 1 and 8);

alter table public.profiles drop constraint if exists profiles_real_name_length;
alter table public.profiles add constraint profiles_real_name_length
  check (char_length(btrim(real_name)) between 1 and 10);

-- 모임 컬럼도 같은 이유로 제한한다 (누구나 REST 로 insert 할 수 있고 화면·LLM 프롬프트에 그대로 들어간다)
update public.meetings
   set title = coalesce(nullif(left(btrim(title), 40), ''), '이름 없는 모임'),
       emoji = coalesce(nullif(left(emoji, 8), ''), '🌙'),
       region = coalesce(nullif(left(btrim(region), 20), ''), '판교'),
       when_label = coalesce(nullif(left(btrim(when_label), 20), ''), '시간 미정'),
       tags = tags[1:10]
 where char_length(btrim(title)) not between 1 and 40
    or char_length(emoji) not between 1 and 8
    or char_length(btrim(region)) not between 1 and 20
    or char_length(btrim(when_label)) not between 1 and 20
    or cardinality(tags) > 10;

alter table public.meetings drop constraint if exists meetings_text_length;
alter table public.meetings add constraint meetings_text_length check (
  char_length(btrim(title)) between 1 and 40
  and char_length(emoji) between 1 and 8
  and char_length(btrim(region)) between 1 and 20
  and char_length(btrim(when_label)) between 1 and 20
  and cardinality(tags) <= 10
);

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
