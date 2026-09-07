import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const sql=file=>readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('참가·탈퇴는 익명 메시지로 전달되고 읽음 갱신·중복 참가·모임 삭제는 알림을 늘리지 않는다',async()=>{
  const db=new PGlite(),a=uid(1),b=uid(2),m=uid(10);
  try{
    await db.exec(`
      create role anon;create role authenticated;create role service_role;create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create table meetings(id uuid primary key,title text,emoji text,status text);
      create table meeting_members(meeting_id uuid references meetings on delete cascade,user_id uuid,
        joined_at timestamptz default now(),primary key(meeting_id,user_id));
      create table messages(id uuid default gen_random_uuid(),meeting_id uuid references meetings on delete cascade,
        sender_id uuid,body text,created_at timestamptz default now());
      create table meeting_attendance(meeting_id uuid,user_id uuid,attended_at timestamptz);
      grant usage on schema public,auth to authenticated;
      grant select on messages,meeting_members to authenticated;
      alter table messages enable row level security;
    `);
    // 배포에 쓰이는 실제 조회 정책과 읽음 RPC를 적용한다.
    const security=sql('0011_meeting_security_followup.sql');
    await db.exec(security.slice(security.indexOf('create policy "참가 모임 메시지 조회"'),security.indexOf('drop policy if exists "참가 모임 약속 조회"')));
    await db.exec(sql('0012_room_unread.sql'));
    await db.exec(sql('0022_room_member_notifications.sql'));
    await db.exec(`insert into meetings values('${m}','테스트','달','open');
      insert into meeting_members(meeting_id,user_id) values('${m}','${a}');`);
    await db.exec(`insert into meeting_members(meeting_id,user_id) values('${m}','${b}')`);
    const messages=async()=> (await db.query('select * from messages order by created_at')).rows;
    assert.equal((await messages()).length,2);
    assert.equal((await messages())[1].body,'새 멤버가 참가했어요');
    assert.ok((await messages()).every(row=>row.sender_id===null));
    await db.exec(`insert into meeting_members(meeting_id,user_id) values('${m}','${b}') on conflict do nothing`);
    await db.exec(`select set_config('test.uid','${a}',false);set role authenticated;`);
    const visible=(await db.query('select * from messages')).rows;
    assert.equal(visible.length,2);
    assert.equal((await db.query('select unread_count from room_summaries()')).rows[0].unread_count,0);
    await db.query('select mark_room_read($1,$2)',[m,visible[1].id]);
    await db.exec(`reset role;delete from meeting_members where user_id='${b}'`);
    assert.equal((await messages()).length,3);
    assert.equal((await messages())[2].body,'멤버가 모임을 나갔어요');
    await db.exec(`select set_config('test.uid','${b}',false);set role authenticated;`);
    assert.equal((await db.query('select * from messages')).rows.length,0,'탈퇴자는 알림을 읽을 수 없다');
    await db.exec(`reset role;delete from meeting_members where user_id='${a}'`);
    assert.equal((await messages()).length,3,'마지막 탈퇴는 알림 생략');
    await db.exec(`insert into meeting_members(meeting_id,user_id) values('${m}','${a}');delete from meetings where id='${m}'`);
    assert.equal((await messages()).length,0,'연쇄 삭제가 실패하거나 메시지를 남기지 않는다');
  }finally{await db.close()}
});
