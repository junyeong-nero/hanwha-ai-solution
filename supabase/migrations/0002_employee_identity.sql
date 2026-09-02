-- 사번 기반 데모 로그인: (계열사, 사번) 조합은 프로필 하나에만 대응한다.
-- 동명이인은 사번으로 구분되고, 같은 사번으로 다시 로그인하면 같은 프로필·채팅이 복원된다.
create unique index if not exists profiles_company_employee_no_key
  on public.profiles (company_id, employee_no)
  where employee_no is not null;
