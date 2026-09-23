#!/usr/bin/env node
/**
 * animated-lesson · scripts/check-links.mjs
 *
 * 文档会腐烂：改了文件名，README 里那条链接就悄悄死了。
 * 这个脚本扫所有 .html / .md 里的**本地**链接与图片，逐个查文件是否存在。
 *
 *   node scripts/check-links.mjs
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const C = { red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` };
const SKIP = new Set(['node_modules', '.git', 'out']);

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(html|md)$/.test(e)) out.push(p);
  }
  return out;
}

let files = 0, links = 0;
const bad = [];
for (const file of walk(ROOT)) {
  files++;
  const text = readFileSync(file, 'utf8');
  const found = [
    ...text.matchAll(/(?:href|src)\s*=\s*"([^"]+)"/g),       // html
    ...text.matchAll(/\]\(([^)\s]+)\)/g),                     // markdown
    ...text.matchAll(/<((?:\.{1,2}\/)[^\s>]+\.(?:mp4|png|jpg))>/g), // <./x.mp4>
  ];
  for (const m of found) {
    const raw = m[1];
    if (/^(https?:|mailto:|#|data:|\/)/.test(raw)) continue;  // 外链/锚点/绝对路径不管
    const clean = raw.split('#')[0].split('?')[0];
    if (!clean) continue;
    links++;
    const target = resolve(dirname(file), clean);
    if (!existsSync(target)) bad.push(`${relative(ROOT, file)}  →  ${raw}`);
  }
}

console.log(`\n${C.bold('▶ 本地链接检查')}  ${files} 个文件 · ${links} 条本地链接`);
if (bad.length) {
  for (const b of bad) console.log(C.red('  ✗ ') + b);
  console.log(C.red(`\n${bad.length} 条坏链\n`));
} else {
  console.log(C.green('  ✓ 全部可达\n'));
}
process.exit(bad.length ? 1 : 0);
