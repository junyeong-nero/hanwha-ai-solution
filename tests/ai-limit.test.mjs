import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { budgetLimit, consumeAIBudget } from '../supabase/functions/_shared/ai-limit.ts';
import { recommendWithAI } from '../supabase/functions/_shared/ai-matching.ts';

const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('설정 검증·DB 실패 차단·제한 중 규칙 추천은 외부 요청이 없다',async()=>{
  for(const v of [undefined,'','0','-1','NaN','1.5','101'])assert.equal(budgetLimit(v,10,100),10);
  assert.equal(budgetLimit('3',10,100),3);
  assert.equal(await consumeAIBudget({rpc:async()=>({data:null,error:{}})},uid(1),'recommend-meetings',null,()=>undefined),false);
  assert.equal(await consumeAIBudget({rpc:async()=>({data:false,error:null})},uid(1),'recommend-meetings',null,()=>undefined),false);
  const result=await recommendWithAI({profile:{},candidates:[{id:'m1',title:'모임',capacity:6,member_count:1}],userId:uid(1),apiKey:'',fetchImpl:()=>{throw Error('외부 호출 금지')}});
  assert.equal(result.fallback,true);assert.equal(result.recommendations.length,1);
});

test('DB 예산: 사용자·모임·전역 상한, 동시 제출, 만료, 권한',async()=>{
  const db=new PGlite();
  try{
    await db.exec('create role anon;create role authenticated;create role service_role;');
    await db.exec(readFileSync(new URL('../supabase/migrations/0018_ai_request_limits.sql',import.meta.url),'utf8'));
    const consume=async(u=1,fn='recommend-meetings',meeting=null,global=1000)=>(await db.query('select consume_ai_budget($1,$2,$3,10,3,$4) allowed',[uid(u),fn,meeting,global])).rows[0].allowed;
    const batch=await Promise.all(Array.from({length:25},()=>consume()));
    assert.equal(batch.filter(Boolean).length,10);
    assert.equal(await consume(2),true);
    assert.equal(await consume(1,'suggest-meeting-plan',uid(100)),true);
    assert.equal(await consume(2,'suggest-meeting-plan',uid(100)),true);
    assert.equal(await consume(3,'suggest-meeting-plan',uid(100)),true);
    assert.equal(await consume(4,'suggest-meeting-plan',uid(100)),false,'모임 제한은 사용자 변경으로 우회 불가');
    assert.equal(await consume(4,'suggest-meeting-plan',uid(101)),true);
    assert.equal(await consume(9,'recommend-meetings',null,15),false,'전역 예산은 두 함수 합계');
    assert.equal((await db.query("select used from ai_request_budgets where scope='global:day'")).rows[0].used,15,'거부는 예산을 소비하지 않음');
    await db.exec("update ai_request_budgets set expires_at=now()-interval '1 second'");
    assert.equal(await consume(),true);
    assert.equal((await db.query("select used from ai_request_budgets where scope='global:day'")).rows[0].used,1);
    await db.exec('set role anon');await assert.rejects(consume(),/permission denied/);
    await db.exec('reset role;set role authenticated');await assert.rejects(consume(),/permission denied/);
    await assert.rejects(db.query('select * from ai_request_budgets'),/permission denied/);
    await db.exec('reset role;set role service_role');assert.equal(await consume(),true);
  }finally{await db.close()}
});

test('약속 함수의 예산 검사는 권한 확인 뒤, 모든 유료 작업과 저장 앞에 있다',()=>{
  const source=readFileSync(new URL('../supabase/functions/suggest-meeting-plan/index.ts',import.meta.url),'utf8');
  const guard=source.indexOf('const allowed = await consumeAIBudget');
  assert.ok(guard>source.indexOf("return fail(403, 'NOT_HOST'"));
  for(const token of ['await inferPlaceIntent(', 'await searchPlaces(', 'await suggestWithAI(', ".from('meeting_plans')"]){
    assert.ok(guard<source.indexOf(token),token);
  }
  assert.match(source,/if \(!allowed\) return fail\(429, 'RATE_LIMITED'/);
});


test('실제 약속 핸들러: 거부된 요청은 외부 호출·대화 조회·새 약속 없이 429',async()=>{
  const raw=readFileSync(new URL('../supabase/functions/suggest-meeting-plan/index.ts',import.meta.url),'utf8');
  const code=stripTypeScriptTypes(raw.replace(/^import[\s\S]*?;$/gm,''));
  for(const denied of [false,'db-error']){
    let handler,external=0,quota=0;
    const svc={
      from(table){
        assert.ok(['meeting_members','meetings'].includes(table),'대화 조회·약속 저장 금지');
        const q={select(){return q},eq(){return q},async maybeSingle(){return {data:table==='meetings'?{id:uid(10),created_by:uid(1)}:{joined_at:'2026-01-01'},error:null}}};
        return q;
      },
      async rpc(){quota++;return {data:denied===false?false:null,error:denied==='db-error'?{}:null}}
    };
    const context={
      Deno:{serve(fn){handler=fn},env:{get(){return undefined}}}, console,
      requireUser:async()=>({user:{id:uid(1)}}),serviceClient:()=>svc,
      readJsonBody:req=>req.json(),isUuid:()=>true,consumeAIBudget,
      fail:(status,error_code,message)=>Response.json({error_code,message},{status}),
      errorResponse:()=>{throw Error('예상하지 못한 오류')},
      inferPlaceIntent:()=>{external++;throw Error('외부 호출 금지')},
      searchPlaces:()=>{external++;throw Error('외부 호출 금지')},
      suggestWithAI:()=>{external++;throw Error('외부 호출 금지')},
    };
    vm.runInNewContext(code,context);
    const response=await handler(new Request('https://local.invalid',{method:'POST',body:JSON.stringify({meeting_id:uid(10)})}));
    assert.equal(response.status,429);assert.equal((await response.json()).error_code,'RATE_LIMITED');
    assert.equal(quota,1);assert.equal(external,0);
  }
});
