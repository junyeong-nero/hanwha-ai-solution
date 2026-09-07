import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

// 외부 Supabase 없이 실제 PostgreSQL에서 새 마이그레이션과 RPC 권한을 실행한다.
const migration=readFileSync(new URL('../supabase/migrations/0014_meeting_responses.sql',import.meta.url),'utf8');
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const host=uid(1),member=uid(2),outsider=uid(3),meeting=uid(10),plan=uid(20);
async function fixture(){
  const db=new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create table auth.users(id uuid primary key);
    create table meetings(id uuid primary key,created_by uuid,title text);
    create table profiles(user_id uuid primary key,nickname text);
    create table meeting_members(meeting_id uuid,user_id uuid,joined_at timestamptz default now()-interval '1 day',primary key(meeting_id,user_id));
    create table meeting_plan_votes(plan_id uuid,user_id uuid);
    create table meeting_plans(id uuid primary key,meeting_id uuid,created_by uuid,created_at timestamptz default now(),
      confirmed boolean default false,confirmed_at timestamptz,confirm_reason text,place text,time_label text,activity text,
      meet_at timestamptz,selected_place jsonb,candidates jsonb,
      constraint meeting_plans_confirm_reason_check check(confirm_reason in ('vote','due')));
    create table messages(meeting_id uuid,sender_id uuid,body text);
    grant usage on schema public,auth to authenticated,anon;
    grant select on meeting_plans to authenticated;
    insert into auth.users values('${host}'),('${member}'),('${outsider}');
    insert into profiles values('${host}','방장'),('${member}','참여자');
    insert into meetings values('${meeting}','${host}','테스트 모임');
    insert into meeting_members(meeting_id,user_id) values('${meeting}','${host}'),('${meeting}','${member}');
    insert into meeting_plans(id,meeting_id,place,time_label,activity,candidates)
      values('${plan}','${meeting}','카페 A','미정','대화','[{"name":"카페 A"},{"name":"카페 B"}]');
  `);
  await db.exec(readFileSync(new URL('../supabase/migrations/0013_plan_availability.sql',import.meta.url),'utf8'));
  await db.exec(migration);
  await db.exec(readFileSync(new URL('../supabase/migrations/0016_unified_scheduling.sql',import.meta.url),'utf8'));
  const as=async(id,sql,params=[])=>{
    await db.exec('reset role');
    await db.query("select set_config('test.uid',$1,false)",[id]);
    await db.exec('set role authenticated');
    return db.query(sql,params);
  };
  const slots=['2090-01-02T09:00:00Z','2090-01-02T09:30:00Z'];
  // 실행 날짜에 의존하지 않도록 DB 시각에 맞는 미래 후보를 만든다.
  const future=await db.query("select date_trunc('day',now())+interval '3 days 9 hours' as start");
  slots[0]=new Date(future.rows[0].start).toISOString();slots[1]=new Date(Date.parse(slots[0])+1800000).toISOString();
  const deadline=new Date(Date.parse(slots[0])-86400000).toISOString();
  const create=()=>as(host,'select create_meeting_poll($1,$2,$3) id',[plan,deadline,slots]);
  const q=(await create()).rows[0].id;
  return {db,as,q,slots,create};
}

test('인증·참여 권한, 응답 복원·수정, 후보 검증, 방장 확정',async()=>{
  const {db,as,q,slots,create}=await fixture();
  try{
    assert.equal((await create()).rows[0].id,q,'수집 시작을 다시 눌러도 같은 링크');
    await assert.rejects(as(outsider,'select get_meeting_poll($1)',[q]),/참여자/);
    await assert.rejects(as(member,'select * from meeting_responses'),/permission denied/);
    await assert.rejects(as(member,'select finalize_meeting_poll($1,0,$2)',[q,slots[0]]),/방장/);
    await assert.rejects(as(member,'select submit_meeting_response($1,9,$2,\'\')',[q,slots]),/후보/);
    await assert.rejects(as(member,'select submit_meeting_response($1,0,$2,\'\')',[q,['2099-01-01T00:00:00Z']]),/후보/);
    await as(member,'select submit_meeting_response($1,0,$2,\'조용한 곳\')',[q,slots]);
    await as(host,'select submit_meeting_response($1,1,$2,\'식사\')',[q,[slots[0]]]);
    let data=(await as(member,'select get_meeting_poll($1) q',[q])).rows[0].q;
    assert.equal(data.responses.length,1,'참여자는 자기 응답만 조회');
    assert.equal(data.responses[0].comment,'조용한 곳');
    assert.equal(data.members.length,0,'방장용 참여자 현황은 비공개');
    await as(member,'select submit_meeting_response($1,1,$2,\'수정\')',[q,[slots[1]]]);
    data=(await as(host,'select get_meeting_poll($1) q',[q])).rows[0].q;
    assert.equal(data.responses.length,2,'수정은 중복 응답을 만들지 않음');
    assert.equal(data.members.length,2);
    assert.equal(data.responses.find(r=>r.user_id===member).candidate,1);
    // 기존 시간 경과·투표 확정 경로가 UPDATE해도 수집 중인 약속은 확정되지 않는다.
    await db.exec(`reset role;update meeting_plans set confirmed=true,confirm_reason='due' where id='${plan}';`);
    assert.equal((await db.query('select confirmed from meeting_plans')).rows[0].confirmed,false);
    await assert.rejects(db.exec("update meeting_plans set place='다른 곳'"),/의견 비교/);
    await assert.rejects(db.exec("update meeting_plans set meet_at=now()+interval '5 days'"),/의견 비교/);
    const date=new Date(slots[0]).toISOString().slice(0,10);
    await assert.rejects(as(host,'select update_plan_schedule($1,$2,$3)',[plan,'configure',JSON.stringify({start:date,end:date,from:1080,to:1260})]),/의견 비교/);
    await as(host,'select finalize_meeting_poll($1,1,$2)',[q,slots[1]]);
    await assert.rejects(as(host,'select finalize_meeting_poll($1,0,$2)',[q,slots[0]]),/이미 확정/);
    await assert.rejects(as(member,'select submit_meeting_response($1,0,$2,\'\')',[q,slots]),/마감/);
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::int n from messages')).rows[0].n,1);
    const p=(await db.query('select * from meeting_plans')).rows[0];
    assert.equal(p.place,'카페 B');assert.equal(p.confirm_reason,'host');assert.equal(p.confirmed,true);
    await assert.rejects(db.exec("update meeting_plans set place='변경'"),/확정된 약속/);
  }finally{await db.close()}
});

test('마감·탈퇴·재참가·비인증 요청을 서버에서 거부한다',async()=>{
  const {db,as,q,slots}=await fixture();
  try{
    await as(member,'select submit_meeting_response($1,0,$2,\'\')',[q,[]]);
    await db.exec(`reset role;delete from meeting_members where user_id='${member}';`);
    await assert.rejects(as(member,'select get_meeting_poll($1)',[q]),/참여자/);
    const data=(await as(host,'select get_meeting_poll($1) q',[q])).rows[0].q;
    assert.equal(data.responses.length,0,'탈퇴한 사람의 응답은 집계에서 제외');
    assert.equal(data.members.length,1);
    await db.exec(`reset role;insert into meeting_members values('${meeting}','${member}',now()+interval '1 second');`);
    await assert.rejects(as(member,'select submit_meeting_response($1,0,$2,\'\')',[q,slots]),/참여자/);
    await db.exec("reset role;update meeting_polls set deadline=now()-interval '1 minute'");
    await assert.rejects(as(host,'select submit_meeting_response($1,0,$2,\'\')',[q,slots]),/마감/);
    assert.equal((await as(host,'select get_meeting_poll($1) q',[q])).rows[0].q.confirmed,false,'마감은 자동 확정이 아님');
    await db.exec('reset role;set role anon');
    await assert.rejects(db.query('select get_meeting_poll($1)',[q]),/permission denied/);
  }finally{await db.close()}
});

test('생성자 없는 기본 모임은 약속 제안자가 수집·조회·확정을 맡는다',async()=>{
  const {db,as,q,slots,create}=await fixture();
  try{
    await db.exec('reset role');
    await db.query('update meetings set created_by=null where id=$1',[meeting]);
    assert.equal((await create()).rows[0].id,q);
    const data=(await as(host,'select get_meeting_poll($1) q',[q])).rows[0].q;
    assert.equal(data.host,true);assert.equal(data.members.length,2);
    assert.equal((await as(member,'select get_meeting_poll($1) q',[q])).rows[0].q.host,false);
    await assert.rejects(as(member,'select finalize_meeting_poll($1,0,$2)',[q,slots[0]]),/방장/);
    const final=(await as(host,'select finalize_meeting_poll($1,0,$2) p',[q,slots[0]])).rows[0].p;
    assert.equal(final.confirm_reason,'host');assert.equal(final.confirmed,true);
  }finally{await db.close()}
});
