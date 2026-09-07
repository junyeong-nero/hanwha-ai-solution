-- 후보 장소 선택 (이슈 #34)
-- 1) meeting_plans.selected_place — 지도·목록에서 고른 후보 장소 한 곳(jsonb). 확정 데이터로 넘어간다.
-- 2) select_plan_place() — 멤버가 후보 중 하나를 만남 장소로 고른다. 후보 목록(candidates) 안의
--    장소만 고를 수 있으므로 브라우저가 임의의 장소를 밀어 넣을 수 없다.
--
-- 브라우저는 여전히 meeting_plans 의 confirmed 컬럼만 직접 쓸 수 있고, 장소 선택은 이 함수로만 일어난다.
-- 선택 결과는 Realtime(meeting_plans UPDATE)으로 방 안의 모든 멤버에게 그대로 퍼진다.
-- 재실행해도 안전하도록 if not exists · create or replace 를 쓴다.

-- ============================================================
-- 1. 컬럼
-- ============================================================

alter table public.meeting_plans add column if not exists selected_place jsonb;

-- ============================================================
-- 2. 후보 장소 선택 RPC
-- ============================================================

-- p_place_id: 카카오 장소 ID. 검색으로 확인되지 않아 ID 가 없는 후보는 이름(p_name)으로 고른다.
create or replace function public.select_plan_place(
  p_plan_id uuid,
  p_place_id text default null,
  p_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meeting_id uuid;
  v_confirmed boolean;
  v_candidate jsonb;
begin
  select meeting_id, confirmed into v_meeting_id, v_confirmed
    from public.meeting_plans where id = p_plan_id;
  if v_meeting_id is null then
    raise exception '약속 카드를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if not public.is_meeting_member(v_meeting_id, auth.uid()) then
    raise exception '이 모임의 멤버만 장소를 고를 수 있습니다' using errcode = '42501';
  end if;
  if v_confirmed then
    raise exception '이미 확정된 약속의 장소는 바꿀 수 없습니다' using errcode = '55000';
  end if;

  -- 후보 목록 안에 있는 장소만 고를 수 있다 (임의의 장소 주입 차단)
  select c into v_candidate
    from public.meeting_plans p,
         lateral jsonb_array_elements(coalesce(p.candidates, '[]'::jsonb)) c
   where p.id = p_plan_id
     and (
       (nullif(p_place_id, '') is not null and c ->> 'id' = p_place_id)
       or (nullif(p_place_id, '') is null and nullif(p_name, '') is not null and c ->> 'name' = p_name)
     )
   limit 1;

  if v_candidate is null then
    raise exception '후보지에 없는 장소입니다' using errcode = '23514';
  end if;

  update public.meeting_plans
     set selected_place = v_candidate,
         place = coalesce(nullif(v_candidate ->> 'name', ''), place)
   where id = p_plan_id;

  return v_candidate;
end;
$$;

revoke all on function public.select_plan_place(uuid, text, text) from public, anon;
grant execute on function public.select_plan_place(uuid, text, text) to authenticated, service_role;
