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
  FALLBACK_REASON,
  FALLBACK_REASON_SAME_GENDER,
} from '../supabase/functions/_shared/recommendation.ts';
import { anonymizeMessages, buildPlanPrompt, parsePlan, fallbackPlan } from '../supabase/functions/_shared/chat.ts';
import { searchPlaces, KAKAO_ENDPOINT } from '../supabase/functions/_shared/search.ts';

const html = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/0001_initial.sql', import.meta.url), 'utf8');
const migration0004 = fs.readFileSync(new URL('../supabase/migrations/0004_votes_attendance_regions.sql', import.meta.url), 'utf8');
const migration0006Path = new URL('../supabase/migrations/0006_seed_companies.sql', import.meta.url);
const migration0006 = fs.existsSync(migration0006Path) ? fs.readFileSync(migration0006Path, 'utf8') : '';
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

test('시드는 기존 핵심 계열사와 안정적인 UUID의 모임 7개를 넣는다', () => {
  for (const id of ['aero', 'sol', 'life', 'inv', 'sys', 'ocean', 'hotel', 'gal']) {
    assert.ok(seed.includes(`('${id}',`), `계열사 ${id} 시드가 없습니다`);
  }
  for (let n = 1; n <= 7; n++) {
    assert.ok(seed.includes(`00000000-0000-4000-8000-00000000000${n}`), `모임 ${n} 시드가 없습니다`);
  }
  assert.ok(seed.includes('on conflict'), '시드는 재실행 가능해야 합니다');
  assert.doesNotMatch(seed, /sk-or-v1-[A-Za-z0-9]/);
});

test('시드: 인재경영원 모임 7이 안정적인 UUID로 들어간다', () => {
  const line = seed.split('\n').find((l) => l.includes('00000000-0000-4000-8000-000000000007'));
  assert.ok(line, '모임 7 시드가 없습니다');
  assert.ok(line.includes('인재경영원'), '모임 7의 지역이 인재경영원이 아닙니다');
  assert.ok(line.includes('🌿') && line.includes('산책') && line.includes('러닝'));
});

/* ================= 0004: 투표 · 체크인 · 다중 지역 ================= */

