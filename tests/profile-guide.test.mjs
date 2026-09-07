import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../src/js/profile.js',import.meta.url),'utf8');
function setup({dirty=true,save=async()=>true}={}){
  const elements=new Map();
  const visits=[];
  let snapshots=0;
  const context=vm.createContext({
    S:{dirty},R:{recDirty:false},BACKEND:true,
    $:id=>{
      if(!elements.has(id))elements.set(id,{addEventListener(){},classList:{toggle(){}},disabled:false});
      return elements.get(id);
    },
    saveProfile:save,snapProfile(){snapshots++},toast(){},go:tab=>visits.push(tab),
  });
  vm.runInContext(source,context);
  return {context,visits,elements,snapshots:()=>snapshots,run:()=>vm.runInContext('saveProfileAndBrowse()',context)};
}
test('저장 성공 후에만 이동하고 저장된 프로필을 갱신한다',async()=>{
  const app=setup();await app.run();
  assert.deepEqual(app.visits,['match']);assert.equal(app.context.S.dirty,false);assert.equal(app.snapshots(),1);
});
test('변경이 없으면 저장 요청 없이 모임을 둘러본다',async()=>{
  const app=setup({dirty:false,save:()=>assert.fail('불필요한 저장')});await app.run();
  assert.deepEqual(app.visits,['match']);assert.equal(app.snapshots(),0);
});
test('저장 거절과 통신 예외 모두 변경 내용을 남기고 재시도를 허용한다',async()=>{
  for(const save of [async()=>false,async()=>{throw new Error('연결 끊김')}]){
    const app=setup({save});await app.run();
    assert.deepEqual(app.visits,[]);assert.equal(app.context.S.dirty,true);
    assert.equal(app.elements.get('profileNext').disabled,false);assert.equal(app.snapshots(),0);
  }
});
test('이동 버튼을 연속 눌러도 저장은 한 번만 요청한다',async()=>{
  let finish,calls=0;
  const app=setup({save:()=>{calls++;return new Promise(resolve=>{finish=resolve})}});
  const pending=app.run();await app.run();assert.equal(calls,1);
  finish(true);await pending;assert.deepEqual(app.visits,['match']);
});
