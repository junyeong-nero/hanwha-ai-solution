-- 사용자가 직접 만드는 모임: 만든 사람을 기록하고, 로그인 사용자가 본인 명의로 모임을 등록할 수 있게 한다.
-- 만든 모임도 status = 'open' 이라 recommend-meetings 후보에 그대로 포함된다.
alter table public.meetings
  add column if not exists created_by uuid references auth.users(id) on delete set null;

create policy "모임 직접 만들기" on public.meetings
for insert to authenticated
with check (created_by = auth.uid());
