import assert from 'node:assert/strict';
import test from 'node:test';
import {loadApp} from './helpers/app-context.mjs';

function app(){
  const a=loadApp({files:['config.js','match.js','chat.js','backend.js']});
  a.evaluate(`
    S.rooms={};S.joined=[];ME='me';
    const channels=[];const removed=[];const failures=[];const calls=[];
    let summary=[];let readError=null;
    function toast(...args){failures.push(args)}
    sb={
      rpc:async(name,args)=>{
        calls.push({name,args});
        if(name==='mark_room_read')return {error:readError};
        return {data:summary};
      },
      channel:name=>{
        const ch={name,handlers:[],on(type,filter,callback){this.handlers.push({filter,callback});return this},subscribe(callback){this.status=callback;return this}};
        channels.push(ch);return ch;
      },
      removeChannel:ch=>removed.push(ch.name)
    };
    function rows(n=3){return [{meeting_id:'room-a',title:'모임',member_count:2,last_body:'새 메시지',last_at:'2026-09-07T01:00:00Z',unread_count:n}]}
  `);
  return a;
}

test('서버 집계로 방 배지·하단 합계·기존 방의 마지막 메시지를 갱신한다',async()=>{
  const a=app();
  await a.evaluate(`summary=rows();ensureRoom('room-a').msgs=[{x:'오래된 메시지'}];loadRooms()`);
  assert.equal(a.el('chatbdg').textContent,3);
  assert.match(a.el('roomlist').innerHTML,/새 메시지/);
  assert.match(a.el('roomlist').innerHTML,/<span class="ub">3<\/span>/);
});

test('전체 메시지 구독은 방을 닫아도 유지되고 중복 이벤트도 집계 수를 늘리지 않는다',async()=>{
  const a=app();
  a.evaluate(`subscribeInbox();subscribeInbox();CH=sb.channel('room-detail');unsubscribeRoom();summary=rows(2)`);
  assert.equal(a.evaluate('channels.length'),2);
  assert.equal(a.evaluate('removed.join()'),'room-detail');
  assert.equal(a.evaluate("channels[0].handlers[0].filter.filter"),undefined);
  await a.evaluate(`channels[0].handlers[0].callback({new:{id:'m1'}})`);
  await a.evaluate(`channels[0].handlers[0].callback({new:{id:'m1'}})`);
  assert.equal(a.el('chatbdg').textContent,2);
  await a.evaluate(`summary=rows(5);channels[0].status('SUBSCRIBED')`);
  assert.equal(a.el('chatbdg').textContent,5);
});

test('실제 조회한 메시지를 읽음 저장하고 실패하면 배지를 유지한다',async()=>{
  const a=app();
  await a.evaluate(`summary=rows();loadRooms()`);
  await a.evaluate(`S.rooms['room-a'].readMessageId='message-3';readError=new Error('오프라인');markRoomRead('room-a')`);
  assert.equal(a.el('chatbdg').textContent,3);
  assert.equal(a.evaluate('failures.length'),1);
  await a.evaluate(`readError=null;summary=rows(0);markRoomRead('room-a')`);
  assert.equal(a.el('chatbdg').textContent,0);
  assert.equal(a.evaluate("calls.find(x=>x.name==='mark_room_read').args.p_message_id"),'message-3');
});

test('숨겨진 앱은 읽음 저장하지 않는다',async()=>{
  const a=app();
  await a.evaluate(`summary=rows();loadRooms()`);
  await a.evaluate(`S.rooms['room-a'].readMessageId='message-3';document.visibilityState='hidden';markRoomRead('room-a')`);
  assert.equal(a.evaluate("calls.filter(x=>x.name==='mark_room_read').length"),0);
  assert.equal(a.el('chatbdg').textContent,3);
});

test('늦게 도착한 목록 응답은 최신 집계를 덮지 않는다',async()=>{
  const a=app();
  await a.evaluate(`
    let finishOld;sb.rpc=()=>new Promise(resolve=>finishOld=resolve);
    const old=loadRooms();sb.rpc=async()=>({data:rows(1)});
    loadRooms().then(()=>{finishOld({data:rows(9)});return old});
  `);
  assert.equal(a.el('chatbdg').textContent,1);
});

