// src/js/*.js 는 ES 모듈이 아니라 전역 스코프를 공유하는 일반 스크립트다.
// 브라우저와 같은 방식(같은 전역에 순서대로 로드)으로 실행해 홈 그래프의 실제 배치 결과를
// 검사할 수 있도록, 최소한의 DOM 스텁만 둔 vm 컨텍스트를 만든다.
import fs from 'node:fs';
import vm from 'node:vm';

const srcDir = new URL('../../src/js/', import.meta.url);

/** 브라우저 요소의 최소 흉내 — 클래스·속성·innerHTML 만 실제로 기억한다 */
const stubElement = (width) => {
  const classes = new Set();
  const attrs = new Map();
  return {
    innerHTML: '',
    textContent: '',
    clientWidth: width,
    style: {},
    scrolled: 0,
    classList: {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      contains: (n) => classes.has(n),
      toggle: (n, on) => (on === undefined ? (classes.has(n) ? classes.delete(n) : classes.add(n)) : on ? classes.add(n) : classes.delete(n)),
    },
    setAttribute: (k, v) => attrs.set(k, String(v)),
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    querySelector: () => null,
    scrollIntoView() { this.scrolled += 1; },
  };
};

/**
 * @param {object} options
 * @param {string[]} options.files  src/js 안에서 로드 순서대로 실행할 파일
 * @param {number} options.width    #space 의 clientWidth (기본 375×812 화면의 320px)
 */
export function loadApp({ files = ['config.js', 'home.js'], width = 320 } = {}) {
  const els = new Map();
  const focused = [];
  const document = {
    activeElement: null,
    getElementById(id) {
      if (!els.has(id)) els.set(id, stubElement(width));
      return els.get(id);
    },
    // 포커스 복원만 확인하면 되므로, 선택자를 그대로 기억하는 가짜 요소를 돌려준다
    querySelector(selector) {
      return { focus: () => focused.push(selector) };
    },
    // 카카오맵 SDK를 쓰지 않는 테스트에서는 지도 컨테이너가 없다
    querySelectorAll() {
      return [];
    },
  };
  const context = vm.createContext({ document, window: {}, console });
  for (const file of files) {
    vm.runInContext(fs.readFileSync(new URL(file, srcDir), 'utf8'), context, { filename: file });
  }
  // const 선언은 컨텍스트 객체에 붙지 않으므로, 평가로 꺼내 쓴다.
  const evaluate = (code) => vm.runInContext(code, context);
  return { evaluate, el: (id) => document.getElementById(id), focused };
}

/** #space 에 그려진 행성들을 {id 없는} 좌표·클래스 목록으로 파싱한다 */
export function parsePlanets(spaceHtml, width = 320) {
  return [...spaceHtml.matchAll(/<button class="planet ([^"]*)"[^>]*left:([\d.]+)%;top:([\d.]+)%"/g)].map((m) => ({
    classes: m[1].trim().split(/\s+/),
    xPercent: Number(m[2]),
    yPercent: Number(m[3]),
    x: (Number(m[2]) / 100) * width,
    y: (Number(m[3]) / 100) * width,
  }));
}

/** 두 행성 사이 최소 중심 거리(px) */
export function minPlanetGap(planets) {
  let min = Infinity;
  for (let i = 0; i < planets.length; i += 1) {
    for (let j = i + 1; j < planets.length; j += 1) {
      min = Math.min(min, Math.hypot(planets[i].x - planets[j].x, planets[i].y - planets[j].y));
    }
  }
  return min;
}
