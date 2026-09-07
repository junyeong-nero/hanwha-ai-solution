import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('UX RPC: 탈퇴 멱등성·완료 차단·투표 취소·익명 멤버 관심사',async()=>{
  const db=new PGlite(),u='00000000-0000-4000-8000-000000000001',m='00000000-0000-4000-8000-000000000002',p='00000000-0000-4000-8000-000000000003';
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
      create function auth.uid() returns uuid language sql as $$select '${u}'::uuid$$;
      create table meetings(id uuid);create table meeting_attendance(meeting_id uuid,user_id uuid);
      create table meeting_members(meeting_id uuid,user_id uuid,joined_at timestamptz default now());
      create table meeting_plan_votes(meeting_id uuid,plan_id uuid,user_id uuid);
      create table meeting_plans(id uuid,confirmed boolean,collecting boolean default false);
      create table profiles(user_id uuid,nickname text,avatar text,company_id text,real_name text,interests text[],hobbies text[]);
      create table connections(user_a_id uuid,user_b_id uuid);
      insert into meetings values('${m}');insert into meeting_members(meeting_id,user_id) values('${m}','${u}');
      insert into meeting_plans(id,confirmed) values('${p}',false);
      insert into meeting_plan_votes values('${m}','${p}','${u}');
      insert into profiles values('${u}','닉네임','달','회사','실명',array['독서'],array['산책']);`);
    await db.exec(readFileSync(new URL('../supabase/migrations/0015_leave_unvote_member_interests.sql',import.meta.url),'utf8'));
    assert.deepEqual((await db.query('select interests from room_members($1)',[m])).rows[0].interests,['독서','산책']);
    assert.equal((await db.query('select withdraw_plan_vote($1) ok',[p])).rows[0].ok,true);
    await db.exec(`update meeting_plans set confirmed=true`);
    await assert.rejects(db.query('select withdraw_plan_vote($1)',[p]),/확정/);
    await db.exec(`insert into meeting_attendance values('${m}','${u}')`);
    await assert.rejects(db.query('select leave_meeting($1)',[m]),/완료/);
    await db.exec('delete from meeting_attendance');
    assert.equal((await db.query('select leave_meeting($1) ok',[m])).rows[0].ok,true);
    assert.equal((await db.query('select leave_meeting($1) ok',[m])).rows[0].ok,false);
    assert.equal((await db.query('select * from room_members($1)',[m])).rows.length,0);
  }finally{await db.close()}
});
