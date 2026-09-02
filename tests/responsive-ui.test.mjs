import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');

test('responsive layout defines tablet and desktop breakpoints', () => {
  assert.match(html, /@media\s*\(min-width:\s*600px\)/);
  assert.match(html, /@media\s*\(min-width:\s*900px\)/);
});

test('intermediate device widths use the available frame width', () => {
  assert.match(html, /@media\s*\(min-width:\s*431px\)\s*and\s*\(max-width:\s*599px\)[\s\S]*#app[\s\S]*max-width:\s*520px/);
});

test('desktop layout expands the app frame and uses a side navigation rail', () => {
  assert.match(html, /@media\s*\(min-width:\s*900px\)[\s\S]*#app[\s\S]*max-width:\s*1280px/);
  assert.match(html, /@media\s*\(min-width:\s*900px\)[\s\S]*nav#nav[\s\S]*flex-direction:\s*column/);
});

test('wide layouts provide multi-column content and bounded overlays', () => {
  assert.match(html, /@media\s*\(min-width:\s*600px\)[\s\S]*\.spacestats[\s\S]*grid-template-columns/);
  assert.match(html, /@media\s*\(min-width:\s*600px\)[\s\S]*\.meetgrid[\s\S]*grid-template-columns/);
  assert.match(html, /@media\s*\(min-width:\s*900px\)[\s\S]*\.sheet[\s\S]*max-width:\s*640px/);
});
