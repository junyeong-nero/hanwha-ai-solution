import assert from 'node:assert/strict';
import test from 'node:test';
import { responsesJson, OPENAI_MODEL, OPENAI_ENDPOINT } from '../supabase/functions/_shared/openai.ts';
import { recommendWithAI } from '../supabase/functions/_shared/ai-matching.ts';
import { suggestWithAI } from '../supabase/functions/_shared/ai-plan.ts';
import { rankByRules } from '../supabase/functions/_shared/recommendation.ts';

const response = (value) => Response.json({ status: 'completed', output: [
  { type: 'reasoning' },
  { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] },
], usage: { input_tokens: 120, output_tokens: 80 } });
const profile = { regions: ['판교'], interests: ['러닝'], hobbies: [], group_size: [3, 6], matching_preferences: { direction: 'wide' } };
const candidate = (id, patch = {}) => ({ id, title: '한강 조깅', region: '판교', tags: ['운동'], capacity: 6, member_count: 3, known_count: 0, joined: false, ...patch });
const candidates = [candidate('a'), candidate('b'), candidate('joined', { joined: true })];
const rows = (ids) => ({ recommendations: ids.map((meeting_id) => ({ meeting_id, reason: '러닝 취미와 잘 맞아요', cautions: [] })) });
const request = { apiKey: 'test-key', system: '지시', user: '입력', name: 'test', schema: { type: 'object' } };

test('Responses 요청: 지정 모델·스키마·비저장과 실제 REST 출력 형태를 사용한다', async () => {
  const out = await responsesJson({ ...request, fetchImpl: async (url, init) => {
    assert.equal(url, OPENAI_ENDPOINT);
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'gpt-5.4-mini');
    assert.equal(body.store, false);
    assert.equal(body.reasoning.effort, 'none');
    assert.equal(body.text.format.strict, true);
    assert.equal(body.text.format.type, 'json_schema');
    assert.equal(init.headers.Authorization, 'Bearer test-key');
    return response({ ok: true });
  } });
  assert.deepEqual(JSON.parse(out.raw), { ok: true });
  assert.equal(out.usage.input_tokens, 120);
});

test('Responses: 헤더 이후 본문이 멈춰도 시간 제한이 적용된다', async () => {
  await assert.rejects(responsesJson({ ...request, timeoutMs: 10,
    fetchImpl: async () => ({ ok: true, json: () => new Promise(() => {}) }),
  }), { code: 'TIMEOUT' });
});

test('Responses: 오류·거절·잘린 출력·잘못된 JSON을 성공으로 취급하지 않는다', async () => {
  const cases = [
    [() => new Response('', { status: 429 }), 'HTTP_429'],
    [() => new Response('', { status: 401 }), 'HTTP_401'],
    [() => Response.json({ status: 'incomplete', output: [] }), 'INCOMPLETE'],
    [() => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }), 'REFUSAL'],
    [() => Response.json({ status: 'completed', output: [] }), 'EMPTY'],
    [() => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{' }] }] }), 'INVALID_LLM_OUTPUT'],
    [() => { throw new Error('네트워크 오류'); }, 'NETWORK_OR_JSON'],
  ];
  for (const [fetchImpl, code] of cases) await assert.rejects(responsesJson({ ...request, fetchImpl }), { code });
});

test('매칭: GPT 순위·이유 반영, 참가 중 모임은 마지막, 민감한 프로필 필드는 제외한다', async () => {
  const out = await recommendWithAI({ profile: { ...profile, real_name: '실명', employee_no: '사번' }, candidates,
    userId: 'match-success', apiKey: 'test', fetchImpl: async (_, init) => {
      const input = JSON.parse(JSON.parse(init.body).input[1].content);
      assert.equal(input.profile.real_name, undefined);
      assert.equal(input.profile.employee_no, undefined);
      assert.equal(input.candidates.length, 2);
      return response(rows(['b', 'a']));
    },
  });
  assert.equal(out.model, OPENAI_MODEL);
  assert.equal(out.fallback, false);
  assert.deepEqual(out.recommendations.map((r) => r.meeting_id), ['b', 'a', 'joined']);
  assert.deepEqual(out.recommendations.map((r) => r.rank), [1, 2, 3]);
  assert.equal(out.recommendations[0].reason, '러닝 취미와 잘 맞아요');
});

test('매칭: 후보 밖 ID·중복·누락·빈 이유는 모두 규칙 추천으로 대체한다', async () => {
  for (const [i, output] of [rows(['x', 'a']), rows(['a', 'a']), rows(['a']), { recommendations: [{ meeting_id: 'a', reason: '', cautions: [] }, rows(['b']).recommendations[0]] }].entries()) {
    const out = await recommendWithAI({ profile, candidates, userId: 'invalid-'+i, apiKey: 'test', fetchImpl: async () => response(output) });
    assert.equal(out.fallback, true);
    assert.equal(out.error_type, 'INVALID_LLM_OUTPUT');
    assert.deepEqual(out.recommendations, rankByRules(profile, candidates));
  }
});

