import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  MIN_NODE_MAJOR,
  isSupportedNode,
  checkNodeVersion,
} from '../scripts/check-node-version.mjs';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('테스트 실행에 필요한 Node.js 최소 버전을 프로젝트 설정에 명시한다', () => {
  assert.equal(MIN_NODE_MAJOR, 24);
  assert.equal(packageJson.engines.node, '>=24.0.0');
  const testCommand = packageJson.scripts.test;
  const guardIndex = testCommand.indexOf('node scripts/check-node-version.mjs');
  const runnerIndex = testCommand.indexOf('node --test tests/*.mjs');
  assert.notEqual(guardIndex, -1);
  assert.notEqual(runnerIndex, -1);
  assert.ok(guardIndex < runnerIndex, 'Node 버전 검사가 테스트 실행보다 먼저 와야 합니다');
  assert.match(testCommand.slice(guardIndex), /check-node-version\.mjs\s+&&/);
});

test('Node.js 24 미만은 한국어 안내와 함께 거부한다', () => {
  assert.equal(isSupportedNode('22.17.0'), false);
  assert.equal(isSupportedNode('24.0.0'), true);
  assert.equal(checkNodeVersion('22.17.0'), 'Node.js 24 이상이 필요합니다. 현재 버전: 22.17.0');
  assert.equal(checkNodeVersion('24.20.0'), null);
});
