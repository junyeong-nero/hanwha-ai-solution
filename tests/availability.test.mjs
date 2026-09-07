import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/app-context.mjs';
const {evaluate}=loadApp({files:['availability.js']});
const run=s=>JSON.parse(JSON.stringify(evaluate(s)));
test('한국 시간 자정과 연말 경계를 UTC 슬롯으로 일관되게 변환한다',()=>{
 assert.deepEqual(run("availabilitySlots({start:'2026-12-31',end:'2027-01-01',from:0,to:60})"),['2026-12-30T15:00:00.000Z','2026-12-30T15:30:00.000Z','2026-12-31T15:00:00.000Z','2026-12-31T15:30:00.000Z']);
});
test('7일 초과, 잘못된 날짜, 30분 밖 범위는 거절한다',()=>{
 for(const c of [{start:'2026-09-01',end:'2026-09-08',from:0,to:30},{start:'2026-02-30',end:'2026-03-02',from:0,to:30},{start:'2026-09-01',end:'2026-09-01',from:15,to:60}])assert.throws(()=>evaluate(`availabilitySlots(${JSON.stringify(c)})`));
});
test('빈 응답과 전원 불가에서는 최다·전원 가능을 표시하지 않는다',()=>{
 for(const ids of [[],['a'],['a','b']])assert.deepEqual(run(`availabilitySummary(['s'],${JSON.stringify(ids)},{})`),[{slot:'s',count:0,total:ids.length,all:false,best:false}]);
});
test('1인 모임, 중복 응답, 탈퇴자 응답을 집계한다',()=>{
 assert.deepEqual(run("availabilitySummary(['s'],['a','a'],{a:['s','s'],left:['s']})"),[{slot:'s',count:1,total:1,all:true,best:true}]);
});
test('동률 후보와 교집합을 분리한다',()=>{
 const rows=run("availabilitySummary(['a','b','c'],['x','y','z'],{x:['a','b','c'],y:['a','c'],z:['b']})");
 assert.deepEqual(rows.map(r=>r.count),[2,2,2]);assert.ok(rows.every(r=>r.best&&!r.all));
 assert.equal(run("availabilitySummary(['s'],['x','y'],{x:['s'],y:['s']})")[0].all,true);
});
