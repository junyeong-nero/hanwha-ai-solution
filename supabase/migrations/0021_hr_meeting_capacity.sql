-- 초기 인재경영원 모임의 정원을 300명으로 늘린다.
update public.meetings
set capacity = 300
where id = '00000000-0000-4000-8000-000000000007'
  and created_by is null;
