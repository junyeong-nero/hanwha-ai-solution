// 홈 은하계 — 회전하는 궤도 + 아는 사람이 생긴 계열사만 합류
import assert from 'node:assert/strict';
import test from 'node:test';

import { html } from './helpers/source.mjs';
import { loadApp, parsePlanets, minPlanetGap } from './helpers/app-context.mjs';

const TOUCH = 44;           // 터치 타겟 한 변
const WIDTH = 320;          // 375×812 화면에서의 #space 폭
const SUN_R = 25;           // #sun 지름 50px 의 반지름
const DOT_R = 12;          // 번호가 표시된 행성(24px)의 반지름

const render = (app, width = WIDTH) => {
  app.evaluate('renderHome()');
  return parsePlanets(app.el('space').innerHTML, width);
};
// 모든 계열사에 아는 사람을 한 명씩 만들어 은하계를 가득 채운다
const meetEveryone = (app) =>
  app.evaluate(`COMPANIES.forEach((c,i)=>{PEOPLE['x'+i]={real:'테스터'+i,nick:'t'+i,co:c.id,av:'🌙'};S.met['x'+i]=true})`);
const meetOne = (app, company) =>
  app.evaluate(`PEOPLE.p99={real:'테스터',nick:'테스터',co:'${company}',av:'🌙'};S.met.p99=true`);

test('은하계에는 아는 사람이 생긴 계열사와 내 계열사만 떠 있다', () => {
  const app = loadApp();
  // 기본 데모 상태: p1(한화투자증권) · p2(한화솔루션) 을 이미 만났다
  assert.deepEqual(
    render(app)
      .map((p) => p.id)
      .sort(),
    ['inv', 'sol'],
  );

  // 아는 사람이 아무도 없으면 내 계열사 하나만 남는다
  const solo = loadApp();
  solo.evaluate('Object.keys(S.met).forEach(k=>delete S.met[k])');
  assert.deepEqual(render(solo).map((p) => p.id), ['inv']);
});

test('행성을 눌러도 다른 계열사가 열리지 않고 상세 시트만 뜬다', () => {
  const app = loadApp();
  const before = render(app).map((p) => p.id);
  assert.match(app.el('space').innerHTML, /onclick="showCo\(&quot;inv&quot;\)"/);
  assert.equal(app.evaluate('typeof expandHomeCompany'), 'undefined', '탐색으로 계열사를 여는 경로는 없다');

  app.evaluate("showCo('aero')");
  assert.match(app.el('cosheet').innerHTML, /한화에어로스페이스/);
  assert.deepEqual(render(app).map((p) => p.id), before, '시트를 열어도 은하계 구성은 그대로다');
});

test('아는 사람이 생긴 계열사만 합류하고, 그 행성에만 등장 연출이 붙는다', () => {
  const app = loadApp();
  const before = render(app).length;
  meetOne(app, 'yeocheon');

  const after = render(app);
  assert.equal(after.length, before + 1);
  const joined = after.find((p) => p.id === 'yeocheon');
  assert.ok(joined.classes.includes('new'), '새로 합류한 행성만 등장 연출');
  assert.ok(joined.classes.includes('lit'), '만남이 성사된 계열사라 바로 점등된다');
  assert.equal(after.filter((p) => p.classes.includes('new')).length, 1);

  // 등장 연출은 한 번만 — 다시 그리면 new 가 남지 않는다
  assert.equal(render(app).filter((p) => p.classes.includes('new')).length, 0);
});