test('매칭: 키 없음·HTTP 오류·타임아웃에서도 전체 후보를 반환한다', async () => {
  for (const [apiKey, fetchImpl, expected] of [
    ['', () => assert.fail('키 없으면 호출 금지'), 'NO_API_KEY'],
    ['test', async () => new Response('', { status: 500 }), 'HTTP_500'],
    ['test', () => new Promise(() => {}), 'TIMEOUT'],
  ]) {
    const out = await recommendWithAI({ profile, candidates, userId: 'failure', apiKey, fetchImpl, timeoutMs: 10 });
    assert.equal(out.error_type, expected);
    assert.equal(out.fallback, true);
    assert.equal(out.recommendations.length, candidates.length);
  }
});

test('매칭 캐시: 같은 입력만 재사용하고 사용자·프로필·후보 변화는 재호출한다', async () => {
  let calls = 0;
  const opts = { profile, candidates, userId: 'cache', apiKey: 'test', fetchImpl: async () => { calls++; return response(rows(['b', 'a'])); } };
  await recommendWithAI(opts);
  assert.equal((await recommendWithAI(opts)).cached, true);
  await recommendWithAI({ ...opts, candidates: [...candidates].reverse() });
  assert.equal(calls, 1);
  await recommendWithAI({ ...opts, profile: { ...profile, interests: ['독서'] } });
  await recommendWithAI({ ...opts, candidates: [candidate('a', { member_count: 4 }), ...candidates.slice(1)] });
  await recommendWithAI({ ...opts, userId: 'cache-other' });
  assert.equal(calls, 4);
});

test('매칭: 상위 20개만 GPT에 전달하고 나머지 후보도 보존한다', async () => {
  const many = Array.from({ length: 25 }, (_, i) => candidate(String(i)));
  const out = await recommendWithAI({ profile, candidates: many, userId: 'bounded', apiKey: 'test', fetchImpl: async (_, init) => {
    const input = JSON.parse(JSON.parse(init.body).input[1].content);
    assert.equal(input.candidates.length, 20);
    return response(rows(input.candidates.map((c) => c.id).reverse()));
  } });
  assert.equal(out.recommendations.length, 25);
  assert.equal(new Set(out.recommendations.map((r) => r.meeting_id)).size, 25);
});

const places = [{ id: '1', name: '판교 카페', address: '판교역로 1', category: '카페', lat: 37.39, lng: 127.11, url: 'https://place.map.kakao.com/1' }];
const planOpts = { meeting: { title: '퇴근 모임', region: '판교', tags: ['커피'], when_label: '금요일 저녁' }, lines: [], places, now: new Date('2026-09-07T10:00:00+09:00'), apiKey: 'test' };
const planOutput = { place: '지어낸 장소', time: '금요일 19시', meet_at: '2026-09-11T19:00:00+09:00', activity: '대화해요', nearby: ['판교 카페', '지어낸 맛집'], candidates: [{ name: '판교 카페', why: '커피를 마셔요' }, { name: '지어낸 장소', why: '만나요' }] };

test('장소: GPT 결과를 실제 후보와 대조하고 주변 장소도 검증한다', async () => {
  const out = await suggestWithAI({ ...planOpts, fetchImpl: async () => response(planOutput) });
  assert.equal(out.fallback, false);
  assert.equal(out.plan.place, places[0].name);
  assert.deepEqual(out.plan.nearby, []);
  assert.equal(out.plan.meet_at, null);
  assert.equal(out.plan.time, '장소 후보');
  assert.equal(out.plan.candidates.length, 1);
  assert.equal(out.plan.candidates[0].id, '1');
  assert.equal(out.plan.candidates[0].lat, 37.39);
  assert.equal(out.plan.candidates[0].verified, true);
});

test('장소: 검색 없음·키 없음·API 실패 시 기본 카드가 유지된다', async () => {
  const noSearch = await suggestWithAI({ ...planOpts, places: [], fetchImpl: () => assert.fail('검색 없는 호출 금지') });
  assert.equal(noSearch.error_type, 'NO_PLACES');
  assert.deepEqual(noSearch.plan.candidates, []);
  const noKey = await suggestWithAI({ ...planOpts, apiKey: '' });
  assert.equal(noKey.error_type, 'NO_API_KEY');
  const broken = await suggestWithAI({ ...planOpts, fetchImpl: async () => response({}) });
  assert.equal(broken.fallback, true);
  assert.equal(broken.plan.place, places[0].name);
  assert.equal(broken.plan.candidates[0].verified, true);
});