test('0004 마이그레이션: 투표·체크인 테이블과 트리거·RPC 를 정의한다', () => {
  assert.match(migration0004, /create table if not exists public\.meeting_plan_votes\s*\(/);
  assert.match(migration0004, /create table if not exists public\.meeting_attendance\s*\(/);
  assert.match(migration0004, /create or replace function public\.attend_meeting_tx\(p_meeting_id uuid\)/);
  assert.match(migration0004, /create or replace function public\.confirm_plan_when_unanimous\(\)/);
  assert.match(migration0004, /after insert on public\.meeting_plan_votes/);
  assert.ok(migration0004.includes("raise exception '모임 멤버가 아닙니다' using errcode = '42501'"));
});

test('0004 마이그레이션: Realtime publication 에 투표·체크인 테이블을 등록한다', () => {
  assert.ok(migration0004.includes('alter publication supabase_realtime add table public.meeting_plan_votes, public.meeting_attendance;'));
});

test('0004 마이그레이션: profiles.regions 와 meeting_plans.candidates 컬럼을 추가한다', () => {
  assert.ok(migration0004.includes('regions text[]'));
  assert.ok(migration0004.includes('candidates jsonb'));
  assert.match(migration0004, /update public\.profiles set regions = array\[region\]/);
});

test('0004 마이그레이션: complete_meeting_tx 를 지우고 room_members 는 연결된 상대에게만 실명을 보여준다', () => {
  assert.ok(migration0004.includes('drop function if exists public.complete_meeting_tx'));
  assert.match(migration0004, /create or replace function public\.room_members\(p_meeting_id uuid\)/);
  assert.ok(!migration0004.includes("m.status = 'completed'"), 'room_members 에 모임 완료 조건이 남아 있습니다');
});

test('0004 마이그레이션: 체크인은 브라우저가 직접 등록할 수 없고 RPC 권한은 로그인 사용자만', () => {
  assert.ok(migration0004.includes('revoke insert, update, delete on table public.meeting_attendance from anon, authenticated'));
  assert.ok(migration0004.includes('grant execute on function public.attend_meeting_tx(uuid) to authenticated, service_role'));
  assert.ok(migration0004.includes('revoke all on function public.attend_meeting_tx(uuid) from public, anon'));
  assert.match(migration0004, /create policy "참가 모임 투표 본인 등록"/);
  assert.match(migration0004, /create policy "참가 모임 체크인 조회"/);
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

// 서버가 선호 지역으로 이미 거른 후보라는 전제. same_gender_ratio 는 다른 멤버 중 같은 성별 비율(모르면 null).
const CANDIDATES = [
  { id: '00000000-0000-4000-8000-000000000001', title: '러닝', emoji: '🏃', region: '판교', when_label: '평일 저녁', capacity: 6, tags: ['러닝'], member_count: 3, known_count: 0, joined: false, same_gender_ratio: 0.5 },
  { id: '00000000-0000-4000-8000-000000000002', title: '위스키', emoji: '🥃', region: '판교', when_label: '금요일 저녁', capacity: 5, tags: ['위스키'], member_count: 4, known_count: 2, joined: false, same_gender_ratio: null },
  { id: '00000000-0000-4000-8000-000000000003', title: '엑셀', emoji: '📊', region: '여의도', when_label: '수요일 점심', capacity: 6, tags: ['자동화'], member_count: 4, known_count: 4, joined: true, same_gender_ratio: 1 },
];
const CANDIDATE_IDS = CANDIDATES.map((c) => c.id);

const PROFILE = {
  company_id: 'inv', regions: ['판교', '여의도'], age_band: '20대 후반', gender: '여',
  interests: ['러닝'], hobbies: ['위스키'], group_size: [4, 6],
  matching_preferences: { same_gender: false, scope: 'all', direction: 'wide' },
};

test('ageBand: 나이를 연령대 문자열로 바꾼다', () => {
  assert.equal(ageBand(27), '20대 후반');
  assert.equal(ageBand(31), '30대 초반');
  assert.equal(ageBand(45), '40대 중반');
  assert.equal(ageBand(null), '비공개');
});

test('buildRecommendationPrompt: 실명·사번이 섞여 들어와도 프롬프트에 남지 않는다', () => {
  const dirtyProfile = {
    ...PROFILE,
    real_name: '홍길동', employee_no: 'EMP-991', user_id: '11111111-2222-4333-8444-555555555555',
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

test('buildRecommendationPrompt: 선호 지역 목록·같은 성별 우선·같은 성별 비율을 프롬프트에 넣는다', () => {
  const { system, user } = buildRecommendationPrompt(
    { ...PROFILE, matching_preferences: { same_gender: true, scope: 'mine', direction: 'deep' } },
    CANDIDATES,
  );
  assert.ok(system.includes('선호 지역') && system.includes('같은 성별'), '시스템 지시에 선호 지역·같은 성별 언급이 없습니다');
  const parsed = JSON.parse(user);
  assert.deepEqual(parsed.profile.regions, ['판교', '여의도']);
  assert.deepEqual(parsed.preferred_regions, ['판교', '여의도']);
  assert.equal(parsed.profile.gender, '여');
  assert.equal(parsed.profile.matching_preferences.same_gender, true);
  assert.equal(parsed.same_gender_first, true);
  assert.ok(user.includes('선호 지역') && user.includes('여의도'));
  // 후보의 same_gender_ratio 는 백분율 또는 '정보 없음'
  const byId = Object.fromEntries(parsed.candidates.map((c) => [c.id, c.same_gender_ratio]));
  assert.equal(byId[CANDIDATE_IDS[0]], '50%');
  assert.equal(byId[CANDIDATE_IDS[1]], '정보 없음');
  assert.equal(byId[CANDIDATE_IDS[2]], '100%');
});

test('buildRecommendationPrompt: regions 가 없으면 단일 region 으로 대체하고 balance 는 넣지 않는다', () => {
  const legacy = { ...PROFILE, regions: undefined, region: '장교', matching_preferences: { balance: true, scope: 'all', direction: 'wide' } };
  const { user } = buildRecommendationPrompt(legacy, CANDIDATES);
  const parsed = JSON.parse(user);
  assert.deepEqual(parsed.profile.regions, ['장교']);
  assert.equal(parsed.profile.matching_preferences.same_gender, false);
  assert.equal('balance' in parsed.profile.matching_preferences, false);
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

test('deterministicOrder: 지역은 정렬에 쓰지 않고 direction에 따라 아는 얼굴 비율로 정렬한다', () => {
  const profile = { regions: ['판교'], matching_preferences: { same_gender: false, scope: 'all', direction: 'wide' } };
  const wide = deterministicOrder(CANDIDATES, profile);
  assert.deepEqual(wide.map((r) => r.meeting_id), [CANDIDATE_IDS[0], CANDIDATE_IDS[1], CANDIDATE_IDS[2]]);
  assert.deepEqual(wide.map((r) => r.rank), [1, 2, 3]);
  assert.equal(wide[0].reason, FALLBACK_REASON);
  assert.deepEqual(wide[0].cautions, []);

  // deep 이면 아는 얼굴 비율 내림차순 — 여의도 모임(3)도 선호 지역과 무관하게 맨 앞
  const deep = deterministicOrder(CANDIDATES, { ...profile, matching_preferences: { direction: 'deep' } });
  assert.deepEqual(deep.map((r) => r.meeting_id), [CANDIDATE_IDS[2], CANDIDATE_IDS[1], CANDIDATE_IDS[0]]);
});

test('deterministicOrder: same_gender=true 면 같은 성별 비율 내림차순, null 은 맨 뒤', () => {
  const profile = { matching_preferences: { same_gender: true, scope: 'all', direction: 'wide' } };
  const out = deterministicOrder(CANDIDATES, profile);
  assert.deepEqual(out.map((r) => r.meeting_id), [CANDIDATE_IDS[2], CANDIDATE_IDS[0], CANDIDATE_IDS[1]]);
  assert.equal(out[0].reason, FALLBACK_REASON_SAME_GENDER);

  // 같은 비율끼리는 아는 얼굴 비율(direction)로 가른다
  const tied = [
    { id: 'b', member_count: 2, known_count: 2, same_gender_ratio: 1 },
    { id: 'a', member_count: 2, known_count: 0, same_gender_ratio: 1 },
    { id: 'c', member_count: 2, known_count: 1, same_gender_ratio: null },
  ];
  const wide = deterministicOrder(tied, profile);
  assert.deepEqual(wide.map((r) => r.meeting_id), ['a', 'b', 'c']);
  const deep = deterministicOrder(tied, { matching_preferences: { same_gender: true, direction: 'deep' } });
  assert.deepEqual(deep.map((r) => r.meeting_id), ['b', 'a', 'c']);
});

test('deterministicOrder: same_gender=false 면 같은 성별 비율을 무시한다', () => {
  const list = [
    { id: 'x', member_count: 4, known_count: 4, same_gender_ratio: 0 },
    { id: 'y', member_count: 4, known_count: 0, same_gender_ratio: 1 },
  ];
  const wide = deterministicOrder(list, { matching_preferences: { same_gender: false, direction: 'wide' } });
  assert.deepEqual(wide.map((r) => r.meeting_id), ['y', 'x']);
  assert.equal(wide[0].reason, FALLBACK_REASON);
  const deep = deterministicOrder(list, { matching_preferences: { direction: 'deep' } });
  assert.deepEqual(deep.map((r) => r.meeting_id), ['x', 'y']);
});

/* ================= chat.ts ================= */

const SENDERS = ['aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002'];
const makeMessages = (n) => Array.from({ length: n }, (_, i) => ({
  sender_id: SENDERS[i % 2],
  body: `메시지 ${i}`,
  created_at: new Date(Date.UTC(2026, 8, 2, 10, 0, i)).toISOString(),
}));

const PLACES = [
  { name: '판교역 스타벅스', address: '경기 성남시 분당구 판교역로 4', url: 'https://place.map.kakao.com/1', category: '카페' },
  { name: '화랑공원', address: '경기 성남시 분당구 삼평동', url: 'https://place.map.kakao.com/2', category: '공원' },
  { name: '탄천 산책로', address: '경기 성남시 분당구', url: '', category: '' },
];

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
  assert.ok(system.includes('candidates'), '후보지 없이도 candidates 를 선택 사항으로 허용해야 합니다');
  assert.ok(!user.includes('"places"'));
});

test('buildPlanPrompt: 검색된 후보지가 있으면 목록을 넣고 그 안에서 고르게 한다', () => {
  const meeting = { title: '러닝', region: '판교', tags: ['러닝'], when_label: '평일 저녁' };
  const { system, user } = buildPlanPrompt(meeting, [], PLACES);
  assert.ok(system.includes('places') && system.includes('candidates'));
  assert.match(system, /2~5/);
  const parsed = JSON.parse(user);
  assert.equal(parsed.places.length, 3);
  assert.equal(parsed.places[0].name, '판교역 스타벅스');
  assert.equal(parsed.places[0].url, 'https://place.map.kakao.com/1');
  assert.equal(parsed.places[0].category, '카페');
  assert.equal(parsed.places[2].url, undefined);
});

test('parsePlan: 필수 필드가 빠지면 INVALID_LLM_OUTPUT', () => {
  assert.throws(() => parsePlan('{"place":"판교역","time":"목요일 19시","nearby":[]}'), /INVALID_LLM_OUTPUT/);
  assert.throws(() => parsePlan('{"place":"판교역","time":"목요일 19시","activity":"러닝"}'), /INVALID_LLM_OUTPUT/);
  assert.throws(() => parsePlan('그냥 텍스트'), /INVALID_LLM_OUTPUT/);
  const plan = parsePlan('```json\n{"place":"판교역 2번 출구","time":"목요일 19:30","activity":"3km 러닝","nearby":["곰탕집", 3, "카페"]}\n```');
  assert.deepEqual(plan, { place: '판교역 2번 출구', time: '목요일 19:30', activity: '3km 러닝', nearby: ['곰탕집', '카페'], candidates: [] });
});

test('parsePlan: candidates 는 이름 없는 항목을 버리고 최대 5개만 남긴다', () => {
  const candidates = [
    { address: '이름 없음', url: 'https://x', why: '버려야 해요' },
    { name: '후보 1', address: '주소 1', url: 'https://1', why: '가까워요' },
    { name: '후보 2', why: '넓어요' },
    { name: '후보 3' },
    { name: '후보 4', address: '주소 4', url: 'https://4', why: '조용해요' },
    { name: '후보 5', address: '주소 5', url: 'https://5', why: '싸요' },
    { name: '후보 6', address: '주소 6', url: 'https://6', why: '잘려야 해요' },
    'not-an-object',
  ];
  const plan = parsePlan(JSON.stringify({ place: '후보 1', time: '금요일 18시', activity: '산책', nearby: [], candidates }));
  assert.equal(plan.candidates.length, 5);
  assert.deepEqual(plan.candidates.map((c) => c.name), ['후보 1', '후보 2', '후보 3', '후보 4', '후보 5']);
  assert.deepEqual(plan.candidates[0], { name: '후보 1', address: '주소 1', url: 'https://1', why: '가까워요' });
  assert.deepEqual(plan.candidates[2], { name: '후보 3', address: '', url: '', why: '' });
});

test('fallbackPlan: 다섯 필드를 모두 채우고 후보지가 없으면 candidates 는 빈 배열', () => {
  const plan = fallbackPlan({ title: '러닝', region: '판교', tags: ['러닝', '운동'], when_label: '평일 저녁' });
  assert.deepEqual(Object.keys(plan).sort(), ['activity', 'candidates', 'nearby', 'place', 'time']);
  assert.ok(plan.place.includes('판교'));
  assert.equal(plan.time, '평일 저녁');
  assert.ok(plan.activity.includes('러닝'));
  assert.ok(Array.isArray(plan.nearby) && plan.nearby.length >= 2);
  assert.deepEqual(plan.candidates, []);
});

test('fallbackPlan: 검색된 후보지가 있으면 첫 장소를 만남 장소로 쓴다', () => {
  const plan = fallbackPlan({ title: '러닝', region: '판교', tags: ['러닝'], when_label: '평일 저녁' }, PLACES);
  assert.equal(plan.place, '판교역 스타벅스');
  assert.equal(plan.time, '평일 저녁');
  assert.equal(plan.candidates.length, 3);
  assert.deepEqual(plan.candidates[0], { name: '판교역 스타벅스', address: '경기 성남시 분당구 판교역로 4', url: 'https://place.map.kakao.com/1', why: '검색된 후보지예요' });
  assert.ok(plan.nearby.includes('화랑공원'));
  const many = fallbackPlan({ title: 'x', region: '판교', tags: [], when_label: '' }, Array.from({ length: 8 }, (_, i) => ({ name: `장소 ${i}`, address: '', url: '', category: '' })));
  assert.equal(many.candidates.length, 5);
});

/* ================= search.ts ================= */

const KAKAO_DOCS = [
  { place_name: '판교역 스타벅스', road_address_name: '경기 성남시 분당구 판교역로 4', address_name: '경기 성남시 분당구 백현동 1', place_url: 'https://place.map.kakao.com/1', category_group_name: '카페', category_name: '음식점 > 카페 > 커피전문점' },
  { place_name: '화랑공원', road_address_name: '', address_name: '경기 성남시 분당구 삼평동', place_url: 'https://place.map.kakao.com/2', category_group_name: '', category_name: '여행 > 공원' },
  { place_name: '', place_url: 'https://place.map.kakao.com/3' },
];

test('searchPlaces: Kakao 키가 있으면 키워드 검색 결과를 후보지로 바꾼다', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ documents: KAKAO_DOCS }), { status: 200 });
  };
  const out = await searchPlaces({ region: '판교', keywords: ['러닝', '운동'], kakaoKey: 'test-kakao', openRouterKey: 'test-or', fetchImpl });
  assert.equal(out.provider, 'kakao');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith(KAKAO_ENDPOINT));
  assert.ok(calls[0].url.includes(`query=${encodeURIComponent('판교 러닝')}`));
  assert.ok(calls[0].url.includes('size=5'));
  assert.equal(calls[0].init.headers.Authorization, 'KakaoAK test-kakao');
  assert.deepEqual(out.places, [
    { name: '판교역 스타벅스', address: '경기 성남시 분당구 판교역로 4', url: 'https://place.map.kakao.com/1', category: '카페' },
    { name: '화랑공원', address: '경기 성남시 분당구 삼평동', url: 'https://place.map.kakao.com/2', category: '여행 > 공원' },
  ]);
});

test('searchPlaces: Kakao 첫 키워드 결과가 없으면 다음 키워드로 한 번 더 (최대 2회)', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const documents = calls.length === 1 ? [] : KAKAO_DOCS.slice(0, 1);
    return new Response(JSON.stringify({ documents }), { status: 200 });
  };
  const out = await searchPlaces({ region: '판교', keywords: ['없는키워드', '카페', '세번째'], kakaoKey: 'k', fetchImpl, limit: 3 });
  assert.equal(out.provider, 'kakao');
  assert.equal(calls.length, 2);
  assert.ok(calls[1].includes(`query=${encodeURIComponent('판교 카페')}`));
  assert.ok(calls[1].includes('size=3'));
  assert.equal(out.places.length, 1);
});