test('궤도마다 회전 속도가 다르고 시작 각도도 궤도·슬롯마다 어긋난다', () => {
  const app = loadApp();
  app.evaluate('S.homeOrbit.seed=7');
  meetEveryone(app);
  const planets = render(app);
  assert.equal(planets.length, app.evaluate('COMPANIES.length'));

  // 궤도(반지름)와 회전 주기는 1:1 이고, 안쪽 궤도가 더 빠르다
  const rings = [...new Set(planets.map((p) => p.r))].sort((a, b) => a - b);
  assert.equal(rings.length, 3);
  const secsOf = (r) => [...new Set(planets.filter((p) => p.r === r).map((p) => p.secs))];
  const secs = rings.map((r) => {
    const s = secsOf(r);
    assert.equal(s.length, 1, '같은 궤도의 행성은 같은 속도로 돈다');
    return s[0];
  });
  assert.deepEqual(secs, [...secs].sort((a, b) => a - b), '바깥 궤도일수록 한 바퀴가 느리다');
  assert.equal(new Set(secs).size, 3, '궤도마다 속도가 다르다');

  // 같은 궤도 안에서도 시작 각도가 모두 다르고, 궤도 사이 기준 각도도 어긋나 있다
  for (const r of rings) {
    const angles = planets.filter((p) => p.r === r).map((p) => p.angle);
    assert.equal(new Set(angles).size, angles.length, '같은 궤도에서 시작 각도가 겹치지 않는다');
  }
  assert.notEqual(app.evaluate('homeAngle({ring:0,slot:0})'), app.evaluate('homeAngle({ring:1,slot:0})'));
  assert.notEqual(app.evaluate('homeAngle({ring:1,slot:0})'), app.evaluate('homeAngle({ring:2,slot:0})'));
});

test('어떤 세션 시드에서도 회전 중 행성이 겹치거나 화면 밖으로 나가지 않는다', () => {
  for (let seed = 0; seed < 60; seed += 1) {
    const app = loadApp();
    app.evaluate(`S.homeOrbit.seed=${seed}`);
    meetEveryone(app);
    const planets = render(app);
    const where = `seed ${seed}`;
    assert.equal(planets.length, app.evaluate('COMPANIES.length'), where);
    // 궤도 속도가 달라 언젠가는 반경 방향으로 정렬되므로, 그 순간까지 포함해 44px 을 지킨다
    assert.ok(minPlanetGap(planets) >= TOUCH, `${where}: 최소 간격 ${minPlanetGap(planets).toFixed(2)}px`);
    for (const p of planets) {
      assert.ok(p.r + TOUCH / 2 <= WIDTH / 2, `${where}: 44px 터치 영역이 화면 밖으로 나갔다 (r=${p.r})`);
      assert.ok(p.r - DOT_R >= SUN_R, `${where}: 행성이 태양과 겹쳤다 (r=${p.r})`);
    }
  }
});

test('새 계열사가 합류해도 기존 행성의 궤도 자리는 그대로다', () => {
  const app = loadApp();
  const first = render(app);
  meetOne(app, 'yeocheon');
  const kept = render(app).filter((p) => first.some((f) => f.id === p.id));
  assert.deepEqual(
    kept.map((p) => [p.id, p.angle, p.r, p.secs]),
    first.map((p) => [p.id, p.angle, p.r, p.secs]),
  );
});

test('폭이 넓어져도 가장자리 여백은 그대로라 행성이 잘리지 않는다', () => {
  const wide = loadApp({ width: 420 });
  meetEveryone(wide);
  const planets = render(wide, 420);
  assert.ok(minPlanetGap(planets) >= TOUCH);
  for (const p of planets) assert.ok(p.r + TOUCH / 2 <= 210);
});

