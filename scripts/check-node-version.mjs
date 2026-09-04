import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIN_NODE_MAJOR = 24;

export function isSupportedNode(version) {
  const major = Number.parseInt(String(version).split('.')[0], 10);
  return Number.isInteger(major) && major >= MIN_NODE_MAJOR;
}

export function checkNodeVersion(version) {
  if (isSupportedNode(version)) return null;
  return `Node.js ${MIN_NODE_MAJOR} 이상이 필요합니다. 현재 버전: ${version}`;
}

export function main(version = process.versions.node) {
  const error = checkNodeVersion(version);
  if (error) {
    console.error(error);
    return 1;
  }
  return 0;
}

const scriptPath = process.argv[1] && path.resolve(process.argv[1]);
if (scriptPath === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
