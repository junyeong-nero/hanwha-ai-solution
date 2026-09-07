import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './helpers/app-context.mjs';

test('시간 교집합은 미응답자를 포함한 전체 참여자 기준이며 탈퇴 응답은 제외한다',()=>{
  const app=loadApp({files:['responses.js']});
  app.evaluate(`globalThis.q={members:[{id:'a'},{id:'b'},{id:'c'}],candidates:[{},{}],slots:['2030-01-01T09:00:00Z','2030-01-01T09:30:00Z'],responses:[
    {user_id:'a',candidate:0,slots:['2030-01-01T18:00:00+09:00','2030-01-01T09:30:00Z']},
    {user_id:'b',candidate:1,slots:['2030-01-01T09:00:00Z']},
    {user_id:'left',candidate:0,slots:['2030-01-01T09:00:00Z']}]}`);
  const stats=JSON.parse(app.evaluate('JSON.stringify(pollStats(q))'));
  assert.deepEqual(stats.counts,[1,1]);assert.deepEqual(stats.times,[2,1]);
  assert.deepEqual(stats.missing,[{id:'c'}]);
});
test('후보 시간은 한국 시간의 7일간 30분 단위로 생성한다',()=>{
  const app=loadApp({files:['responses.js']});
  const slots=JSON.parse(app.evaluate(`JSON.stringify(pollSlots('2030-01-01'))`));
  assert.equal(slots.length,56);assert.equal(new Set(slots).size,56);
  assert.equal(slots[0],'2030-01-01T09:00:00.000Z');assert.equal(slots.at(-1),'2030-01-07T12:30:00.000Z');
});
test('의견 수집 중에는 클라이언트 투표·시간 경과로 확정하지 않는다',()=>{
  const app=loadApp({files:['config.js','chat.js']});
  assert.equal(app.evaluate("planDue({collecting:true,meetAt:'2020-01-01'})"),false);
  assert.equal(app.evaluate("planDue({meetAt:'2020-01-01'})"),true);
  assert.equal(app.evaluate("checkPlanDone('m1',{plan:{collecting:true}})"),false);
});
test('후보와 자유 의견은 HTML을 실행하지 않고 텍스트로 렌더링한다',()=>{
  const app=loadApp({files:['config.js','chat.js','responses.js']});
  app.evaluate(`globalThis.ME=null;globalThis.BACKEND=false;
    POLL={title:'<img src=x onerror=alert(1)>',activity:'대화',deadline:'2099-01-01',confirmed:false,host:false,
    responses:[],candidates:[{name:'<script>bad</script>',address:'" onclick="bad'}],slots:[]};
    POLL_DRAFT={candidate:0,slots:[],comment:'</textarea><script>bad</script>'};renderPoll();`);
  const html=app.el('pollview').innerHTML;
  assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>bad'));
});

 test('의견 수집 중에는 기존 가능 시간 입력도 잠긴다',()=>{
  const app=loadApp({files:['config.js','chat.js','availability.js']});
  assert.equal(app.evaluate("availabilityLocked({planId:'p',plan:{collecting:true}},{votes:{}})"),true);
});

test('시간표 축은 날짜·시간 순서로 정렬하며 다른 시간대와 불규칙 슬롯도 배치한다',()=>{
  const app=loadApp({files:['responses.js']});
  const axes=JSON.parse(app.evaluate(`JSON.stringify(pollAxes(['2030-01-02T00:30:00Z','2030-01-01T00:00:00Z','2030-01-02T00:00:00Z']))`));
  assert.deepEqual(axes.days,['2030-01-01','2030-01-02']);assert.deepEqual(axes.times,['09:00','09:30']);
});
test('드래그는 양방향 직사각형 안의 실제 슬롯을 선택하고 빠르게 건너뛴 칸도 포함한다',()=>{
  const app=loadApp({files:['responses.js']});
  app.evaluate("globalThis.slots=pollSlots('2030-01-01')");
  const run=(a,b)=>JSON.parse(app.evaluate(`JSON.stringify(pollRectangle(slots,${a},${b}))`));
  assert.deepEqual(run(0,18),[0,1,2,8,9,10,16,17,18]);
  assert.deepEqual(run(18,0),run(0,18));assert.deepEqual(run(-1,3),[]);
});