test('점등 상태·연결 동료 수와 계열사 목록은 기존 데모 흐름대로 반영된다', () => {
  const app = loadApp();
  const planets = render(app);
  assert.equal(planets.filter((p) => p.classes.includes('lit')).length, 2, 'p1(inv)·p2(sol) 계열사가 점등된다');
  assert.match(app.el('spacestats').innerHTML, /2명<\/b><span>연결된 동료/);

  // 계열사 목록에는 아직 은하계 밖인 계열사까지 모두 보인다
  assert.equal(app.el('colist').innerHTML.match(/data-co="/g).length, app.evaluate('COMPANIES.length'));
  assert.match(app.el('colist').innerHTML, /미개척/);
  assert.match(app.el('homehint').innerHTML, /아는 사람이 생긴 계열사/);
});

test('행성 버튼은 44px 터치 타겟과 계열사 라벨을 유지한다', () => {
  assert.match(html, /\.planet\{[^}]*width:44px;height:44px/);
  const app = loadApp();
  app.evaluate('renderHome()');
  assert.match(app.el('space').innerHTML, /aria-label="한화투자증권 · 내 계열사 · 아는 사람 1명"/);
});

test('사용자가 바뀌면(로그아웃) 은하계가 처음 상태로 돌아간다', () => {
  const app = loadApp({ files: ['config.js', 'home.js', 'backend.js'] });
  meetOne(app, 'yeocheon');
  app.evaluate('renderHome()');
  assert.ok(app.evaluate('Object.keys(S.homeOrbit.slots).length') >= 3);

  app.evaluate('clearBackendState()');
  assert.equal(app.evaluate('Object.keys(S.homeOrbit.slots).length'), 0, '앞 사용자의 궤도 배치가 남지 않는다');
  assert.deepEqual(render(app).map((p) => p.id), ['inv'], '아는 사람이 사라지면 내 계열사만 남는다');
});

test('궤도 회전은 시작 각도를 CSS 변수로 받고, prefers-reduced-motion 에서 멈춘다', () => {
  assert.match(html, /\.holder\{[^}]*transform:rotate\(var\(--a,0deg\)\);animation:orb var\(--d\) linear infinite\}/);
  assert.match(html, /@keyframes orb\{from\{transform:rotate\(var\(--a,0deg\)\)\}to\{transform:rotate\(calc\(var\(--a,0deg\) \+ 360deg\)\)\}\}/);
  assert.match(html, /\.planet\.new\{animation:pop/);
  // 회전이 멈춰도 기본 transform 이 시작 각도를 지켜, 행성이 한곳에 겹치지 않는다
  assert.match(html, /@media\(prefers-reduced-motion:reduce\)\{[\s\S]*?\.holder\{animation:none!important\}/);
  assert.match(html, /@media\(prefers-reduced-motion:reduce\)\{[\s\S]*?\.planet\.new,\.orbit\.new\{animation:none/);
});

test('다음 행동은 미완료 첫 단계만 안내하고 전체 단계는 접어 두며 모두 완료하면 사라진다', () => {
  const app = loadApp();
  app.evaluate('S.profile.interests=[];S.profile.hobbies=[];S.joined=[];S.placeRecommendationTried=false');
  const states = [
    ['', '관심사·취미 설정', "go('profile')", 0],
    ["S.profile.interests=['독서']", '어울리는 모임 참가', "go('match')", 1],
    ["S.joined=['m1']", 'AI 장소 추천 기능 써보기', 'tryPlaceRecommendations()', 2],
  ];
  for (const [setup, title, action, done] of states) {
    app.evaluate(setup+';renderHome()');
    const card = app.el('nextcard').innerHTML;
    const [visible, collapsed] = card.split('<details class="next-steps">');
    assert.ok(collapsed, '전체 단계는 기본적으로 닫힌 details 안에 있다');
    assert.ok(visible.includes('<p class="next-action">'+title+'</p>'));
    assert.ok(visible.includes('onclick="'+action+'"'));
    assert.doesNotMatch(visible, /class="ns/);
    assert.ok(collapsed.includes('전체 단계 · '+done+' / 3 완료'));
    assert.ok(collapsed.includes('AI 장소 추천 기능 써보기'));
  }
  app.evaluate('S.placeRecommendationTried=true;renderHome()');
  assert.equal(app.el('nextcard').innerHTML, '');
});

test('행성 번호는 계열사 범례와 일치하고 새 합류·재렌더에도 유지된다', () => {
  const app = loadApp();
  const numbers = () => Object.fromEntries([...app.el('space').innerHTML.matchAll(/data-co="([^"]+)"[^>]*><span class="dot" aria-hidden="true">(\d+)<\/span>/g)].map(m => [m[1], m[2]]));
  render(app);
  const before = numbers();
  assert.equal(Object.keys(before).length, 2);
  meetEveryone(app);
  render(app);
  const after = numbers();
  assert.equal(Object.keys(after).length, app.evaluate('COMPANIES.length'));
  assert.equal(new Set(Object.values(after)).size, Object.keys(after).length);
  for (const [id, number] of Object.entries(before)) assert.equal(after[id], number);
  for (const [id, number] of Object.entries(after)) {
    const row = app.el('colist').innerHTML.match(new RegExp('data-co="'+id+'">([\\s\\S]*?)</button>'))[1];
    assert.ok(row.includes('aria-hidden="true">'+number+'</span>'));
  }
  render(app);
  assert.deepEqual(numbers(), after);

  app.evaluate('S.met={}');
  render(app);
  assert.deepEqual(Object.keys(numbers()), ['inv']);
  const inactive = app.el('colist').innerHTML.match(/data-co="sol">([\s\S]*?)<\/button>/)[1];
  assert.ok(inactive.includes('aria-hidden="true"></span>'), '은하계 밖 계열사는 번호가 없다');
});
