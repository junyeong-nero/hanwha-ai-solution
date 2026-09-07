import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {loadApp} from './helpers/app-context.mjs';

function fixture(backend=false){
  const app=loadApp({files:['config.js','match.js','chat.js','map.js','backend.js','places.js','home.js'],globals:{crypto:webcrypto,location:{search:backend?'':'?demo=1'}}});
  app.evaluate(`globalThis.toast=()=>{};CUR='m1';ensureRoom('m1');S.joined=['m1'];$('cin').value='';$('cin').focus=()=>{};`);
  return app;
}

test('데모 추천 성공으로 가이드가 완료되며 시간·투표·확정은 생성하지 않는다',async()=>{
  const app=fixture();
  app.evaluate("renderHome()");assert.match(app.el('nextcard').innerHTML,/AI 장소 추천 기능 써보기/);
  assert.equal(app.evaluate('S.placeRecommendationTried'),false);
  app.evaluate("S.rooms.m1.msgs.push({f:'me',x:'오늘은 닭발 먹자'})");
  await app.evaluate('aiPlan()');
  assert.equal(app.evaluate('S.placeRecommendationTried'),true);
  assert.equal(app.evaluate('S.rooms.m1.msgs.filter(m=>m.f===\'ai\').length'),1);
  assert.equal(app.evaluate('S.rooms.m1.planned'),null);
  assert.match(app.el('msgs').innerHTML,/닭발 식당/);
  assert.match(app.el('msgs').innerHTML,/추천 이유/);
  assert.doesNotMatch(app.el('msgs').innerHTML,/확정|시간표|투표/);
  app.evaluate('renderHome()');assert.equal(app.el('nextcard').innerHTML,'');
});

test('후보 의견은 초안만 만들고 기존 메시지를 덮어쓰거나 자동 전송하지 않는다',async()=>{
  const app=fixture();await app.evaluate('aiPlan()');
  app.evaluate("draftPlaceOpinion(S.rooms.m1.msgs[0].planId,1)");
  assert.match(app.el('cin').value,/데모 카페에서 만나면 어떨까요/);
  assert.equal(app.evaluate('S.rooms.m1.msgs.length'),1);
  app.el('cin').value='작성 중인 말';app.evaluate("draftPlaceOpinion(S.rooms.m1.msgs[0].planId,0)");
  assert.equal(app.el('cin').value,'작성 중인 말');
});

test('서버 요청 연타는 한 번만 호출하고 다른 방으로 이동해도 원래 방에만 반영한다',async()=>{
  const app=fixture(true);
  app.evaluate("globalThis.calls=0;globalThis.release=null;callFn=()=>{calls++;return new Promise(resolve=>release=resolve)}");
  const pending=app.evaluate('aiPlan()');await app.evaluate('aiPlan()');
  assert.equal(app.evaluate('calls'),1);assert.match(app.el('msgs').innerHTML,/추천을 기다리면서/);
  app.evaluate("CUR='m2';ensureRoom('m2');renderMsgs();release({plan:{id:'server-p',candidates:[{name:'카페',why:'지역에 맞아요'}]},search:{status:'ok'}})");
  await pending;
  assert.equal(app.evaluate('S.rooms.m1.msgs.length'),1);
  assert.equal(app.evaluate('S.rooms.m2.msgs.length'),0);
  assert.doesNotMatch(app.el('msgs').innerHTML,/카페/);
  assert.equal(app.evaluate('S.rooms.m1.planPending'),false);
});

test('빈 검색·실패는 기존 후보를 남기고 다시 시도할 수 있으며 가이드를 완료하지 않는다',async()=>{
  const app=fixture(true);
  app.evaluate("callFn=async()=>({plan:null,search:{status:'empty'}})");await app.evaluate('aiPlan()');
  assert.equal(app.evaluate('S.placeRecommendationTried'),false);assert.equal(app.evaluate('S.rooms.m1.msgs.length'),0);
  assert.match(app.el('msgs').innerHTML,/다시 추천받기/);
  app.evaluate("callFn=async()=>({plan:{id:'ok',candidates:[{name:'카페',why:'이유'}]}})");await app.evaluate('aiPlan()');
  app.evaluate("callFn=async()=>{throw Error('연결 끊김')}");await app.evaluate('aiPlan()');
  assert.equal(app.evaluate('S.rooms.m1.msgs.length'),1);assert.match(app.el('msgs').innerHTML,/카페/);assert.match(app.el('msgs').innerHTML,/연결 끊김/);
});

test('로그아웃 후 도착한 추천은 다음 사용자 상태를 변경하지 않는다',async()=>{
  const app=fixture(true);app.evaluate("globalThis.release=null;callFn=()=>new Promise(resolve=>release=resolve)");
  const pending=app.evaluate('aiPlan()');
  app.evaluate("backendEpoch++;S.rooms={};S.placeRecommendationTried=false;CUR=null;release({plan:{id:'late',candidates:[{name:'이전 사용자 장소'}]}})");
  await pending;assert.equal(app.evaluate('Object.keys(S.rooms).length'),0);assert.equal(app.evaluate('S.placeRecommendationTried'),false);
});

test('과거 확정 데이터와 Realtime 중복도 후보로만 표시하고 지도 강조는 개인 상태다',()=>{
  const app=fixture();
  app.evaluate("globalThis.pl={id:'p',confirmed:true,meet_at:'2020-01-01',selected_place:{name:'B'},candidates:[{name:'A'},{name:'B'}]};applyPlan(S.rooms.m1,pl);applyPlan(S.rooms.m1,pl);renderMsgs();selectCand('p',1)");
  assert.equal(app.evaluate('S.rooms.m1.msgs.length'),1);assert.equal(app.evaluate('S.rooms.m1.planned'),null);
  assert.equal(app.evaluate("PLACE_SEL.p"),1);assert.equal(app.evaluate('S.rooms.m1.msgs[0].plan.meetAt'),null);
  assert.doesNotMatch(app.el('msgs').innerHTML,/약속 확정|확정됨/);
});

test('장소 이름·추천 이유·실패 문구는 실행되지 않는 텍스트로 렌더링한다',()=>{
  const app=fixture();
  app.evaluate(`applyPlan(S.rooms.m1,{id:'p',candidates:[{name:'<script>bad</script>',why:'<img src=x onerror=bad()>',url:'javascript:bad()'}]});S.rooms.m1.planError='<svg onload=bad()>';renderMsgs()`);
  const html=app.el('msgs').innerHTML;
  assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img/);assert.match(html,/&lt;svg/);
  assert.doesNotMatch(html,/<script>|<img src=x|<svg onload|javascript:/);
});
