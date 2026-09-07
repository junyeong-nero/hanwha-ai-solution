import test from 'node:test';
import assert from 'node:assert/strict';
import {inferPlaceIntent} from '../supabase/functions/_shared/place-intent.ts';
import {searchPlaces} from '../supabase/functions/_shared/search.ts';
import {suggestWithAI} from '../supabase/functions/_shared/ai-plan.ts';
const meeting={title:'러닝 크루',tags:['러닝'],region:'판교',when_label:'평일 저녁'};
const lines=[{speaker:'참가자1',text:'오늘은 뛰지 말고 닭발 먹자'},{speaker:'참가자2',text:'좋아 판교에서 먹자'}];
const response=value=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
test('러닝 모임의 닭발 대화를 검색 의도와 최종 후보 추천 양쪽에 전달한다',async()=>{
  const intent=await inferPlaceIntent({meeting,lines,apiKey:'test',fetchImpl:async(_,init)=>{
    const body=JSON.parse(init.body),input=JSON.parse(body.input[1].content);
    assert.deepEqual(input.conversation,lines);assert.match(body.input[0].content,/태그보다 우선/);
    return response({region:'판교',keywords:['닭발']});
  }});
  const search=await searchPlaces({...intent,kakaoKey:'test',fetchImpl:async url=>{
    assert.match(new URL(url).searchParams.get('query'),/판교 닭발/);
    return Response.json({documents:[1,2,3,4,5].map(id=>({id:String(id),place_name:`닭발 ${id}`,address_name:'판교',category_name:'음식점',x:'127.1',y:'37.4'}))});
  }});
  const result=await suggestWithAI({meeting,lines,places:search.places,apiKey:'test',now:new Date(),fetchImpl:async(_,init)=>{
    assert.deepEqual(JSON.parse(JSON.parse(init.body).input[1].content).conversation,lines);
    return response({place:'닭발 1',time:'조율 중',meet_at:null,activity:'닭발 먹으며 이야기해요',nearby:[],candidates:[{name:'닭발 1',why:'대화에서 원한 음식이에요'},{name:'없는 식당',why:'가짜'}]});
  }});
  assert.ok(result.plan.candidates.length>=2);assert.ok(result.plan.candidates.every(c=>c.verified));
  assert.ok(!result.plan.candidates.some(c=>c.name==='없는 식당'));
});
test('의도 분석 실패·빈 출력·키 없음은 러닝으로 고정하지 않고 일반 만남 후보로 대체한다',async()=>{
  for(const options of [{apiKey:''},{apiKey:'test',fetchImpl:async()=>response({region:'판교',keywords:[]})},{apiKey:'test',fetchImpl:()=>new Promise(()=>{}),timeoutMs:5}]){
    const out=await inferPlaceIntent({meeting,lines,...options});assert.equal(out.fallback,true);assert.deepEqual(out.keywords,['식당','카페']);
  }
});
