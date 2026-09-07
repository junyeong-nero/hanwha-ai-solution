-- 초기 제공 모임은 인재경영원만 남긴다.
-- 기존 시드의 참가·대화·만남 기록은 보존하고 신규 추천에서만 제외한다.
update public.meetings
set status = 'cancelled'
where id in (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000005',
  '00000000-0000-4000-8000-000000000006'
)
and created_by is null
and status = 'open';

insert into public.meetings (id, emoji, title, tags, region, when_label, capacity) values
  ('00000000-0000-4000-8000-000000000007', '🌿', '인재경영원 교육 후 저녁 산책', array['산책', '러닝'], '인재경영원', '평일 저녁', 6)
on conflict (id) do nothing;

-- 이미 저장된 프로필은 바꾸지 않고, 새 프로필의 기본값만 변경한다.
alter table public.profiles alter column region set default '인재경영원';
alter table public.profiles alter column regions set default array['인재경영원'];
