import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './helpers/app-context.mjs';

function fixture(backend=false){
  const app=loadApp({files:['config.js','match.js','chat.js','map.js','backend.js','responses.js'],globals:{location:{search:backend?'':'?demo=1'}}});
  app.evaluate(`
    globalThis.toast=()=>{};
    globalThis.storage=new Map();
    globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),key:i=>[...storage.keys()][i],get length(){return storage.size}};
    globalThis.plan={id:'local-flow',place:'카페 A',time_label:'미정',activity:'대화',nearby:['식사'],candidates:[{name:'카페 A'},{name:'카페 B'}],schedule:{revision:3,responses:{}},collecting:true,poll_id:'poll-flow'};
    globalThis.q={id:'poll-flow',meeting_id:'flow',plan_id:plan.id,title:'통합 모임',activity:'대화',meeting:{id:'flow',name:'통합 모임',members:['p1'],tags:['대화'],mine:true},deadline:'2099-01-01',slots:['2099-01-02T09:00:00Z'],candidates:plan.candidates,host:true,confirmed:false,members:[{id:'me',name:'나'}],responses:[],plan};
  `);
  return app;
}

test('데모 의견 방은 일반 URL로 새로고침해도 복원되고 방장 확정까지 이어진다',()=>{
  const app=fixture();
  app.evaluate(`localStorage.setItem('moonlight-poll-broken','{');localStorage.setItem('moonlight-poll-'+q.id,JSON.stringify(q));restorePollRooms();restorePollRooms()`);
  assert.equal(app.evaluate("S.joined.filter(id=>id==='flow').length"),1);
  assert.equal(app.evaluate("S.rooms.flow.msgs.filter(m=>m.f==='ai').length"),1);
  assert.equal(app.evaluate("S.rooms.flow.msgs.find(m=>m.f==='ai').plan.schedule.revision"),3);
  app.evaluate(`q.plan={...plan,confirmed:true,confirm_reason:'host',place:'카페 B',selected_place:plan.candidates[1],meet_at:q.slots[0],time_label:'1/2 18:00'};q.confirmed=true;localStorage.setItem('moonlight-poll-'+q.id,JSON.stringify(q));S.rooms={};S.joined=[];restorePollRooms()`);
  assert.equal(app.evaluate('S.rooms.flow.planned.place'),'카페 B');
  assert.equal(app.evaluate('S.rooms.flow.planned.confirmReason'),'host');
  assert.equal(app.evaluate("S.rooms.flow.msgs.filter(m=>m.confirmOf===plan.id).length"),1);
  assert.equal(app.evaluate("PLACE_SEL[plan.id]"),1);
});

test('수집 시작 전에 저장한 일정이 있어도 확정 정보가 적용되고 늦은 추천이 되돌리지 않는다',()=>{
  const app=fixture();
  app.evaluate(`const r=ensureRoom('flow');applyPlan(r,{...plan,collecting:false});applyPlan(r,{...plan,schedule:null});applyPlan(r,{...plan,confirmed:true,confirm_reason:'host',place:'카페 B',time_label:'확정 시간'});applyPlan(r,{...plan,collecting:false,place:'오래된 추천',schedule:null});`);
  assert.equal(app.evaluate("S.rooms.flow.msgs.find(m=>m.f==='ai').plan.place"),'카페 B');
  assert.equal(app.evaluate('S.rooms.flow.planned.place'),'카페 B');
  app.evaluate("applyPlan(S.rooms.flow,{...plan,confirmed:true,confirm_reason:'host',place:'카페 B',time_label:'확정 시간'})");
  assert.equal(app.evaluate("S.rooms.flow.msgs.filter(m=>m.confirmOf===plan.id).length"),1);
});

test('같은 확정 약속의 최신 장소와 시간이 배너에도 적용된다',()=>{
  const app=fixture();
  app.evaluate(`const r=ensureRoom('flow');applyPlan(r,{...plan,confirmed:true,place:'이전 표시'});applyPlan(r,{...plan,confirmed:true,place:'카페 B',time_label:'최종 시간'});`);
  assert.equal(app.evaluate('S.rooms.flow.planned.place'),'카페 B');
  assert.equal(app.evaluate('S.rooms.flow.planned.when'),'최종 시간');
});

test('의견 화면의 최종 확정 이벤트는 작성 중 의견을 보존하며 중복 처리하지 않는다',()=>{
  const app=fixture();
  app.evaluate(`POLL=q;POLL_DRAFT={candidate:1,slots:[],comment:'작성 중'};renderPoll();syncPollPlan({...plan,confirmed:true,confirm_reason:'host',place:'카페 B',time_label:'확정 시간'});`);
  assert.ok(app.el('pollview').innerHTML.includes('약속이 확정되었어요'));
  assert.ok(app.el('pollview').innerHTML.includes('작성 중'));
  assert.ok(app.el('pollview').innerHTML.includes('disabled'));
  app.evaluate(`syncPollPlan({...plan,confirmed:true,place:'중복 이벤트'});`);
  assert.equal(app.evaluate('POLL.plan.place'),'카페 B');
});

test('의견 구독은 직접 연 링크에서도 재연결 시 확정을 복구하고 닫을 때 해제한다',async()=>{
  const app=fixture(true);
  app.evaluate(`
    globalThis.handlers={};globalThis.removed=0;
    sb={channel:()=>({on(event,filter,callback){handlers.update=callback;handlers.filter=filter;return this},subscribe(callback){handlers.status=callback;return this}}),removeChannel:()=>removed++};
    pollRpc=async()=>({...q,plan:{...plan,confirmed:true,place:'카페 B',time_label:'확정 시간'}});
    POLL=q;startPollSync(q);startPollSync(q);
  `);
  assert.equal(app.evaluate('handlers.filter.filter'),'id=eq.local-flow');
  await app.evaluate("handlers.status('SUBSCRIBED')");
  assert.equal(app.evaluate('POLL.confirmed'),true);
  app.evaluate('resetPoll()');
  assert.equal(app.evaluate('removed'),1);
  assert.equal(app.evaluate('POLL'),null);
  await app.evaluate("handlers.status('SUBSCRIBED')");
  assert.equal(app.evaluate('POLL'),null);
});

test('데모 추천 연타는 하나의 후보 카드만 생성한다',async()=>{
  const app=fixture();
  app.evaluate(`globalThis.timers=[];globalThis.setTimeout=fn=>timers.push(fn);renderMsgs=()=>{};renderBanner=()=>{};CUR='flow';ensureMeeting('flow',q.meeting);ensureRoom('flow');`);
  await app.evaluate('aiPlan()');await app.evaluate('aiPlan()');
  assert.equal(app.evaluate('timers.length'),1);
  app.evaluate('timers[0]()');
  assert.equal(app.evaluate("S.rooms.flow.msgs.filter(m=>m.f==='ai').length"),1);
});
