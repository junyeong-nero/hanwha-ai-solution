import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');

test('responsive layout defines mobile, web, and pc ranges', () => {
  assert.match(html, /@media\s*\(max-width:\s*599px\)/);
  assert.match(html, /@media\s*\(min-width:\s*600px\)\s*and\s*\(max-width:\s*1023px\)/);
  assert.match(html, /@media\s*\(min-width:\s*1024px\)/);
});

test('intermediate device widths use the available frame width', () => {
  assert.match(html, /@media\s*\(max-width:\s*599px\)[\s\S]*#app[\s\S]*max-width:\s*520px/);
  assert.match(html, /@media\s*\(max-width:\s*430px\)[\s\S]*\.tabpane[\s\S]*padding-left:\s*18px/);
});

test('pc layout expands the app frame and uses a side navigation rail', () => {
  assert.match(html, /@media\s*\(min-width:\s*1024px\)[\s\S]*#app[\s\S]*max-width:\s*1440px/);
  assert.match(html, /@media\s*\(min-width:\s*1024px\)[\s\S]*nav#nav[\s\S]*flex-direction:\s*column/);
});

test('web layout provides two columns and pc overlays stay bounded', () => {
  assert.match(html, /@media\s*\(min-width:\s*600px\)\s*and\s*\(max-width:\s*1023px\)[\s\S]*\.spacestats[\s\S]*grid-template-columns/);
  assert.match(html, /@media\s*\(min-width:\s*600px\)\s*and\s*\(max-width:\s*1023px\)[\s\S]*\.meetgrid[\s\S]*grid-template-columns:\s*repeat\(2\s*,/);
  assert.match(html, /@media\s*\(min-width:\s*1024px\)[\s\S]*\.sheet[\s\S]*max-width:\s*640px/);
});

test('홈 행성 배치는 계열사 수가 늘어나도 우주 영역 안에 들어온다', () => {
  assert.doesNotMatch(html, /const r=44\+i\*15\.6/);
  assert.match(html, /Math\.ceil\(Math\.sqrt\(COMPANIES\.length\)\)/);
  assert.match(html, /clientWidth/);
});
