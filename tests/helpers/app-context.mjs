// src/js/*.js 는 ES 모듈이 아니라 전역 스코프를 공유하는 일반 스크립트다.
// 브라우저와 같은 방식(같은 전역에 순서대로 로드)으로 실행해 홈 은하계의 실제 궤도 배치를
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
export function loadApp({ files = ['config.js', 'home.js'], width = 320, globals = {} } = {}) {
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
  const context = vm.createContext({ document, window: {}, console, ...globals });
  for (const file of files) {
    vm.runInContext(fs.readFileSync(new URL(file, srcDir), 'utf8'), context, { filename: file });
  }
  // const 선언은 컨텍스트 객체에 붙지 않으므로, 평가로 꺼내 쓴다.
  const evaluate = (code) => vm.runInContext(code, context);
  return { evaluate, el: (id) => document.getElementById(id), focused };
}

/**
 * #space 에 그려진 행성들을 궤도 정보와 함께 파싱한다.
 * 행성은 회전하는 .holder 안에 있으므로, 시작 각도(--a)·회전 주기(--d)·반지름(left)이 위치를 정한다.
 * x·y 는 시작 각도(회전 0초 시점)에서의 중심 좌표(px).
 */
export function parsePlanets(spaceHtml, width = 320) {
  const re = /<div class="holder" style="--a:([\d.]+)deg;--d:([\d.]+)s"><button class="planet ([^"]*)"[^>]*left:([\d.]+)px;top:0"[^>]*data-co="([^"]+)"/g;
  return [...spaceHtml.matchAll(re)].map((m) => {
    const angle = Number(m[1]);
    const r = Number(m[4]);
    const rad = (angle * Math.PI) / 180;
    return {
      angle,
      secs: Number(m[2]),
      classes: m[3].trim().split(/\s+/),
      r,
      id: m[5],
      x: width / 2 + r * Math.cos(rad),
      y: width / 2 + r * Math.sin(rad),
    };
  });
}

/**
 * 회전하는 동안 두 행성이 가장 가까워지는 순간의 중심 거리(px).
 * 같은 궤도(같은 주기)면 각도 차가 고정이라 거리도 그대로고,
 * 주기가 다르면 각도 차가 언젠가 0이 되므로 최솟값은 반지름 차가 된다.
 */
export function minPlanetGap(planets) {
  let min = Infinity;
  for (let i = 0; i < planets.length; i += 1) {
    for (let j = i + 1; j < planets.length; j += 1) {
      const a = planets[i];
      const b = planets[j];
      min = Math.min(min, a.secs === b.secs ? Math.hypot(a.x - b.x, a.y - b.y) : Math.abs(a.r - b.r));
    }
  }
  return min;
}
