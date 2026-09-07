import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const host=uid(1),member=uid(2),late=uid(3),outsider=uid(4),meeting=uid(10),plan=uid(20);
async function fixture(){
 const db=new PGlite();
 await db.exec(`
  create role anon;create role authenticated;create role service_role;create schema auth;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
  create table auth.users(id uuid primary key);
  create table meetings(id uuid primary key,created_by uuid,title text,status text default 'open');
  create table profiles(user_id uuid primary key,nickname text);
  create table meeting_members(meeting_id uuid,user_id uuid,joined_at timestamptz default now()-interval '1 day',primary key(meeting_id,user_id));
  create table meeting_plan_votes(plan_id uuid,user_id uuid);
  create table meeting_plans(id uuid primary key,meeting_id uuid,created_by uuid,created_at timestamptz default now(),
   confirmed boolean not null default false,confirmed_at timestamptz,confirm_reason text,place text,time_label text,activity text,
   meet_at timestamptz,selected_place jsonb,candidates jsonb,constraint meeting_plans_confirm_reason_check check(confirm_reason in ('vote','due')));
  create table messages(meeting_id uuid,sender_id uuid,body text);
  create table meeting_attendance(meeting_id uuid,user_id uuid,attended_at timestamptz default now(),primary key(meeting_id,user_id));
  create table connections(user_a_id uuid,user_b_id uuid,meeting_id uuid,first_met_at timestamptz,unique(user_a_id,user_b_id));
  create table albums(id uuid default gen_random_uuid(),meeting_id uuid unique);
  grant usage on schema public,auth to authenticated,anon;
  grant select on meeting_plans,meeting_members to authenticated;
  insert into auth.users values('${host}'),('${member}'),('${late}'),('${outsider}');
  insert into profiles values('${host}','방장'),('${member}','참여자');
  insert into meetings(id,created_by,title) values('${meeting}','${host}','장소 추천 모임');
  insert into meeting_members(meeting_id,user_id) values('${meeting}','${host}'),('${meeting}','${member}');
 `);
 for(const file of ['0013_plan_availability.sql','0014_meeting_responses.sql','0016_unified_scheduling.sql','0019_place_recommendations.sql']){
  await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 }
 await db.exec(`alter table meeting_plans enable row level security;
  insert into meeting_plans(id,meeting_id,created_by,place,time_label,activity,candidates)
  values('${plan}','${meeting}','${member}','카페 A','','대화','[{"name":"카페 A"},{"name":"카페 B"}]');`);
 const as=async(id,sql,params=[])=>{
  await db.exec('reset role');await db.query("select set_config('test.uid',$1,false)",[id]);await db.exec('set role authenticated');return db.query(sql,params);
 };
 return {db,as};
}

test('일반 멤버의 추천도 저장되고 시간표·의견 수집·장소 확정·투표는 DB에서 차단한다',async()=>{
 const {db,as}=await fixture();
 try{
  const row=(await as(member,'select * from meeting_plans')).rows[0];assert.equal(row.recommendation_only,true);assert.equal(row.confirmed,false);assert.equal(row.meet_at,null);
  const date=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
  await assert.rejects(as(host,'select update_plan_schedule($1,$2,$3)',[plan,'configure',JSON.stringify({start:date,end:date,from:1080,to:1200})]),/장소 후보/);
  const slot=new Date(date+'T09:00:00Z').toISOString(),deadline=new Date(Date.parse(slot)-86400000).toISOString();
  await assert.rejects(as(host,'select create_meeting_poll($1,$2,$3)',[plan,deadline,[slot]]),/장소 후보/);
  await db.exec('reset role');
  for(const update of ["confirmed=true","meet_at=now()","selected_place='{}'","recommendation_only=false","time_label='내일 7시'","place='카페 B'"]){
   await assert.rejects(db.exec('update meeting_plans set '+update),/장소 후보/);
  }
  await assert.rejects(db.exec(`insert into meeting_plan_votes values('${plan}','${member}')`),/확정 투표/);
  assert.equal((await db.query('select count(*)::int n from meeting_polls')).rows[0].n,0,'실패한 수집은 원자적으로 롤백');
  assert.equal((await db.query('select count(*)::int n from meeting_plan_votes')).rows[0].n,0);
 }finally{await db.close()}
});

test('추천 이유는 참가 시점 이후의 카드만 보이고 비참여자는 읽지 못한다',async()=>{
 const {db,as}=await fixture();
 try{
  assert.equal((await as(member,'select * from meeting_plans')).rows.length,1);
  assert.equal((await as(outsider,'select * from meeting_plans')).rows.length,0);
  await db.exec('reset role');
  await assert.rejects(db.exec(`insert into meeting_plans(id,meeting_id,created_by,place,time_label,activity,candidates)
    values('${uid(21)}','${meeting}','${outsider}','카페','','대화','[]')`),/현재 모임 멤버/);
  await db.exec(`reset role;insert into meeting_members values('${meeting}','${late}',now()+interval '1 second');
   insert into meeting_plans(id,meeting_id,created_by,created_at,context_since,place,time_label,activity,candidates)
    values('${uid(22)}','${meeting}','${member}',now()+interval '2 seconds',now(),'카페','','대화','[]')`);
  assert.equal((await as(late,'select * from meeting_plans')).rows.length,0);
 }finally{await db.close()}
});

test('약속이나 추천 없이 상호 체크인으로만 연결되며 첫 완료 이후 참가자는 제외한다',async()=>{
 const {db,as}=await fixture();
 try{
  await db.exec('delete from meeting_plans');
  await assert.rejects(as(outsider,'select attend_meeting_tx($1)',[meeting]),/모임 멤버/);
  await as(host,'select attend_meeting_tx($1)',[meeting]);
  await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from connections')).rows[0].n,0);
  await db.exec(`insert into meeting_members values('${meeting}','${late}',now()+interval '1 second')`);
  await assert.rejects(as(late,'select attend_meeting_tx($1)',[meeting]),/첫 만남 완료 이후/);
  await as(member,'select attend_meeting_tx($1)',[meeting]);await as(member,'select attend_meeting_tx($1)',[meeting]);
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int n from connections')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from meeting_attendance')).rows[0].n,2);
  assert.equal((await db.query('select count(*)::int n from albums')).rows[0].n,1);
 }finally{await db.close()}
});