test('로그아웃은 구독·배지를 비우고 이전 사용자의 응답과 이벤트를 버린다',async()=>{
  const a=app();
  await a.evaluate(`summary=rows();loadRooms()`);
  await a.evaluate(`
    subscribeInbox();let finish;sb.rpc=()=>new Promise(resolve=>finish=resolve);
    const pending=loadRooms();clearBackendState();finish({data:rows(9)});pending;
  `);
  assert.equal(a.el('chatbdg').textContent,0);
  assert.equal(a.evaluate('S.joined.length'),0);
  assert.equal(a.evaluate('removed.join()'),'inbox-me');
  await a.evaluate(`channels[0].handlers[0].callback({new:{id:'old'}})`);
  assert.equal(a.evaluate('S.joined.length'),0);
});

test('열린 방의 새 메시지는 화면에 반영한 뒤 읽음 저장한다',async()=>{
  const a=app();
  a.evaluate(`
    const order=[];summary=rows(1);CUR='room-a';
    loadRoom=async id=>{order.push('조회');ensureRoom(id).readMessageId='received'};
    renderMsgs=()=>order.push('렌더');
    const baseRpc=sb.rpc;sb.rpc=async(name,args)=>{
      if(name==='mark_room_read'){order.push('읽음');summary=rows(0)}
      return baseRpc(name,args);
    };
    subscribeInbox();
  `);
  await a.evaluate(`channels[0].handlers[0].callback({new:{meeting_id:'room-a'}})`);
  assert.equal(a.evaluate('order.join()'),'조회,렌더,읽음');
  assert.equal(a.el('chatbdg').textContent,0);
});

test('더 이상 참가하지 않는 방은 합계에서 제거한다',async()=>{
  const a=app();
  await a.evaluate(`summary=rows(4);loadRooms()`);
  await a.evaluate(`summary=[];loadRooms()`);
  assert.equal(a.el('chatbdg').textContent,0);
  assert.equal(a.evaluate("S.rooms['room-a']"),undefined);
});

test('독립된 두 세션에서 참가·탈퇴 알림과 메시지·재연결이 실제 멤버 헤더를 갱신한다',async()=>{
  const sessions=[app(),app()];
  for(const [i,a] of sessions.entries()){
    a.evaluate(`
      ME='user-${i}';CUR='room-a';summary=rows(0);
      let members=[{user_id:'user-0',nickname:'첫 멤버'}];
      const originalRpc=sb.rpc;
      sb.rpc=(name,args)=>name==='room_members'?Promise.resolve({data:members}):originalRpc(name,args);
      sb.from=()=>{
        const query={select(){return this},eq(){return this},order(){return this},limit(){return this},maybeSingle(){return this},
          then(resolve){return Promise.resolve({data:[]}).then(resolve)}};
        return query;
      };
      renderMsgs=()=>{};
      subscribeInbox();subscribeRoom(CUR);
    `);
  }
  const [a,b]=sessions;
  await a.evaluate('syncVisibleRoom()');
  assert.equal(a.el('rmeta').textContent,'멤버 1 · 익명 0명');
  const notify=session=>session.evaluate(`channels[0].handlers[0].callback({new:{meeting_id:'room-a',sender_id:null}})`);
  for(const session of sessions){
    session.evaluate(`members.push({user_id:'user-1',nickname:'새 멤버'});summary[0].member_count=2`);
    await notify(session);
    assert.equal(session.el('rmeta').textContent,'멤버 2 · 익명 1명');
    assert.equal(session.el('memCount').textContent,2);
  }
  a.evaluate(`members.pop();summary[0].member_count=1`);
  await notify(a);
  assert.equal(a.el('rmeta').textContent,'멤버 1 · 익명 0명');
  assert.equal(a.el('memCount').textContent,1);
  // 오프라인 중 놓친 재참가는 방 채널의 재구독으로 복원한다.
  a.evaluate(`members.push({user_id:'user-1',nickname:'새 멤버'});summary[0].member_count=2`);
  await a.evaluate(`channels[1].status('SUBSCRIBED')`);
  // 방 채널 콜백은 동기화 Promise를 반환하지 않으므로 완료 시점까지 기다린다.
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(a.el('rmeta').textContent,'멤버 2 · 익명 1명');
  assert.equal(a.el('memCount').textContent,2);
  a.evaluate(`members.pop();summary[0].member_count=1;document.visibilityState='hidden'`);
  await notify(a);
  assert.equal(a.el('memCount').textContent,2,'숨겨진 화면은 복귀 시 갱신');
  await a.evaluate(`document.visibilityState='visible';syncVisibleRoom()`);
  assert.equal(a.el('memCount').textContent,1);
  assert.equal(b.el('memCount').textContent,2,'세션 상태는 서로 독립적');
});
