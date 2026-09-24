/**
 * scripts/gate-selftest.mjs — 负向测试：证明门禁真的会失败
 *
 * 纪律：「一个不会失败的门禁不是门禁。」
 *
 * G2b / G14 / G13 都是被真实事故逼出来的，但"曾经报过红"只存在于开发者的记忆里。
 * 这个脚本把这件事变成可重复的断言：临时造一份**故意写坏**的课件，
 * 跑 verify，要求指定的门禁必须报 ✗。造完即删。
 *
 * 用法：
 *   node scripts/gate-selftest.mjs              # 跑全部负向用例
 *   node scripts/gate-selftest.mjs --case=overlap
 *   ./scripts/check-all.sh                      # 已包含这一步
 *
 * 为什么值得花这 40 秒：如果哪天重构把 G14 的判据写空了，
 * 正向测试（7 份课件全绿）**依然会全绿** —— 只有负向测试会红。
 */

import { spawn } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', z: '\x1b[0m' };

const only = (process.argv.find((a) => a.startsWith('--case=')) ?? '').split('=')[1];

// ---------------------------------------------------------------- 造坏课件
// 每份坏课件只坏一处 —— 一处坏了却报出三个门禁，说明门禁之间有重叠，
// 那也是要修的信息（这里先只看"该报的报了没有"）。
const CASES = [
  {
    name: 'overlap',
    why: '两个元素画在一起（手填 y 的经典事故）',
    expect: ['G14'],
    file: (extra) => `export const deck = {
  meta: { title: '负向测试：元素相交', theme: 'ink' },
  scenes: [{
    id: 'bad', title: '故意重叠', duration: 8,
    elements: [
      { id: 'k', type: 'text', role: 'kicker', text: '负向测试', x: 6, y: 5, w: 60 },
      { id: 't', type: 'text', role: 'title', text: '这一行会压住下面那一行，而且我实际占的高度比你以为的多', x: 6, y: 10, w: 80, size: 34 },
      { id: 'u', type: 'text', role: 'body', text: '我被硬放在 y:12 —— 上面那行在 y:10 就开始了，它有两行高，所以必然压住我。', x: 6, y: 12, w: 80, size: 17 },
    ],
    beats: [
      { at: 0.3, action: 'reveal', target: ['k', 't', 'u'], dur: 0.4 },
      { at: 1.0, action: 'speak', text: '故意重叠，用来验证 G14 会报红。' },
    ],
  }],
};
export const PROVENANCE = [{ claim: '负向测试夹具', source: 'scripts/gate-selftest.mjs' }];
${extra}`,
  },
  {
    name: 'box-overflow',
    why: '声明 h 太小，内容画到盒外（metric 溢出的原始事故）',
    expect: ['G2b'],
    file: (extra) => `export const deck = {
  meta: { title: '负向测试：内容超出声明盒', theme: 'ink' },
  scenes: [{
    id: 'bad', title: '故意溢出', duration: 8,
    elements: [
      { id: 'k', type: 'text', role: 'kicker', text: '负向测试', x: 6, y: 5, w: 60 },
      { id: 'm', type: 'metric', value: 20.31, unit: '%', label: '一个很长的标签，长到会换行再换行', x: 6, y: 14, w: 22, h: 4, decimals: 2 },
    ],
    beats: [{ at: 0.3, action: 'reveal', target: ['k', 'm'], dur: 0.4 }],
  }],
};
export const PROVENANCE = [{ claim: '负向测试夹具', source: 'scripts/gate-selftest.mjs' }];
${extra}`,
  },
  {
    name: 'bad-image',
    why: '图片路径 404（G13 必须报红，而不是静默开天窗）',
    expect: ['G13'],
    file: (extra) => `export const deck = {
  meta: { title: '负向测试：图片 404', theme: 'ink' },
  scenes: [{
    id: 'bad', title: '故意缺图', duration: 8,
    elements: [
      { id: 'k', type: 'text', role: 'kicker', text: '负向测试', x: 6, y: 5, w: 60 },
      { id: 'p', type: 'image', src: './assets/这个文件不存在.jpg', fit: 'cover', credit: '不存在', x: 40, y: 20, w: 50, h: 60 },
    ],
    beats: [{ at: 0.3, action: 'reveal', target: ['k', 'p'], dur: 0.4 }],
  }],
};
export const PROVENANCE = [{ claim: '负向测试夹具', source: 'scripts/gate-selftest.mjs' }];
${extra}`,
  },
  {
    name: 'decorative-canvas',
    why: '画布声明了 data，但画法把坐标写死（G11 必须认出这是装饰）',
    expect: ['G11'],
    file: (extra) => `export const deck = {
  meta: { title: '负向测试：装饰性画布', theme: 'ink' },
  scenes: [{
    id: 'bad', title: '硬编码坐标', duration: 8,
    elements: [
      { id: 'k', type: 'text', role: 'kicker', text: '负向测试', x: 6, y: 5, w: 60 },
      { id: 'c', type: 'canvas2d', x: 6, y: 20, w: 60, h: 50, monotonic: true,
        data: { bars: [{ k: 'a', v: 3 }, { k: 'b', v: 9 }], unit: '' },
        draw(ctx, t, el, api) {
          // 坐标写死 —— 完全无视 api.data
          api.ink.path(ctx, [[0.1, 0.8], [0.35, 0.4], [0.6, 0.6], [0.85, 0.2]], api.state.p, { color: api.palette.accent, width: 4 });
        } },
    ],
    beats: [{ at: 0.3, action: 'reveal', target: ['k', 'c'], dur: 0.4 }, { at: 0.5, action: 'draw', target: 'c', dur: 2 }],
  }],
};
export const PROVENANCE = [{ claim: '负向测试夹具', source: 'scripts/gate-selftest.mjs' }];
${extra}`,
  },
  {
    name: 'nondeterminism',
    why: '画面里读了 performance.now()（静态校验必须拦住）',
    expect: ['LINT'],
    lintOnly: true,   // 这条 lint 就能抓，不必上浏览器
    file: (extra) => `export const deck = {
  meta: { title: '负向测试：不确定', theme: 'ink' },
  scenes: [{
    id: 'bad', title: '用了真实时钟', duration: 8,
    elements: [
      { id: 'k', type: 'text', role: 'kicker', text: '负向测试', x: 6, y: 5, w: 60 },
      { id: 'c', type: 'canvas2d', x: 6, y: 20, w: 60, h: 50, monotonic: true,
        draw(ctx, t, el, api) {
          const jitter = performance.now() % 10;   // ← 致命：画面不再是 t 的纯函数
          api.ink.dot(ctx, 0.5, 0.5, jitter, api.palette.accent, 1);
        } },
    ],
    beats: [{ at: 0.3, action: 'reveal', target: ['k', 'c'], dur: 0.4 }],
  }],
};
export const PROVENANCE = [{ claim: '负向测试夹具', source: 'scripts/gate-selftest.mjs' }];
${extra}`,
  },
];

const run = (cmd, args) => new Promise((res) => {
  const p = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => res({ code, out: out.replace(/\x1b\[[0-9;]*m/g, '') }));
});

// ---------------------------------------------------------------- 跑
console.log(`${C.b}负向测试：证明门禁真的会失败${C.z}  ${C.d}（一个不会失败的门禁不是门禁）${C.z}\n`);

let bad = 0;
for (const c of CASES) {
  if (only && c.name !== only) continue;
  const rel = `templates/.selftest-${c.name}.js`;
  const abs = join(ROOT, rel);
  await writeFile(abs, c.file(''), 'utf8');
  let ok, detail;
  try {
    const r = c.lintOnly
      ? await run('node', ['scripts/lint-scenes.mjs', rel])
      : await run('node', ['scripts/verify.mjs', `--deck=templates/deck.html?scenes=./.selftest-${c.name}.js`]);
    const failed = c.expect.filter((g) => new RegExp(`^\\s*✗\\s+${g}\\b`, 'm').test(r.out)
      || (g === 'LINT' && r.code !== 0));
    ok = failed.length === c.expect.length;
    detail = ok
      ? `${failed.join(' / ')} 按预期报红`
      : `预期 ${c.expect.join(' / ')} 报红，实际${failed.length ? `只有 ${failed.join(' / ')}` : '一条都没报'} —— 门禁可能被写空了`;
  } finally {
    await unlink(abs).catch(() => {});
  }
  if (ok) console.log(`  ${C.g}✓${C.z} ${c.name.padEnd(18)} ${C.d}${c.why}${C.z}\n      ${detail}`);
  else { bad++; console.log(`  ${C.r}✗${C.z} ${c.name.padEnd(18)} ${c.why}\n      ${C.r}${detail}${C.z}`); }
}

console.log();
if (bad) { console.log(`${C.r}${bad} 个负向用例没有按预期报红 —— 门禁在退化。${C.z}\n`); process.exit(1); }
console.log(`${C.g}全部负向用例通过：这些门禁确实抓得住它们声称能抓的东西。${C.z}\n`);
