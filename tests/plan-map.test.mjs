// 후보 장소 지도 · 목록 (이슈 #34)
// src/js/map.js 를 브라우저와 같은 전역에서 실행해, 좌표 배치와 목록↔지도 선택 동기화를 검사한다.
// 카카오맵 SDK 는 테스트 환경에 없으므로 placeholder 경로(CONFIG.KAKAO_JS_KEY 없음)를 쓴다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { loadApp } from './helpers/app-context.mjs';
import { html } from './helpers/source.mjs';

const indexHtml = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');

/** vm 컨텍스트(다른 realm)의 객체를 이 realm 의 값으로 옮긴다 */
const json = (value) => JSON.parse(JSON.stringify(value));

/** config.js(데이터·esc·safeUrl) + map.js 를 같은 전역에 올린다 */
function loadMap({ cands = null, planId = 'local-m1' } = {}) {
  const app = loadApp({ files: ['config.js', 'map.js'] });
  const { evaluate } = app;
  // chat.js 가 갖고 있는 전역(CUR · 방 상태)만 최소로 흉내 낸다
  evaluate('var CUR="m1"');
  evaluate(`S.rooms.m1={msgs:[{f:"ai",planId:${JSON.stringify(planId)},plan:{cands:${JSON.stringify(cands ?? null)}||PLAN_CANDS.m1}}],unread:0,votes:{},attended:new Set(),photos:[]}`);
  return app;
}

