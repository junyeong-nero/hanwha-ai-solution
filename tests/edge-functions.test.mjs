// Edge Function 순수 모듈과 마이그레이션 스키마 검사.
// Node 24의 타입 제거(type stripping)로 `.ts` 모듈을 직접 import한다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { hashCode, evaluateCode, isRateLimited, sessionExpiry, safeEqual } from '../supabase/functions/_shared/auth.ts';
import { corsHeaders, json, preflight, fail } from '../supabase/functions/_shared/cors.ts';
import { chatJson, LlmError } from '../supabase/functions/_shared/llm.ts';
import {
  ageBand,
  buildRecommendationPrompt,
  parseRecommendations,
  deterministicOrder,
} from '../supabase/functions/_shared/recommendation.ts';
import { anonymizeMessages, buildPlanPrompt, parsePlan, fallbackPlan } from '../supabase/functions/_shared/chat.ts';

const migration = fs.readFileSync(new URL('../supabase/migrations/0001_initial.sql', import.meta.url), 'utf8');
const seed = fs.readFileSync(new URL('../supabase/seed.sql', import.meta.url), 'utf8');

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/* ================= 마이그레이션 스키마 ================= */

const TABLES = [
  'companies', 'meetings', 'profiles', 'meeting_members', 'messages', 'meeting_plans',
  'connections', 'albums', 'demo_access_codes', 'demo_sessions', 'demo_entry_attempts', 'ai_recommendation_runs',
];

test('마이그레이션은 12개 테이블을 모두 만든다', () => {
  for (const table of TABLES) {
    assert.match(migration, new RegExp(`create table public\\.${table}\\s*\\(`), `${table} 테이블이 없습니다`);
  }
});

test('모든 테이블에 RLS를 켠다', () => {
  const count = (migration.match(/enable row level security/g) ?? []).length;
  assert.ok(count >= 12, `enable row level security 구문이 ${count}개뿐입니다`);
});

test('Realtime publication에 messages와 meeting_plans를 등록한다', () => {
  assert.ok(migration.includes('alter publication supabase_realtime add table public.messages, public.meeting_plans;'));
});

test('connections는 정렬된 쌍의 유니크·체크 제약을 가진다', () => {
  assert.ok(migration.includes('unique (user_a_id, user_b_id)'));
  assert.ok(migration.includes('check (user_a_id < user_b_id)'));
});

test('RPC 함수 4개를 정의한다', () => {
  for (const fn of ['my_connections', 'room_members', 'room_summaries', 'complete_meeting_tx']) {
    assert.match(migration, new RegExp(`create or replace function public\\.${fn}\\(`), `${fn} 함수가 없습니다`);
  }
});

test('메시지 본문은 500자로 제한한다', () => {
  assert.ok(migration.includes('char_length(body) <= 500'));
});

test('계획에 명시된 RLS 정책 이름을 그대로 쓴다', () => {
  for (const name of ['프로필 본인 조회', '프로필 본인 수정', '참가 모임 메시지 조회']) {
    assert.ok(migration.includes(`create policy "${name}"`), `정책 "${name}"이 없습니다`);
  }
});

test('시드는 계열사 8곳과 안정적인 UUID의 모임 6개를 넣는다', () => {
  for (const id of ['aero', 'sol', 'life', 'inv', 'sys', 'ocean', 'hotel', 'gal']) {
    assert.ok(seed.includes(`('${id}',`), `계열사 ${id} 시드가 없습니다`);
  }
  for (let n = 1; n <= 6; n++) {
    assert.ok(seed.includes(`00000000-0000-4000-8000-00000000000${n}`), `모임 ${n} 시드가 없습니다`);
  }
  assert.ok(seed.includes('on conflict'), '시드는 재실행 가능해야 합니다');
  assert.doesNotMatch(seed, /sk-or-v1-[A-Za-z0-9]/);
});

/* ================= auth.ts ================= */

const NOW = new Date('2026-09-02T12:00:00Z');
const okRow = { active: true, expires_at: '2026-09-03T00:00:00Z', use_count: 3, max_uses: 200 };

test('evaluateCode: 없는 코드는 INVALID_CODE', () => {
  assert.equal(evaluateCode(null, NOW), 'INVALID_CODE');
});

test('evaluateCode: 만료·비활성 코드는 EXPIRED_CODE', () => {
  assert.equal(evaluateCode({ ...okRow, expires_at: '2026-09-01T00:00:00Z' }, NOW), 'EXPIRED_CODE');
  assert.equal(evaluateCode({ ...okRow, active: false }, NOW), 'EXPIRED_CODE');
});

test('evaluateCode: 사용 횟수를 다 쓴 코드는 CODE_EXHAUSTED', () => {
  assert.equal(evaluateCode({ ...okRow, use_count: 200 }, NOW), 'CODE_EXHAUSTED');
});

