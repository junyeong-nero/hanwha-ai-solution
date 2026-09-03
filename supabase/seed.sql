-- 발표용 시드 데이터. 기존 src/index.html 의 COMPANIES · MEETINGS 상수를 옮긴 것이다.
-- 모든 구문은 on conflict do nothing 으로 재실행해도 안전하다.

-- 계열사 (행성 색상 · 정렬 순서)
insert into public.companies (id, name, color, sort_order) values
  ('aero',  '한화에어로스페이스', '#8B5CF6', 1),
  ('sol',   '한화솔루션',         '#17A67C', 2),
  ('life',  '한화생명',           '#E8B84B', 3),
  ('inv',   '한화투자증권',       '#F37321', 4),
  ('sys',   '한화시스템',         '#5A9CF3', 5),
  ('ocean', '한화오션',           '#2BB3C0', 6),
  ('hotel', '한화호텔앤드리조트', '#E86A8A', 7),
  ('gal',   '한화갤러리아',       '#B49BE0', 8)
on conflict (id) do nothing;

-- 모임 (안정적인 UUID 를 써서 프론트·테스트가 같은 id 를 참조할 수 있게 한다)
insert into public.meetings (id, emoji, title, tags, region, when_label, capacity) values
  ('00000000-0000-4000-8000-000000000001', '🏃', '판교 퇴근 후 20분 러닝 크루', array['러닝', '운동'],     '판교',   '평일 저녁',  6),
  ('00000000-0000-4000-8000-000000000002', '🥃', '각자 한 잔씩 바꿔 마시기',     array['위스키', '취향'],   '판교',   '금요일 저녁', 5),
  ('00000000-0000-4000-8000-000000000003', '📊', '엑셀 자동화 미니 클리닉',      array['자동화', '업무'],   '여의도', '수요일 점심', 6),
  ('00000000-0000-4000-8000-000000000004', '🍲', '회사 앞 국밥 원정대',          array['맛집', '점심'],     '장교',   '화요일 점심', 4),
  ('00000000-0000-4000-8000-000000000005', '🎲', '보드게임 달밤 모임',           array['보드게임', '전시'], '판교',   '목요일 저녁', 6),
  ('00000000-0000-4000-8000-000000000006', '📷', '주말 사진 산책단',             array['사진', '산책'],     '서울숲', '토요일 오후', 5),
  ('00000000-0000-4000-8000-000000000007', '🌿', '인재경영원 교육 후 저녁 산책', array['산책', '러닝'],     '인재경영원', '평일 저녁', 6)
on conflict (id) do nothing;

-- 로컬 개발용 입장 코드 123456 (30일 뒤 만료).
-- 운영·발표용 코드는 Dashboard SQL Editor 에서 따로 만들고 절대 커밋하지 않는다.
insert into public.demo_access_codes (code_hash, expires_at)
values (encode(extensions.digest('123456', 'sha256'), 'hex'), now() + interval '30 days')
on conflict (code_hash) do nothing;
