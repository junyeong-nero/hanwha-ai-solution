import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../supabase/migrations/0011_meeting_security_followup.sql', import.meta.url), 'utf8');
const match = fs.readFileSync(new URL('../src/js/match.js', import.meta.url), 'utf8');

test('이슈 #11 후속: 참가는 원자적 join_meeting RPC로만 수행한다', () => {
  assert.match(match, /sb\.rpc\('join_meeting',\{p_meeting_id:id\}\)/);
  assert.doesNotMatch(match, /from\('meeting_members'\)\.upsert/);
  assert.match(migration, /create or replace function public\.join_meeting\(p_meeting_id uuid\)/);
  assert.match(migration, /from public\.meetings m[\s\S]*for update/);
  assert.match(migration, /if v_status <> 'open'/);
  assert.match(migration, /if v_member_count >= v_capacity/);
  assert.match(migration, /revoke insert on table public\.meeting_members from anon, authenticated/);
  assert.match(migration, /revoke update on table public\.meeting_plans from anon, authenticated/);
  assert.match(migration, /meeting_plans_prevent_unconfirm/);
});

test('이슈 #11 후속: 참가 이전 데이터와 만남 시각 경계를 쓰기·체크인에도 적용한다', () => {
  assert.match(migration, /meeting_plans\.created_at >= mm\.joined_at/);
  assert.match(migration, /meeting_plan_votes\.created_at >= mm\.joined_at/);
  assert.match(migration, /p\.created_at >= mm\.joined_at/);
  assert.match(migration, /\(p\.meet_at is null or p\.meet_at <= now\(\)\)/);
  assert.match(migration, /a\.attended_at >= mm\.joined_at/);
  assert.match(migration, /create or replace function public\.select_plan_place/);
  assert.match(migration, /v_created_at < v_joined_at/);
  assert.match(migration, /messages\.created_at >= mm\.joined_at/);
  assert.match(migration, /perform 1 from public\.meetings where id = p_meeting_id for update/);
  assert.match(migration, /create or replace function public\.confirm_plan_when_unanimous/);
});