test('searchPlaces: OpenRouter 웹 플러그인 경로는 plugins 를 보내고 JSON places 를 읽는다', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const message = {
      content: '검색 결과예요.\n```json\n{"places":[{"name":"판교역 스타벅스","address":"판교역로 4","category":"카페"},{"name":"화랑공원","address":"삼평동","url":"https://park.example/2","category":"공원"},{"address":"이름 없음"}]}\n```',
      annotations: [
        { type: 'url_citation', url_citation: { url: 'https://cafe.example/1', title: '판교역 스타벅스 매장 안내' } },
      ],
    };
    return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
  };
  const out = await searchPlaces({ region: '판교', keywords: ['러닝'], openRouterKey: 'test-or', model: 'test/model', fetchImpl });
  assert.equal(out.provider, 'openrouter');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-or');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'test/model');
  assert.deepEqual(body.plugins, [{ id: 'web', max_results: 5 }]);
  assert.equal(body.temperature, 0.2);
  assert.ok(body.messages.some((m) => m.content.includes('판교') && m.content.includes('러닝')));
  assert.deepEqual(out.places, [
    { name: '판교역 스타벅스', address: '판교역로 4', url: 'https://cafe.example/1', category: '카페' },
    { name: '화랑공원', address: '삼평동', url: 'https://park.example/2', category: '공원' },
  ]);
});

