// src/js/*.js 는 ES 모듈이 아니라 전역 스코프를 공유하는 일반 스크립트다.
// 브라우저와 같은 방식(같은 전역에 순서대로 로드)으로 실행해 홈 그래프의 실제 배치 결과를
// 검사할 수 있도록, 최소한의 DOM 스텁만 둔 vm 컨텍스트를 만든다.
import fs from 'node:fs';
import vm from 'node:vm';

const srcDir = new URL('../../src/js/', import.meta.url);

const stubElement = (width) => ({
  innerHTML: '',
  textContent: '',
  clientWidth: width,
  classList: { add() {}, remove() {} },
});

/**
 * @param {object} options
 * @param {string[]} options.files  src/js 안에서 로드 순서대로 실행할 파일
 * @param {number} options.width    #space 의 clientWidth (기본 375×812 화면의 320px)
 */
export function loadApp({ files = ['config.js', 'home.js'], width = 320 } = {}) {
  const els = new Map();
  const document = {
    getElementById(id) {
      if (!els.has(id)) els.set(id, stubElement(width));
      return els.get(id);
    },
  };
  const context = vm.createContext({ document, window: {}, console });
  for (const file of files) {
    vm.runInContext(fs.readFileSync(new URL(file, srcDir), 'utf8'), context, { filename: file });
  }
  // const 선언은 컨텍스트 객체에 붙지 않으므로, 평가로 꺼내 쓴다.
  const evaluate = (code) => vm.runInContext(code, context);
  return { evaluate, el: (id) => document.getElementById(id) };
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
