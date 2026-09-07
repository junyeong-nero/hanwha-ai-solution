-- 참가·초대·탈퇴를 기존 메시지 Realtime으로 알린다. 시스템 메시지는 안 읽음 수에 포함되지 않는다.
-- 멤버 테이블의 DELETE를 직접 구독하지 않아 다른 방의 참가 정보가 노출되지 않는다.
create function public.notify_room_member_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meeting_id uuid;
begin
  v_meeting_id := case when tg_op = 'DELETE' then old.meeting_id else new.meeting_id end;
  -- 모임 삭제의 연쇄 탈퇴와 마지막 멤버 탈퇴에는 알림을 남기지 않는다.
  if exists (select 1 from public.meetings where id = v_meeting_id)
     and exists (select 1 from public.meeting_members where meeting_id = v_meeting_id) then
    insert into public.messages(meeting_id, sender_id, body)
    values (v_meeting_id, null, case when tg_op = 'INSERT'
      then '새 멤버가 참가했어요' else '멤버가 모임을 나갔어요' end);
  end if;
  return null;
end;
$$;
revoke all on function public.notify_room_member_change() from public, anon, authenticated;

create trigger meeting_members_notify_change
after insert or delete on public.meeting_members
for each row execute function public.notify_room_member_change();
