// 게임 전체를 외부 파일 없이 한 장의 HTML 조각으로 묶는다 (dist/warline.html)
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  outdir: 'dist',
  define: { 'import.meta.env.DEV': 'false' },
  legalComments: 'none',
});
const js = out.outputFiles.find((f) => f.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script');
const css = out.outputFiles.find((f) => f.path.endsWith('.css')).text;
const html = `<title>WarLine</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=Saira+Condensed:wght@500;600;700;800&display=swap">
<style>${css}</style>
<div id="app"><div id="screen"></div></div>
<script>${js}</script>
`;
mkdirSync('dist', { recursive: true });
writeFileSync('dist/warline.html', html);
console.log(`dist/warline.html ${(html.length / 1024).toFixed(0)} KB`);