test('searchPlaces: 키가 없으면 요청 없이 provider none', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response('{}', { status: 200 }); };
  const out = await searchPlaces({ region: '판교', keywords: ['러닝'], fetchImpl });
  assert.deepEqual(out, { provider: 'none', places: [] });
  assert.equal(calls, 0);
});

test('searchPlaces: fetch 가 던지거나 오류 응답이어도 provider none 으로 끝난다', async () => {
  const throwing = async () => { throw new Error('network down'); };
  assert.deepEqual(await searchPlaces({ region: '판교', keywords: ['러닝'], kakaoKey: 'k', fetchImpl: throwing }), { provider: 'none', places: [] });
  assert.deepEqual(await searchPlaces({ region: '판교', keywords: ['러닝'], openRouterKey: 'o', fetchImpl: throwing }), { provider: 'none', places: [] });

  const failing = async () => new Response('{"error":"quota"}', { status: 429 });
  assert.deepEqual(await searchPlaces({ region: '판교', keywords: ['러닝'], kakaoKey: 'k', fetchImpl: failing }), { provider: 'none', places: [] });

  const hanging = () => new Promise(() => {});
  assert.deepEqual(await searchPlaces({ region: '판교', keywords: ['러닝'], kakaoKey: 'k', fetchImpl: hanging, timeoutMs: 50 }), { provider: 'none', places: [] });
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

test('chatJson: 400이면 response_format·system 없이 호환 모드로 1회 재시도한다', async () => {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    if (calls.length === 1) return new Response('{"error":"response_format not supported"}', { status: 400 });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
  };
  const content = await chatJson({ apiKey: 'k', model: 'm', system: '시스템 지시', user: '사용자 입력', fetchImpl });
  assert.equal(content, '{"ok":true}');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].response_format, { type: 'json_object' });
  assert.equal(calls[1].response_format, undefined);
  assert.deepEqual(calls[1].messages.map((m) => m.role), ['user']);
  assert.ok(calls[1].messages[0].content.includes('시스템 지시') && calls[1].messages[0].content.includes('사용자 입력'));
});

