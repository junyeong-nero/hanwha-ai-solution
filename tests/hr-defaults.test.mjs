import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { loadApp } from './helpers/app-context.mjs';

const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const migration = readFileSync(new URL('../supabase/migrations/0020_hr_default_meetings.sql', import.meta.url), 'utf8');

test('로컬 초기 모임·프로필과 신규 입장 프로필은 인재경영원으로 시작한다', () => {
  const app = loadApp({ files: ['config.js'] });
  assert.equal(app.evaluate('JSON.stringify(MEETINGS.map(m=>[m.id,m.region]))'), JSON.stringify([['m7', '인재경영원']]));
  assert.equal(app.evaluate('JSON.stringify(S.profile.regions)'), JSON.stringify(['인재경영원']));
  const login = readFileSync(new URL('../supabase/functions/demo-login/index.ts', import.meta.url), 'utf8');
  assert.match(login, /region: '인재경영원',\s+regions: \['인재경영원'\]/);
});

test('기존 시드만 추천에서 제외하고 사용자 데이터 보존·신규 기본값·재실행을 검증한다', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create table meetings(id uuid primary key, emoji text, title text, tags text[], region text,
        when_label text, capacity int, created_by uuid, status text default 'open');
      create table profiles(user_id uuid primary key, region text, regions text[] default '{}');
      create table meeting_members(meeting_id uuid references meetings(id), user_id uuid);
      insert into profiles values ('${uid(100)}','판교',array['판교','여의도']);
      insert into meetings(id, title) select ('00000000-0000-4000-8000-00000000000' || n)::uuid, '이전 시드' from generate_series(1,6) n;
      update meetings set status='completed' where id='${uid(5)}';
      update meetings set created_by='${uid(100)}' where id='${uid(6)}';
      insert into meetings(id,title,region,created_by) values ('${uid(8)}','사용자 모임','판교','${uid(100)}');
      insert into meeting_members values ('${uid(1)}','${uid(100)}');
    `);
    await db.exec(migration);
    await db.exec(migration);
    const rows = (await db.query('select id,status from meetings order by id')).rows;
    assert.deepEqual(rows.map(r => r.status), ['cancelled','cancelled','cancelled','cancelled','completed','open','open','open']);
    assert.equal((await db.query('select * from meeting_members')).rows.length, 1);
    assert.deepEqual((await db.query('select regions from profiles')).rows[0].regions, ['판교','여의도']);
    await db.exec(`insert into profiles(user_id) values ('${uid(101)}')`);
    const fresh = (await db.query('select region,regions from profiles where user_id=$1', [uid(101)])).rows[0];
    assert.deepEqual(fresh, {region:'인재경영원',regions:['인재경영원']});
    assert.equal((await db.query('select region from meetings where id=$1', [uid(7)])).rows[0].region, '인재경영원');
  } finally {
    await db.close();
  }
});