test('evaluateCode: 정상 코드는 ok', () => {
  assert.equal(evaluateCode(okRow, NOW), 'ok');
});

test('isRateLimited: 10분 안 20회부터 차단하고 오래된 시도는 무시한다', () => {
  const recent = (n) => Array.from({ length: n }, (_, i) => new Date(NOW.getTime() - i * 1000));
  assert.equal(isRateLimited(recent(19), NOW), false);
  assert.equal(isRateLimited(recent(20), NOW), true);
  const old = Array.from({ length: 30 }, (_, i) => new Date(NOW.getTime() - 11 * 60 * 1000 - i * 1000));
  assert.equal(isRateLimited([...old, ...recent(5)], NOW), false);
});

test('hashCode: SHA-256 hex 64자', async () => {
  const hash = await hashCode('123456');
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92');
});

test('sessionExpiry: 기본 12시간 뒤 ISO 문자열', () => {
  assert.equal(sessionExpiry(NOW), '2026-09-03T00:00:00.000Z');
  assert.equal(sessionExpiry(NOW, 1), '2026-09-02T13:00:00.000Z');
});

test('safeEqual: 같은 문자열만 true', async () => {
  assert.equal(await safeEqual('token-a', 'token-a'), true);
  assert.equal(await safeEqual('token-a', 'token-b'), false);
  assert.equal(await safeEqual('', 'x'), false);
});

/* ================= cors.ts ================= */

test('preflight와 json 응답은 CORS 헤더를 포함한다', async () => {
  const pre = preflight();
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /x-demo-reset-token/);
  assert.equal(corsHeaders['Access-Control-Allow-Methods'], 'POST, OPTIONS');

  const res = json({ ok: true }, 201);
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(res.headers.get('Content-Type'), /application\/json/);
  assert.deepEqual(await res.json(), { ok: true });

  const err = fail(403, 'FORBIDDEN', '권한이 없어요');
  assert.equal(err.status, 403);
  assert.deepEqual(await err.json(), { error_code: 'FORBIDDEN', message: '권한이 없어요' });
});

/* ================= recommendation.ts ================= */

const CANDIDATES = [
  { id: '00000000-0000-4000-8000-000000000001', title: '러닝', emoji: '🏃', region: '판교', when_label: '평일 저녁', capacity: 6, tags: ['러닝'], member_count: 3, known_count: 0, joined: false },
  { id: '00000000-0000-4000-8000-000000000002', title: '위스키', emoji: '🥃', region: '판교', when_label: '금요일 저녁', capacity: 5, tags: ['위스키'], member_count: 4, known_count: 2, joined: false },
  { id: '00000000-0000-4000-8000-000000000003', title: '엑셀', emoji: '📊', region: '여의도', when_label: '수요일 점심', capacity: 6, tags: ['자동화'], member_count: 4, known_count: 4, joined: true },
];
const CANDIDATE_IDS = CANDIDATES.map((c) => c.id);

test('ageBand: 나이를 연령대 문자열로 바꾼다', () => {
  assert.equal(ageBand(27), '20대 후반');
  assert.equal(ageBand(31), '30대 초반');
  assert.equal(ageBand(45), '40대 중반');
  assert.equal(ageBand(null), '비공개');
});

test('buildRecommendationPrompt: 실명·사번이 섞여 들어와도 프롬프트에 남지 않는다', () => {
  const dirtyProfile = {
    real_name: '홍길동', employee_no: 'EMP-991', user_id: '11111111-2222-4333-8444-555555555555',
    company_id: 'inv', region: '판교', age_band: '20대 후반', interests: ['러닝'], hobbies: ['위스키'],
    group_size: [4, 6], matching_preferences: { balance: false, scope: 'all', direction: 'wide' },
  };
  const { system, user } = buildRecommendationPrompt(dirtyProfile, CANDIDATES);
  const all = system + '\n' + user;
  for (const banned of ['real_name', 'employee_no', '홍길동', 'EMP-991', '11111111-2222-4333-8444-555555555555']) {
    assert.ok(!all.includes(banned), `프롬프트에 ${banned}이(가) 포함되었습니다`);
  }
  assert.ok(user.includes('판교') && user.includes('러닝'));
  assert.match(system, /JSON/);
  for (const id of CANDIDATE_IDS) assert.ok(user.includes(id));
});

test('parseRecommendations: 후보에 없는 id는 버린다', () => {
  const raw = JSON.stringify({ recommendations: [
    { meeting_id: 'meeting_999', rank: 1, reason: '없는 모임' },
    { meeting_id: CANDIDATE_IDS[0], rank: 2, reason: '러닝 관심사가 겹쳐요' },
  ] });
  const out = parseRecommendations(raw, CANDIDATE_IDS);
  assert.deepEqual(out.map((r) => r.meeting_id), [CANDIDATE_IDS[0]]);
  assert.equal(out[0].rank, 1);
});

