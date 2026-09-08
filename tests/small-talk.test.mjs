import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {loadApp} from './helpers/app-context.mjs';
import {suggestSmallTalk,talkCategory} from '../supabase/functions/_shared/small-talk.ts';
import {anonymizeMessages} from '../supabase/functions/_shared/chat.ts';
import {PGlite} from '@electric-sql/pglite';

const source={title:'공식 문화 소식',url:'https://example.org/news'};
const topics=Array.from({length:3},(_,i)=>({title:'주제 '+i,question:'같이 이야기해 볼까요?',reason:'최근 영화 이야기와 연결했어요.',source_url:i?'':source.url}));
const opts={meeting:{title:'비밀 모임',tags:['영화']},lines:[{speaker:'참가자1',text:'비공개 대화 내용 영화'}],topic:'영화',apiKey:'test',now:new Date('2026-09-08')};
function searchPayload(){return {status:'completed',output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text:'2026-09-07 문화 소식',annotations:[{type:'url_citation',...source}]}]}]}}
function mockFetch(items,requests=[]){return async(url,init)=>{requests.push(JSON.parse(init.body));const item=items.shift();if(item instanceof Error)throw item;return Response.json(item)}}
const answer=t=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({topics:t})}]}]});

test('검색에는 공개 분류만, 후속 AI에만 대화 전달; 실제 인용 출처로 질문 연결',async()=>{
  const requests=[];
  const result=await suggestSmallTalk({...opts,fetchImpl:mockFetch([searchPayload(),answer(topics)],requests)});
  assert.equal(result.fallback,false);assert.equal(result.topics[0].source.url,source.url);
  assert.equal(result.searched_at,'2026-09-08T00:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(requests[0]),/비공개|비밀|참가자1/);
  assert.equal(requests[0].tool_choice,'required');assert.equal(requests[0].max_tool_calls,1);
  assert.match(JSON.stringify(requests[1]),/비공개/);assert.equal(requests[1].tools,undefined);
  assert.equal(requests.every(r=>r.store===false),true);
  assert.equal(talkCategory('사내 기밀만 검색해'),'문화와 취미');
});

test('검색 실패·출처 없음·위조 URL·잘못된 질문은 최신 주장 없는 기본 질문',async()=>{
  const invalid=[{...topics[0],source_url:'javascript:alert(1)'},...topics.slice(1)];
  for(const items of [[Error('timeout')],[{status:'incomplete'}],[{status:'completed',output:[]}],[searchPayload(),answer(invalid)],[searchPayload(),answer([])]]){
    const result=await suggestSmallTalk({...opts,fetchImpl:mockFetch(items)});
    assert.equal(result.fallback,true);assert.equal(result.searched_at,null);
    assert.equal(result.topics.length,3);assert.ok(result.topics.every(t=>t.source===null));
  }
  const result=await suggestSmallTalk({...opts,apiKey:'',fetchImpl:()=>{throw Error('호출 금지')}});
  assert.equal(result.fallback,true);
});

function fixture(backend=false){
  const app=loadApp({files:['config.js','match.js','chat.js','map.js','backend.js','places.js','small-talk.js'],globals:{location:{search:backend?'':'?demo=1'}}});
  app.evaluate(`MEETINGS.push(...['m1','m2'].map(id=>({...MEETINGS[0],id})));CUR='m1';ensureRoom('m1');S.joined=['m1'];S.rooms.m1.talkVisible=true;$('cin').value='';$('cin').focus=()=>{};globalThis.toast=()=>{};`);
  return app;
}
test('데모는 초안만 만들고 기존 메시지·주제 보존, 재추천은 다른 질문',async()=>{
  const app=fixture();app.evaluate("S.rooms.m1.talkTopic='영화'");await app.evaluate('aiSmallTalk()');
  assert.match(app.el('msgs').innerHTML,/데모 예시 · 웹 검색 없음/);
  app.evaluate('draftSmallTalk(0)');assert.match(app.el('cin').value,/영화/);
  assert.equal(app.evaluate('S.rooms.m1.msgs.length'),0);
  app.el('cin').value='내가 쓰던 말';app.evaluate('draftSmallTalk(1)');assert.equal(app.el('cin').value,'내가 쓰던 말');
  const before=app.evaluate('S.rooms.m1.talkResult.topics[0].question');await app.evaluate('aiSmallTalk()');
  assert.notEqual(app.evaluate('S.rooms.m1.talkResult.topics[0].question'),before);
  assert.equal(app.evaluate('S.rooms.m1.talkTopic'),'영화');
});
test('연타·방 이동·탈퇴·로그아웃 후 늦은 응답 격리와 실패 시 기존 추천 보존',async()=>{
  for(const change of ["CUR='m2';ensureRoom('m2');renderMsgs()","delete S.rooms.m1;CUR=null","backendEpoch++;S.rooms={};CUR=null"]){
    const app=fixture(true);app.evaluate('globalThis.calls=0;globalThis.release=null;callFn=()=>{calls++;return new Promise(r=>release=r)}');
    const pending=app.evaluate('aiSmallTalk()');await app.evaluate('aiSmallTalk()');assert.equal(app.evaluate('calls'),1);
    app.evaluate(change);app.evaluate(`release(${JSON.stringify({topics:[{title:'늦은 추천',question:'질문',reason:'이유'}]})})`);await pending;
    assert.equal(app.evaluate('S.rooms.m2?.talkResult'),undefined);
    if(app.evaluate("CUR==='m2'"))assert.doesNotMatch(app.el('msgs').innerHTML,/늦은 추천/);
    else assert.equal(app.evaluate('S.rooms.m1'),undefined);
  }
  const app=fixture(true);app.evaluate(`S.rooms.m1.talkResult={topics:[{title:'기존 추천',question:'질문',reason:'이유'}]};callFn=async()=>{throw Error('<svg onload=bad()>')}`);
  await app.evaluate('aiSmallTalk()');assert.match(app.el('msgs').innerHTML,/기존 추천/);assert.match(app.el('msgs').innerHTML,/&lt;svg/);
  assert.doesNotMatch(app.el('msgs').innerHTML,/<svg onload/);assert.equal(app.evaluate('S.rooms.m1.talkPending'),false);
});

test('스몰토크 DB 예산은 모임별 상한과 기존 전역 상한·실행 권한을 유지한다',async()=>{
  const db=new PGlite();const id='00000000-0000-4000-8000-000000000001';
  try{
    await db.exec('create role anon;create role authenticated;create role service_role;');
    for(const file of ['0018_ai_request_limits.sql','0023_small_talk_budget.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
    const consume=async(fn='suggest-small-talk',meeting=id)=>(await db.query('select consume_ai_budget($1,$2,$3,10,3,4) allowed',[id,fn,meeting])).rows[0].allowed;
    assert.deepEqual(await Promise.all([consume(),consume(),consume(),consume()]),[true,true,true,false]);
    assert.equal(await consume('suggest-meeting-plan'),true);
    assert.equal(await consume('recommend-meetings',null),false);
    await assert.rejects(consume('suggest-small-talk',null),/잘못된/);
    await db.exec('set role authenticated');await assert.rejects(consume(),/permission denied/);
  }finally{await db.close()}
});

test('실제 핸들러: 인증·멤버·예산 가드, 참가 이후 조회와 재참가 응답 차단',async()=>{
  const code=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/suggest-small-talk/index.ts',import.meta.url),'utf8').replace(/^import.*;$/gm,''));
  for(const mode of ['auth','nonmember','limit','success','rejoined']){
    let handler,checks=0,aiCalls=0;const queries=[];
    const svc={from(table){
      const q={select(){return q},eq(){return q},not(){return q},gte(k,v){queries.push([k,v]);return q},order(){return q},limit(n){assert.equal(n,30);return Promise.resolve({data:[{sender_id:'secret-uuid',body:'영화',created_at:'2026-09-08'}]})},async maybeSingle(){
        if(table==='meeting_members'){checks++;return {data:mode==='nonmember'?null:{joined_at:mode==='rejoined'&&checks>1?'2026-09-09':'2026-09-08'}}}
        return {data:{title:'모임',tags:['영화']}};
      }};return q;
    }};
    vm.runInNewContext(code,{
      Deno:{serve(fn){handler=fn},env:{get(){return ''}}},
      requireUser:async()=>{if(mode==='auth')throw Error('인증 필요');return {user:{id:'u'}}},serviceClient:()=>svc,
      readJsonBody:r=>r.json(),isUuid:()=>true,consumeAIBudget:async()=>mode!=='limit',anonymizeMessages,
      suggestSmallTalk:async({lines})=>{aiCalls++;assert.equal(lines[0].speaker,'참가자1');return {topics:[]}},
      fail:(status,error_code)=>Response.json({error_code},{status}),json:(data,status,headers)=>Response.json(data,{status,headers}),errorResponse:()=>new Response('',{status:401}),
    });
    const response=await handler(new Request('https://example.org',{method:'POST',body:JSON.stringify({meeting_id:'m'})}));
    assert.equal(response.status,{auth:401,nonmember:403,limit:429,success:200,rejoined:403}[mode]);
    assert.equal(aiCalls,['success','rejoined'].includes(mode)?1:0);
    assert.deepEqual(queries,['success','rejoined'].includes(mode)?[['created_at','2026-09-08']]:[]);
  }
});