test('chatJson: 400이 두 번이면 HTTP LlmError (그 이상 재시도하지 않음)', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response('{}', { status: 400 }); };
  await assert.rejects(
    chatJson({ apiKey: 'k', model: 'm', system: 's', user: 'u', fetchImpl }),
    (err) => err instanceof LlmError && err.code === 'HTTP' && err.status === 400,
  );
  assert.equal(calls, 2);
});

test('chatJson: 403 같은 그 외 4xx는 재시도하지 않는다', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response('{}', { status: 403 }); };
  await assert.rejects(
    chatJson({ apiKey: 'k', model: 'm', system: 's', user: 'u', fetchImpl }),
    (err) => err instanceof LlmError && err.code === 'HTTP' && err.status === 403,
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

/* ===== 사번 기반 데모 로그인 helpers ===== */
import {
  normalizeEmployeeNo,
  normalizeName,
  syntheticEmail,
  derivePassword,
} from '../supabase/functions/_shared/auth.ts';

test('normalizeEmployeeNo: 공백 제거·대문자화, 허용 문자 밖이면 null', () => {
  assert.equal(normalizeEmployeeNo(' hw-2024 001 '), 'HW-2024001');
  assert.equal(normalizeEmployeeNo('12345'), '12345');
  assert.equal(normalizeEmployeeNo('사번!'), null);
  assert.equal(normalizeEmployeeNo(''), null);
  assert.equal(normalizeEmployeeNo('A'.repeat(21)), null);
  assert.equal(normalizeEmployeeNo(123), null);
});

test('normalizeName: 앞뒤 공백 제거·내부 공백 축약, 1~10자 밖이면 null', () => {
  assert.equal(normalizeName('  홍  길동 '), '홍 길동');
  assert.equal(normalizeName('김서연'), '김서연');
  assert.equal(normalizeName(''), null);
  assert.equal(normalizeName('가'.repeat(11)), null);
});

test('syntheticEmail: 계열사·사번으로 결정적 소문자 이메일', () => {
  assert.equal(syntheticEmail('inv', 'HW-2024001'), 'inv.hw-2024001@demo.moonlight.local');
  assert.equal(syntheticEmail('INV', 'HW-2024001'), syntheticEmail('inv', 'hw-2024001'));
});

test('derivePassword: 비밀키·이메일에 결정적, 64자 hex, 비밀키가 다르면 다르다', async () => {
  const a = await derivePassword('secret-1', 'inv.1@demo.moonlight.local');
  const b = await derivePassword('secret-1', 'inv.1@demo.moonlight.local');
  const c = await derivePassword('secret-2', 'inv.1@demo.moonlight.local');
  const d = await derivePassword('secret-1', 'inv.2@demo.moonlight.local');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
});

/* ===== 0003: 사용자 생성 모임 ===== */
test('0003 마이그레이션: meetings.created_by 와 직접 만들기 정책', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/0003_user_meetings.sql', import.meta.url), 'utf8');
  assert.match(sql, /add column if not exists created_by uuid references auth\.users\(id\)/);
  assert.match(sql, /create policy "모임 직접 만들기" on public\.meetings/);
  assert.match(sql, /with check \(created_by = auth\.uid\(\)\)/);
});