test('parseRecommendations: 중복 id는 최상위 순위만 남기고 순위를 다시 매긴다', () => {
  const raw = JSON.stringify({ recommendations: [
    { meeting_id: CANDIDATE_IDS[1], rank: 5, reason: '아는 얼굴이 있어요', cautions: ['정원 임박'] },
    { meeting_id: CANDIDATE_IDS[0], rank: 2, reason: '퇴근 동선이 겹쳐요' },
    { meeting_id: CANDIDATE_IDS[1], rank: 1, reason: '취미 위스키가 겹쳐요' },
    { meeting_id: CANDIDATE_IDS[2], rank: 3, reason: '' },
  ] });
  const out = parseRecommendations(raw, CANDIDATE_IDS);
  assert.deepEqual(out.map((r) => [r.meeting_id, r.rank]), [[CANDIDATE_IDS[1], 1], [CANDIDATE_IDS[0], 2]]);
  assert.equal(out[0].reason, '취미 위스키가 겹쳐요');
  assert.deepEqual(out[0].cautions, []);
  assert.deepEqual(out[1].cautions, []);
});

test('parseRecommendations: 160자를 넘거나 기호뿐인 이유는 버린다', () => {
  const raw = JSON.stringify({ recommendations: [
    { meeting_id: CANDIDATE_IDS[0], rank: 1, reason: '가'.repeat(161) },
    { meeting_id: CANDIDATE_IDS[1], rank: 2, reason: '가'.repeat(160) },
    { meeting_id: CANDIDATE_IDS[2], rank: 3, reason: '...' },
  ] });
  const out = parseRecommendations(raw, CANDIDATE_IDS);
  assert.deepEqual(out.map((r) => r.meeting_id), [CANDIDATE_IDS[1]]);
});

test('parseRecommendations: 코드 펜스로 감싼 JSON도 읽는다', () => {
  const raw = '```json\n' + JSON.stringify({ recommendations: [
    { meeting_id: CANDIDATE_IDS[2], rank: 1, reason: '자동화 관심사가 겹쳐요', cautions: ['이미 참가 중이에요'] },
  ] }) + '\n```';
  const out = parseRecommendations(raw, CANDIDATE_IDS);
  assert.equal(out.length, 1);
  assert.equal(out[0].reason, '자동화 관심사가 겹쳐요');
  assert.deepEqual(out[0].cautions, ['이미 참가 중이에요']);
});

test('parseRecommendations: 잘못된 출력은 INVALID_LLM_OUTPUT', () => {
  assert.throws(() => parseRecommendations('죄송합니다, 추천할 수 없어요', CANDIDATE_IDS), /INVALID_LLM_OUTPUT/);
  assert.throws(() => parseRecommendations('{"recommendations": []}', CANDIDATE_IDS), /INVALID_LLM_OUTPUT/);
  assert.throws(() => parseRecommendations('{"recommendations": [{"meeting_id": "x", "rank": 1, "reason": "y"}]}', CANDIDATE_IDS), /INVALID_LLM_OUTPUT/);
});

test('deterministicOrder: 선호 지역 우선, direction에 따라 아는 얼굴 비율 정렬', () => {
  const profile = { region: '판교', matching_preferences: { balance: false, scope: 'all', direction: 'wide' } };
  const wide = deterministicOrder(CANDIDATES, profile);
  assert.deepEqual(wide.map((r) => r.meeting_id), [CANDIDATE_IDS[0], CANDIDATE_IDS[1], CANDIDATE_IDS[2]]);
  assert.deepEqual(wide.map((r) => r.rank), [1, 2, 3]);
  assert.ok(wide[0].reason.length > 0);
  assert.deepEqual(wide[0].cautions, []);

  const deep = deterministicOrder(CANDIDATES, { ...profile, matching_preferences: { direction: 'deep' } });
  assert.deepEqual(deep.map((r) => r.meeting_id), [CANDIDATE_IDS[1], CANDIDATE_IDS[0], CANDIDATE_IDS[2]]);
});

/* ================= chat.ts ================= */

const SENDERS = ['aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002'];
const makeMessages = (n) => Array.from({ length: n }, (_, i) => ({
  sender_id: SENDERS[i % 2],
  body: `메시지 ${i}`,
  created_at: new Date(Date.UTC(2026, 8, 2, 10, 0, i)).toISOString(),
}));

test('anonymizeMessages: 최신 30개만 시간순으로 남기고 발신자를 참가자N으로 바꾼다', () => {
  const out = anonymizeMessages(makeMessages(40));
  assert.equal(out.length, 30);
  assert.equal(out[0].text, '메시지 10');
  assert.equal(out[29].text, '메시지 39');
  assert.equal(out[0].speaker, '참가자1');
  assert.equal(out[1].speaker, '참가자2');
  assert.equal(out[2].speaker, '참가자1');
  for (const line of out) {
    assert.doesNotMatch(line.speaker, UUID_RE);
    assert.doesNotMatch(line.text, UUID_RE);
  }
});

