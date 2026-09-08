import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {searchPlaces,placeKey,toPlace} from '../supabase/functions/_shared/search.ts';
import {suggestWithAI} from '../supabase/functions/_shared/ai-plan.ts';

// 핸들러 전체를 실행해 저장한 후보가 다음 검색으로 전달되는 경로를 확인한다.
test('추천 핸들러는 저장한 직전 후보를 제외하고 후보 소진 시 추가 저장하지 않는다',async()=>{
  const source=readFileSync(new URL('../supabase/functions/suggest-meeting-plan/index.ts',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
  const saved=[],joined='2026-09-08T00:00:00+00:00';
  let handler,available=10;
  const svc={from(table){
    let inserted;
    const query={
      select(){return query},eq(){return query},gte(){return query},order(){return query},limit(){return query},
      or(filter){assert.equal(filter,`context_since.gte.${joined},and(context_since.is.null,created_at.gte.${joined})`);return query},
      insert(value){inserted=value;return query},
      async maybeSingle(){return {data:table==='meeting_members'?{joined_at:joined}:table==='meetings'?{title:'모임',region:'판교',tags:[]}:saved.at(-1)??null}},
      async single(){const row={...inserted,id:String(saved.length+1)};saved.push(row);return {data:row}},
      then(resolve){resolve({data:[]})},
    };return query;
  }};
  const context={
    Deno:{serve(fn){handler=fn},env:{get:()=>''}},console:{info(){},error(){}},
    requireUser:async()=>({user:{id:'user'}}),readJsonBody:async()=>({meeting_id:'meeting'}),isUuid:()=>true,
    serviceClient:()=>svc,consumeAIBudget:async()=>true,anonymizeMessages:()=>[],
    OPENAI_MODEL:'test',tokenUsage:()=>({}),inferPlaceIntent:async()=>({region:'판교',keywords:['카페'],fallback:true}),
    searchPlaces:opts=>searchPlaces({...opts,kakaoKey:'test',fetchImpl:async url=>Response.json({documents:Array.from({length:Math.min(available,Number(new URL(url).searchParams.get('size')))},(_,i)=>({id:String(i+1),place_name:`카페 ${i+1}`}))})}),
    suggestWithAI,placeKey,toPlace,json:body=>body,errorResponse:err=>{throw err},
  };
  vm.runInNewContext(stripTypeScriptTypes(source),context);
  const first=await handler({method:'POST'}),second=await handler({method:'POST'});
  assert.equal(saved.length,2);
  assert.ok(second.plan.candidates.every(c=>!first.plan.candidates.some(p=>p.id===c.id)));
  // 세 번째 요청의 검색 결과가 직전 카드에 있는 장소뿐인 상황.
  available=5;saved[saved.length-1].candidates=first.plan.candidates;
  const empty=await handler({method:'POST'});
  assert.equal(empty.plan,null);assert.equal(empty.search.status,'no_new');assert.equal(saved.length,2);
});
