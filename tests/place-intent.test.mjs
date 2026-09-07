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

test('재추천은 직전 장소 ID를 제외하고 추가 검색 후보만 AI와 폴백에 전달한다',async()=>{
  const urls=[];
  const options={region:'판교',keywords:['닭발'],kakaoKey:'test',fetchImpl:async url=>{
    urls.push(new URL(url));
    const size=Number(new URL(url).searchParams.get('size'));
    return Response.json({documents:Array.from({length:size},(_,i)=>({id:String(i+1),place_name:`닭발 ${i+1}`,address_name:'판교'}))});
  }};
  const first=await searchPlaces(options);
  const second=await searchPlaces({...options,excludeKeys:first.places.map(p=>'id:'+p.id)});
  assert.equal(urls[0].searchParams.get('size'),'5');
  assert.equal(urls[1].searchParams.get('size'),'10');
  assert.deepEqual(second.places.map(p=>p.id),['6','7','8','9','10']);
  for(const apiKey of ['', 'test']){
    const result=await suggestWithAI({meeting,lines,places:second.places,apiKey,now:new Date(),fetchImpl:async(_,init)=>{
      const places=JSON.parse(JSON.parse(init.body).input[1].content).places;
      assert.ok(places.every(p=>second.places.some(c=>c.name===p.name)));
      // AI가 이전 장소를 돌려줘도 검증 단계에서 걸러져야 한다.
      return response({place:'닭발 1',time:'장소 후보',meet_at:null,activity:'식사',nearby:[],candidates:[{name:'닭발 1',why:'이전 장소'}]});
    }});
    assert.ok(result.plan.candidates.length>0);
    assert.ok(result.plan.candidates.every(p=>!first.places.some(old=>old.id===p.id)));
  }
});

test('중복뿐이면 다음 검색어도 시도하고 새 후보 없음으로 끝나며 검색 오류는 구분한다',async()=>{
  let calls=0;
  const options={region:'판교',keywords:['카페','찻집'],kakaoKey:'test',excludeKeys:['id:1','n:이름만 있는 카페|판교'],fetchImpl:async()=>{
    calls++;
    return Response.json({documents:[{id:'1',place_name:'카페',address_name:'판교'},{place_name:'이름만 있는 카페',address_name:'판교'}]});
  }};
  const result=await searchPlaces(options);
  assert.equal(calls,3);assert.equal(result.status,'no_new');assert.deepEqual(result.places,[]);
  const error=await searchPlaces({...options,fetchImpl:async()=>new Response('',{status:429})});
  assert.equal(error.status,'quota');
  const partial=await searchPlaces({...options,fetchImpl:async()=>Response.json({documents:[{id:'1',place_name:'이전'},{id:'2',place_name:'새 후보'}]})});
  assert.equal(partial.status,'ok');assert.deepEqual(partial.places.map(p=>p.id),['2']);
});