test('로컬 데모 후보지는 지도에 올릴 수 있는 모양이다 (장소 ID·좌표·상세 링크)', () => {
  const { evaluate } = loadMap();
  const all = evaluate('Object.values(PLAN_CANDS).flat()');
  assert.ok(all.length >= 14);
  for (const c of all) {
    assert.ok(c.id, `${c.name} 에 장소 ID가 없습니다`);
    assert.equal(typeof c.lat, 'number');
    assert.equal(typeof c.lng, 'number');
    assert.ok(c.lat > 33 && c.lat < 39.5, `${c.name} 위도 범위`);
    assert.ok(c.lng > 124 && c.lng < 132, `${c.name} 경도 범위`);
    assert.match(c.url, /^https:\/\/map\.kakao\.com\//);
    assert.ok(c.address && c.category);
  }
});

test('pinLayout: 좌표가 있는 후보만 화면 안 상대 위치로 환산한다 (위도가 크면 위쪽)', () => {
  const { evaluate } = loadMap();
  const pins = evaluate(`pinLayout([
    {name:'남쪽',lat:37.30,lng:127.10},
    {name:'좌표 없음'},
    {name:'북동쪽',lat:37.40,lng:127.20}
  ])`);
  assert.deepEqual(json(pins).map((p) => p.i), [0, 2]);
  for (const p of pins) {
    assert.ok(p.x >= 0 && p.x <= 100, '가로로 화면 밖에 나가지 않는다');
    assert.ok(p.y >= 0 && p.y <= 72, '아래쪽 설명 띠를 가리지 않는다');
  }
  assert.ok(pins[1].y < pins[0].y, '위도가 큰 후보가 위쪽에 놓인다');
  assert.ok(pins[1].x > pins[0].x, '경도가 큰 후보가 오른쪽에 놓인다');
});

test('pinLayout: 좌표가 하나뿐이거나 모두 같으면 가운데에 둔다', () => {
  const { evaluate } = loadMap();
  assert.deepEqual(json(evaluate('pinLayout([{lat:37.4,lng:127.1}])')), [{ i: 0, x: 50, y: 39 }]);
  assert.deepEqual(json(evaluate('pinLayout([{lat:37.4,lng:127.1},{lat:37.4,lng:127.1}])')).map((p) => p.x), [50, 50]);
  assert.deepEqual(json(evaluate('pinLayout([])')), []);
  assert.deepEqual(json(evaluate('pinLayout(null)')), []);
});

test('지도 placeholder 는 후보 수·선택한 후보를 보여 준다 (SDK 키가 없을 때)', () => {
  const { evaluate } = loadMap();
  assert.equal(evaluate('mapsEnabled()'), false, '키가 없으면 SDK 를 쓰지 않는다');
  const markup = evaluate("planMapHtml('local-m1',PLAN_CANDS.m1)");
  assert.ok(markup.includes('class="planmap ph"'));
  assert.ok(markup.includes('후보 3곳'));
  assert.ok(markup.includes('판교 화랑공원'));
  assert.equal((markup.match(/class="pin/g) || []).length, 3);
  assert.ok(markup.includes('aria-pressed="true"'), '선택된 Marker 상태를 알린다');
});

test('후보 목록은 선택 상태·분류·상세 링크를 보여 주고 javascript: 링크를 막는다', () => {
  const { evaluate } = loadMap();
  const list = evaluate("candListHtml('local-m1',PLAN_CANDS.m1,false)");
  assert.ok(list.includes('id="cand-local-m1-0"'));
  assert.ok(list.includes('class="cand on"'), '첫 후보가 선택된 상태로 시작한다');
  assert.ok(list.includes('이 장소로 정하기'));
  assert.ok(list.includes('상세 ↗'));

  // 확정된 약속에는 장소 선택 버튼을 내리고, 안전하지 않은 링크는 아예 그리지 않는다
  const done = evaluate("candListHtml('local-m1',[{name:'나쁜 링크',url:'javascript:alert(1)',why:'x'}],true)");
  assert.ok(!done.includes('이 장소로 정하기'));
  assert.ok(!done.includes('javascript:'));
  assert.ok(!done.includes('상세 ↗'));

  const unverified = evaluate("candListHtml('p',[{name:'확인 못한 곳',verified:false},{name:'같은 이름',ambiguous:true}],false)");
  assert.ok(unverified.includes('검색 미확인'));
  assert.ok(unverified.includes('같은 이름 여러 곳'));
});

test('selectCand: 목록 카드와 지도 Marker 선택이 함께 바뀐다', () => {
  const app = loadMap();
  const { evaluate, el } = app;
  // 렌더 결과를 대신할 요소를 준비한다 (chat.js 의 renderMsgs 가 만드는 id 와 같은 규칙)
  evaluate("$('pm-local-m1').classList.add('ph')");
  evaluate("$('cand-local-m1-0');$('cand-local-m1-1');$('cand-local-m1-2')");

  evaluate('selectCand("local-m1",2)');
  assert.equal(evaluate('selIdx("local-m1")'), 2);
  assert.equal(el('cand-local-m1-0').classList.contains('on'), false);
  assert.equal(el('cand-local-m1-2').classList.contains('on'), true);
  assert.ok(el('cand-local-m1-2').scrolled > 0, '선택한 카드가 보이도록 스크롤한다');
  const map = el('pm-local-m1').innerHTML;
  assert.ok(map.includes('탄천 산책로 판교 구간'), '지도 설명도 선택한 후보로 바뀐다');
  assert.ok(map.includes('class="pin on"'));

  // 없는 후보를 고르면 선택이 바뀌지 않는다
  evaluate('selectCand("local-m1",9)');
  assert.equal(evaluate('selIdx("local-m1")'), 2);
});

test('검색 상태 안내: 결과 없음은 대체 검색어를, 할당량 초과·오류는 이유를 알린다', () => {
  const { evaluate } = loadMap();
  const empty = evaluate("searchNoteHtml({status:'empty',alternatives:['판교 카페','판교 맛집']})");
  assert.ok(empty.includes('검색 결과가 없어요'));
  assert.ok(empty.includes('판교 카페'));
  assert.ok(evaluate("searchNoteHtml({status:'quota'})").includes('할당량'));
  assert.ok(evaluate("searchNoteHtml({status:'auth'})").includes('키 설정'));
  assert.ok(evaluate("searchNoteHtml({status:'error'})").includes('실패'));
  assert.equal(evaluate("searchNoteHtml({status:'ok'})"), '');
  assert.equal(evaluate('searchNoteHtml(null)'), '');
});

test('지도·후보 마크업은 이스케이프를 거치고 좌표가 없으면 지도를 그리지 않는다', () => {
  const { evaluate } = loadMap();
  const evil = "[{name:'<img src=x onerror=alert(1)>',address:'\"',why:'<b>',lat:37.4,lng:127.1}]";
  const markup = evaluate(`planMapHtml('p',${evil})+candListHtml('p',${evil},false)`);
  assert.ok(!markup.includes('<img src=x'));
  assert.ok(markup.includes('&lt;img'));
  assert.equal(evaluate("planMapHtml('p',[{name:'좌표 없음'}])"), '', '좌표가 없으면 지도를 생략한다');
});

/* ===== 마크업·스타일 계약 ===== */

test('map.js 는 chat.js 다음에 로드되고 서버 전용 키를 쓰지 않는다', () => {
  const order = ['js/chat.js', 'js/map.js', 'js/backend.js'].map((src) => indexHtml.indexOf(src));
  assert.ok(order.every((i) => i >= 0), 'index.html 에 map.js 가 등록돼 있다');
  assert.ok(order[0] < order[1] && order[1] < order[2], '로드 순서: chat → map → backend');
  assert.doesNotMatch(html, /KAKAO_REST_KEY\s*[:=]/, '서버 전용 REST 키 값은 브라우저에 없다');
  assert.doesNotMatch(html, /KakaoAK/, '브라우저는 장소 검색 REST API 를 직접 부르지 않는다');
  assert.match(html, /KAKAO_JS_KEY:''/, '공개 JS 키 자리는 비어 있고 배포 시에만 채운다');
  assert.match(html, /dapi\.kakao\.com\/v2\/maps\/sdk\.js\?autoload=false&appkey=/, '지도 SDK 는 공개 키로만 부른다');
});

test('후보 카드·Marker 는 44px 터치 타겟을 지킨다', () => {
  assert.match(html, /\.plan \.cand \.pick\{[^}]*min-height:44px/);
  assert.match(html, /\.cand \.detail\{[^}]*min-height:44px/);
  assert.match(html, /\.plan \.pickbtn\{[^}]*min-height:44px/);
  assert.match(html, /\.plan \.planmap \.pin\{[^}]*width:44px;height:44px/);
});
