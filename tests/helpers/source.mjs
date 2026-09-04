// src/ 는 index.html · styles.css · js/*.js 로 나뉘어 있다.
// 테스트는 앱 전체를 하나의 소스로 보고 검사하므로, 여기서 <link> 와 <script src> 를
// 실제 파일 내용으로 인라인해 브라우저가 로드하는 것과 같은 순서의 단일 문자열을 만든다.
// (분리된 파일들이 원래의 단일 파일로 다시 조립된다는 것 자체가 회귀 검사가 된다.)
import fs from 'node:fs';

const srcDir = new URL('../../src/', import.meta.url);

const read = (relativePath) => fs.readFileSync(new URL(relativePath, srcDir), 'utf8');

const inlineAssets = (indexHtml) =>
  indexHtml
    .replace(
      /<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/g,
      (_, href) => `<style>\n${read(href)}</style>`,
    )
    .replace(
      /<script\s+src="([^"]+)"\s*><\/script>/g,
      (_, src) => `<script>\n${read(src)}</script>`,
    );

/** 브라우저가 실제로 로드하는 순서대로 조립한 앱 전체 소스 */
export const html = inlineAssets(read('index.html'));
