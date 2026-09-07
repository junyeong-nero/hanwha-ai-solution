// 홈 태양계 — 점진 탐색형 계열사 관계 그래프 (#29)
import assert from 'node:assert/strict';
import test from 'node:test';

import { html } from './helpers/source.mjs';
import { loadApp, parsePlanets, minPlanetGap } from './helpers/app-context.mjs';

const TOUCH = 44;           // 터치 타겟 한 변
const MIN_GAP = 39.9;       // 행성 사이 최소 중심 거리(px, 320px 기준) — home.js 의 HOME_MIN_GAP
const WIDTH = 320;          // 375×812 화면에서의 #space 폭

const render = (app) => {
  app.evaluate('renderHome()');
  return parsePlanets(app.el('space').innerHTML, WIDTH);
};
const revealAll = (app) =>
  app.evaluate('for(let i=0;i<60;i++)COMPANIES.forEach(c=>{if(S.homeGraph.shown.has(c.id))expandHomeCompany(c.id)})');

test('최초 진입 화면에는 주요 계열사 10곳만 나타난다', () => {
  const app = loadApp();
  assert.equal(app.evaluate('HOME_CORE_IDS.length'), 10);
  assert.equal(app.evaluate('COMPANIES.length > HOME_CORE_IDS.length'), true);
  assert.equal(render(app).length, 10);
});

test('계열사 관계는 양방향이고, 주요 계열사에서 모든 계열사에 닿는다', () => {
  const app = loadApp();
  // 링크에 적힌 id 는 모두 실제 계열사여야 한다
  assert.equal(
    app.evaluate(`JSON.stringify(Object.keys(COMPANY_LINKS)
      .flatMap(a=>COMPANY_LINKS[a].concat(a))
      .filter(id=>!COMPANIES.some(c=>c.id===id)))`),
    '[]',
  );
  // 한쪽에만 적어도 양방향으로 펼쳐진다
  assert.equal(app.evaluate("linkedCompanies('vision').includes('aero')"), true);
  assert.equal(app.evaluate("linkedCompanies('aero').includes('vision')"), true);
  // 탐색만으로 모든 계열사에 도달할 수 있어야 남는 행성이 없다
  revealAll(app);
  assert.equal(app.evaluate('S.homeGraph.shown.size'), app.evaluate('COMPANIES.length'));
});

test('계열사를 탐색하면 관계가 있는 미노출 계열사가 등장 애니메이션과 함께 추가된다', () => {
  const app = loadApp();
  const before = render(app).length;
  const added = app.evaluate("expandHomeCompany('aero')");
  assert.equal(added.length, 2, '한 번에 두 곳씩 열린다');
  assert.equal(app.evaluate("linkedCompanies('aero').includes(" + JSON.stringify(added[0]) + ')'), true);

  const after = render(app);
  assert.equal(after.length, before + 2);
  assert.equal(after.filter((p) => p.classes.includes('new')).length, 2, '새 행성에만 등장 애니메이션이 붙는다');
  assert.match(app.el('space').innerHTML, /<line class="link new"/);

  // 등장 연출은 한 번만 — 다시 그리면 new 가 남지 않는다
  assert.equal(render(app).filter((p) => p.classes.includes('new')).length, 0);
});

test('재렌더링만으로는 기존 행성 위치가 흔들리지 않는다', () => {
  const app = loadApp();
  const first = render(app);
  app.evaluate("expandHomeCompany('life')");
  const second = render(app).slice(0, first.length);
  assert.deepEqual(
    second.map((p) => [p.xPercent, p.yPercent]),
    first.map((p) => [p.xPercent, p.yPercent]),
  );
});

test('어떤 세션 시드에서도 행성이 겹치거나 화면 밖으로 잘리지 않는다', () => {
  for (let seed = 0; seed < 60; seed += 1) {
    const app = loadApp();
    app.evaluate(`S.homeGraph.seed=${seed}`);
    revealAll(app);
    const planets = render(app);
    assert.equal(planets.length, app.evaluate('COMPANIES.length'), `seed ${seed}`);
    assert.ok(minPlanetGap(planets) >= MIN_GAP, `seed ${seed}: 최소 간격 ${minPlanetGap(planets).toFixed(1)}px`);
    for (const p of planets) {
      const inside = [p.x, p.y].every((v) => v >= TOUCH / 2 && v <= WIDTH - TOUCH / 2);
      assert.ok(inside, `seed ${seed}: 44px 터치 영역이 화면 밖으로 나갔다 (${p.x}, ${p.y})`);
    }
  }
});

test('폭이 넓어져도 가장자리 여백은 그대로라 행성이 잘리지 않는다', () => {
  const wide = loadApp({ width: 420 });
  wide.evaluate('renderHome()');
  for (const p of parsePlanets(wide.el('space').innerHTML, 420)) {
    assert.ok(p.x >= TOUCH / 2 && p.x <= 420 - TOUCH / 2 && p.y >= TOUCH / 2 && p.y <= 420 - TOUCH / 2);
  }
});

test('점등 상태와 연결 동료 수는 기존 데모 흐름대로 반영된다', () => {
  const app = loadApp();
  app.evaluate("S.met.p1=true;S.met.p2=true;renderHome()");
  const lit = parsePlanets(app.el('space').innerHTML).filter((p) => p.classes.includes('lit'));
  assert.equal(lit.length, 2, 'p1(inv)·p2(sol) 계열사가 점등된다');
  assert.match(app.el('spacestats').innerHTML, /2명<\/b><span>연결된 동료/);

  // 초기 목록 밖 계열사에서 만남이 성사돼도 그 행성은 항상 보인다
  const app2 = loadApp();
  app2.evaluate("PEOPLE.p99={real:'테스터',nick:'테스터',co:'yeocheon',av:'🌙'};S.met.p99=true");
  assert.equal(app2.evaluate("visibleCompanies().some(c=>c.id==='yeocheon')"), true);
  assert.equal(render(app2).length, 11, '주요 10곳 + 점등된 여천NCC');
});

test('행성 버튼은 44px 터치 타겟과 탐색 라벨을 유지한다', () => {
  assert.match(html, /\.planet\{[^}]*width:44px;height:44px/);
  const app = loadApp();
  app.evaluate('renderHome()');
  assert.match(app.el('space').innerHTML, /onclick="tapCo\(&quot;aero&quot;\)"/);
  assert.match(app.el('space').innerHTML, /aria-label="한화에어로스페이스 · 이어진 계열사 \d곳 더 보기"/);
});

test('확장 연출은 prefers-reduced-motion 에서 제거된다', () => {
  assert.match(html, /\.planet\.new\{animation:pop/);
  assert.match(html, /\.link\.new\{animation:draw/);
  assert.match(
    html,
    /@media\(prefers-reduced-motion:reduce\)\{[\s\S]*\.planet\.new,\.orbit\.new,\.link\.new\{animation:none/,
  );
});