test('주요 계열사 25곳의 ID·이름·색상·정렬 순서가 세 데이터 소스에서 일치한다', () => {
  const expectedIds = [
    'aero', 'sol', 'life', 'inv', 'sys', 'ocean', 'hotel', 'gal',
    'corp', 'vision', 'semitech', 'momentum', 'robotics', 'energy', 'impact', 'power',
    'total', 'engine', 'advanced', 'yeocheon', 'ins', 'asset', 'savings', 'life-fs', 'connect',
  ];
  const expected = new Set(expectedIds);
  const companyBlock = html.match(/const COMPANIES=\[([\s\S]*?)\];\s*const PEOPLE=/)?.[1] ?? '';
  const htmlRows = [...companyBlock.matchAll(/\{id:'([^']+)',\s*name:'([^']*)',\s*c:'(#[0-9A-Fa-f]{6})'/g)]
    .map(([, id, name, color]) => ({ id, name, color }));
  const sqlRows = (sql) => [...sql.matchAll(/\('([^']+)',\s*'([^']*)',\s*'(#[0-9A-Fa-f]{6})',\s*(\d+)\)/g)]
    .map(([, id, name, color, sort]) => ({ id, name, color, sort: Number(sort) }));
  const seedRows = sqlRows(seed);
  const migrationRows = sqlRows(migration0006);

  assert.equal(htmlRows.length, expectedIds.length);
  assert.deepEqual(new Set(htmlRows.map((row) => row.id)), expected);
  assert.deepEqual(new Set(seedRows.map((row) => row.id)), expected);
  assert.deepEqual(new Set(migrationRows.map((row) => row.id)), expected);

  const htmlById = new Map(htmlRows.map((row) => [row.id, row]));
  const seedById = new Map(seedRows.map((row) => [row.id, row]));
  const migrationById = new Map(migrationRows.map((row) => [row.id, row]));
  for (const id of expectedIds) {
    const htmlRow = htmlById.get(id);
    const seedRow = seedById.get(id);
    const migrationRow = migrationById.get(id);
    assert.deepEqual(
      { name: htmlRow.name, color: htmlRow.color },
      { name: seedRow.name, color: seedRow.color },
      `HTML과 시드의 ${id} 정보가 다릅니다`,
    );
    assert.deepEqual(
      { name: seedRow.name, color: seedRow.color, sort: seedRow.sort },
      { name: migrationRow.name, color: migrationRow.color, sort: migrationRow.sort },
      `시드와 마이그레이션의 ${id} 정보가 다릅니다`,
    );
  }
});

/* ===== 0005: 만남 평가 학습용 DB · 친구 초대 ===== */
test('0005 마이그레이션: meeting_feedback(0.5 단위 별점)·features 트리거·학습 뷰·초대 RPC', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/0005_feedback_invites.sql', import.meta.url), 'utf8');
  assert.match(sql, /create table if not exists public\.meeting_feedback/);
  assert.match(sql, /rating >= 0\.5 and rating <= 5 and rating \* 2 = floor\(rating \* 2\)/);
  assert.match(sql, /features jsonb not null default/);
  assert.match(sql, /create or replace function public\.fill_feedback_features\(\)/);
  assert.match(sql, /create or replace view public\.ai_training_examples/);
  assert.match(sql, /revoke all on public\.ai_training_examples from anon, authenticated/);
  assert.match(sql, /create or replace function public\.invite_to_meeting\(p_meeting_id uuid, p_user_ids uuid\[\]\)/);
  assert.match(sql, /m\.created_by = v_uid/);
  // 실명·사번은 특성 스냅샷에 들어가지 않는다
  assert.doesNotMatch(sql, /real_name|employee_no/);
});
