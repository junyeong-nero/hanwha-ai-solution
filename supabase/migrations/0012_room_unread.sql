-- #12: 참가 이후 받은 메시지의 읽음 위치를 사용자별로 보존한다.
alter table public.meeting_members add column last_read_at timestamptz;

-- 클라이언트 시각 대신 실제 조회한 메시지의 서버 시각까지만 읽음 처리한다.
-- 다른 회원이나 참가 이전 메시지는 갱신할 수 없고, 늦게 끝난 요청도 읽음 위치를 되돌리지 않는다.
create function public.mark_room_read(p_meeting_id uuid, p_message_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.meeting_members mm
     set last_read_at = greatest(mm.last_read_at, msg.created_at)
    from public.messages msg
   where mm.meeting_id = p_meeting_id
     and mm.user_id = auth.uid()
     and msg.id = p_message_id
     and msg.meeting_id = mm.meeting_id
     and msg.created_at >= mm.joined_at;
$$;
revoke all on function public.mark_room_read(uuid, uuid) from public, anon;
grant execute on function public.mark_room_read(uuid, uuid) to authenticated;

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
  attended boolean,
  unread_count int
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
    ) as attended,
    (select count(*)::int from public.messages msg
      where msg.meeting_id = m.id
        and msg.sender_id <> auth.uid()
        and msg.created_at >= mm.joined_at
        and msg.created_at > coalesce(mm.last_read_at, '-infinity'::timestamptz)) as unread_count
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
