import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { trustedClientIp, loginAttemptKeys } from '../supabase/functions/_shared/login-limit.ts';

test('검증 전 헤더 변경은 같은 버킷이고 신뢰 프록시 오른쪽 주소만 사용한다', async () => {
  const headers = value => new Headers({'x-forwarded-for':value,'cf-connecting-ip':'9.9.9.9'});
  const a = await loginAttemptKeys(headers('1.1.1.1'), 'inv', '1');
  const b = await loginAttemptKeys(headers('2.2.2.2'), 'inv', '1');
  assert.deepEqual(a,b);
  assert.equal(trustedClientIp(headers('spoof, 192.0.2.1'),'1'),'192.0.2.1');
  assert.equal(trustedClientIp(headers('spoof2, 192.0.2.1'),'1'),'192.0.2.1');
  assert.equal(trustedClientIp(headers('spoof, 192.0.2.1, 10.0.0.1'),'2'),'192.0.2.1');
  for(const value of ['', 'garbage', '1.1.1.1,']) assert.equal(trustedClientIp(headers(value),'1'),'unknown');
  assert.equal(trustedClientIp(headers('2001:0db8:0:0:0:0:0:1'),'1'),trustedClientIp(headers('2001:db8::1'),'1'));
  assert.equal((await loginAttemptKeys(headers('192.0.2.1'),'inv','1','1'))[1],(await loginAttemptKeys(headers('192.0.2.2'),'inv','1','1'))[1]);
});

test('20회 경계·IP 및 계정 독립 제한·만료·RPC 접근 권한', async () => {
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table demo_entry_attempts(attempt_key text, attempted_at timestamptz default now());`);
    await db.exec(readFileSync(new URL('../supabase/migrations/0017_login_attempt_limit.sql',import.meta.url),'utf8'));
    const keys=['a'.repeat(64),'b'.repeat(64)], other='c'.repeat(64);
    const consume=async k=>(await db.query('select consume_login_attempt($1) allowed',[k])).rows[0].allowed;
    const results=await Promise.all(Array.from({length:25},()=>consume(keys)));
    assert.equal(results.filter(Boolean).length,20);
    assert.equal(await consume([keys[0],other]),false,'IP가 같으면 계정 변경으로 우회 불가');
    assert.equal(await consume([other,keys[1]]),false,'계정이 같으면 IP 변경으로 우회 불가');
    assert.equal((await db.query('select count(*)::int n from demo_entry_attempts')).rows[0].n,40);
    await db.exec("update demo_entry_attempts set attempted_at=now()-interval '11 minutes'");
    assert.equal(await consume(keys),true);
    await assert.rejects(consume([null,other]),/잘못된/);
    await db.exec('set role anon');await assert.rejects(consume(keys),/permission denied/);
    await db.exec('reset role;set role authenticated');await assert.rejects(consume(keys),/permission denied/);
    await db.exec('reset role;set role service_role');assert.equal(await consume(keys),true);
  } finally { await db.close(); }
});