test('anonymizeMessages: 본문을 300자로 자르고 내림차순 입력도 시간순으로 정렬한다', () => {
  const messages = makeMessages(3).reverse();
  messages[0].body = '가'.repeat(400);
  const out = anonymizeMessages(messages);
  assert.equal(out.length, 3);
  assert.equal(out[2].text.length, 300);
  assert.equal(out[0].text, '메시지 0');
  const short = anonymizeMessages(makeMessages(5), { limit: 2, maxLen: 4 });
  assert.equal(short.length, 2);
  assert.equal(short[0].text, '메시지 ');
});

test('buildPlanPrompt: 프롬프트에 발신자 UUID가 남지 않는다', () => {
  const meeting = { title: '판교 퇴근 후 20분 러닝 크루', region: '판교', tags: ['러닝', '운동'], when_label: '평일 저녁' };
  const { system, user } = buildPlanPrompt(meeting, anonymizeMessages(makeMessages(5)));
  assert.doesNotMatch(user, UUID_RE);
  assert.doesNotMatch(system, UUID_RE);
  assert.ok(!user.includes('employee_no'));
  assert.ok(user.includes('참가자1') && user.includes('판교'));
  assert.match(system, /JSON/);
});

test('parsePlan: 필수 필드가 빠지면 INVALID_LLM_OUTPUT', () => {
  assert.throws(() => parsePlan('{"place":"판교역","time":"목요일 19시","nearby":[]}'), /INVALID_LLM_OUTPUT/);
  assert.throws(() => parsePlan('{"place":"판교역","time":"목요일 19시","activity":"러닝"}'), /INVALID_LLM_OUTPUT/);
  assert.throws(() => parsePlan('그냥 텍스트'), /INVALID_LLM_OUTPUT/);
  const plan = parsePlan('```json\n{"place":"판교역 2번 출구","time":"목요일 19:30","activity":"3km 러닝","nearby":["곰탕집", 3, "카페"]}\n```');
  assert.deepEqual(plan, { place: '판교역 2번 출구', time: '목요일 19:30', activity: '3km 러닝', nearby: ['곰탕집', '카페'] });
});

test('fallbackPlan: 네 필드를 모두 채운다', () => {
  const plan = fallbackPlan({ title: '러닝', region: '판교', tags: ['러닝', '운동'], when_label: '평일 저녁' });
  assert.deepEqual(Object.keys(plan).sort(), ['activity', 'nearby', 'place', 'time']);
  assert.ok(plan.place.includes('판교'));
  assert.equal(plan.time, '평일 저녁');
  assert.ok(plan.activity.includes('러닝'));
  assert.ok(Array.isArray(plan.nearby) && plan.nearby.length >= 2);
});

/* ================= llm.ts ================= */

test('chatJson: 429 뒤 200이면 재시도해서 내용을 돌려준다', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) return new Response('{"error":"rate limited"}', { status: 429 });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"recommendations":[]}' } }] }), { status: 200 });
  };
  const content = await chatJson({ apiKey: 'test-key', model: 'openrouter/free', system: '시스템', user: '사용자', fetchImpl });
  assert.equal(content, '{"recommendations":[]}');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-key');
  assert.equal(calls[0].init.headers['X-Title'], 'MoonLight Hanwha');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'openrouter/free');
  assert.equal(body.temperature, 0.2);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.deepEqual(body.messages.map((m) => m.role), ['system', 'user']);
});

test('chatJson: 응답이 없으면 TIMEOUT LlmError', async () => {
  const fetchImpl = () => new Promise(() => {});
  await assert.rejects(
    chatJson({ apiKey: 'k', model: 'm', system: 's', user: 'u', timeoutMs: 50, fetchImpl }),
    (err) => err instanceof LlmError && err.code === 'TIMEOUT',
  );
});

test('chatJson: 4xx(429 제외)는 재시도하지 않고 HTTP LlmError', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response('{}', { status: 400 }); };
  await assert.rejects(
    chatJson({ apiKey: 'k', model: 'm', system: 's', user: 'u', fetchImpl }),
    (err) => err instanceof LlmError && err.code === 'HTTP' && err.status === 400,
  );
  assert.equal(calls, 1);
});

test('chatJson: 내용이 비어 있으면 EMPTY LlmError', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 });
  await assert.rejects(
    chatJson({ apiKey: 'k', model: 'm', system: 's', user: 'u', fetchImpl }),
    (err) => err instanceof LlmError && err.code === 'EMPTY',
  );
});
