import assert from 'node:assert/strict';
import test from 'node:test';
import { loadApp } from './helpers/app-context.mjs';

function app() {
  const a = loadApp({ files: ['config.js', 'backend.js'], globals: { setTimeout, clearTimeout } });
  a.evaluate(`
    S.joined=[];S.met={};S.tab='home';MEETINGS.length=0;
    let rendered=[];let calls=0;
    const data={candidates:[{id:'a',title:'모임',region:'판교',capacity:6,member_count:2,tags:[]}],recommendations:[{meeting_id:'a',reason:'<img src=x onerror=alert(1)>'}],model:'gpt-5.4-mini',fallback:false};
    function renderMatchCards(list){rendered=list}
    callFn=async()=>{calls++;return data};
  `);
  return a;
}

test('매칭 화면: 서버 이유를 이스케이프하고 캐시 만료 시 다시 조회한다', async () => {
  const a = app();
  await a.evaluate('loadRecommendations()');
  assert.equal(a.evaluate('rendered[0].ai'), '&lt;img src=x onerror=alert(1)&gt;');
  await a.evaluate('loadRecommendations()');
  assert.equal(a.evaluate('calls'), 1);
  await a.evaluate('R.rec.loadedAt-=60001;loadRecommendations()');
  assert.equal(a.evaluate('calls'), 2);
});

test('매칭 화면: 이전 로그인에서 시작한 응답은 결과와 로딩 상태를 덮지 않는다', async () => {
  const a = app();
  await a.evaluate(`
    let finish;callFn=()=>new Promise(resolve=>finish=resolve);
    const old=loadRecommendations();backendEpoch++;R.recLoading=true;
    finish(data);old;
  `);
  assert.equal(a.evaluate('MEETINGS.length'), 0);
  assert.equal(a.evaluate('R.recLoading'), true);
});

test('매칭 화면: 요청 중 저장된 프로필이 바뀌면 오래된 순위를 버린다', async () => {
  const a = app();
  await a.evaluate(`
    let finish;callFn=()=>new Promise(resolve=>finish=resolve);
    const old=loadRecommendations();S.profile.interests=['새 관심사'];snapProfile();
    finish(data);old;
  `);
  assert.equal(a.evaluate('MEETINGS.length'), 0);
  assert.equal(a.evaluate('R.recDirty'), true);
  assert.equal(a.evaluate('R.recLoading'), false);
});
