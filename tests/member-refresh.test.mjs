import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './helpers/app-context.mjs';

// 두 사용자별 독립 전역에 실제 Realtime 콜백을 등록하고 RPC 응답만 대체한다.
function session(me, attended){
  const app=loadApp({files:['config.js','match.js','chat.js','map.js','backend.js','places.js'],globals:{location:{search:''}}});
  app.evaluate(`
    ME=${JSON.stringify(me)};CUR='qa';S.met={};
    S.profile.realName='내 이름';
    ensureMeeting('qa',{name:'회귀 확인',members:[],memberCount:1});ensureRoom('qa');
    globalThis.serverAttended=${JSON.stringify(attended)};
    globalThis.handlers={};
    sb={channel:()=>({on(event,filter,fn){handlers[filter.table]=fn;return this},subscribe(){return this}}),
      removeChannel(){},async rpc(name){
        const other=ME==='a'?'b':'a', linked=serverAttended.includes(ME)&&serverAttended.includes(other);
        const p={user_id:other,nickname:'상대달',real_name:linked?'상대실명':null,company_id:linked?'sol':null};
        return {data:name==='room_members'?[p]:linked?[p]:[]};
      }};
    S.rooms.qa.attended=new Set(serverAttended);S.rooms.qa.iAttended=serverAttended.includes(ME);
    S.rooms.qa.msgs=[{f:ME==='a'?'b':'a',x:'안녕하세요',t:'12:00'}];
    subscribeRoom('qa');
  `);
  return app;
}

test('두 독립 세션의 열린 목록은 1/2에서 2/2로 갱신하고 상호 완료 전 익명을 유지한다',async()=>{
  const a=session('a',['a']),b=session('b',['a']);
  for(const app of [a,b]){
    await app.evaluate('openMembers()');app.evaluate("renderMeta('qa');renderMsgs();");
    assert.match(app.el('memsum').textContent,/익명 1명 · 만남 완료 1\/2/);
    assert.match(app.el('memlist').innerHTML,/상대달/);
    assert.doesNotMatch(app.el('memlist').innerHTML,/상대실명|한화솔루션/);
  }
  // 각 사용자는 상대의 완료 INSERT를 수신한다. B에게 A 이벤트가 늦게 도착해도 동일하다.
  for(const [app,other] of [[a,'b'],[b,'a']]){
    app.evaluate("serverAttended=['a','b'];S.rooms.qa.attended.add(ME);S.rooms.qa.iAttended=true;");
    await app.evaluate(`handlers.meeting_attendance({new:{user_id:'${other}'}})`);
    assert.match(app.el('memsum').textContent,/익명 0명 · 만남 완료 2\/2/);
    assert.match(app.el('memlist').innerHTML,/상대실명/);
    assert.match(app.el('memlist').innerHTML,/한화솔루션/);
    assert.equal((app.el('memlist').innerHTML.match(/mbadge full/g)||[]).length,2);
    assert.match(app.el('rmeta').textContent,/익명 0명 · 만남 완료 2\/2/);
    assert.match(app.el('msgs').innerHTML,/상대실명/);
    assert.equal(app.el('memwrap').classList.contains('on'),true);
  }
});

test('완료 이벤트는 닫힌 목록을 열지 않고 다른 방의 목록도 바꾸지 않는다',async()=>{
  const app=session('a',['a']);await app.evaluate('openMembers()');app.evaluate('hideMembers()');
  await app.evaluate("handlers.meeting_attendance({new:{user_id:'b'}})");
  assert.equal(app.el('memwrap').classList.contains('on'),false);
  app.evaluate("CUR='other';$('memwrap').classList.add('on');$('memsum').textContent='다른 방';");
  await app.evaluate("handlers.meeting_attendance({new:{user_id:'b'}})");
  assert.equal(app.el('memsum').textContent,'다른 방');
});

test('목록 조회 중 방을 이동하면 늦은 응답으로 목록을 열지 않는다',async()=>{
  const app=session('a',[]);
  app.evaluate('refreshMembers=()=>new Promise(resolve=>globalThis.release=resolve)');
  const pending=app.evaluate('openMembers()');
  app.evaluate("CUR='other';release()");await pending;
  assert.equal(app.el('memwrap').classList.contains('on'),false);
});
