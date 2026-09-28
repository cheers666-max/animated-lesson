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
    name: 'discontinuous-scalar',
    why: '分段标量的 from 接不上上一段的 to（端点对不上）',
    expect: ['G15d'],
    file: (extra) => `export const deck = {
  meta: { title: '负向测试：分段标量端点对不上', theme: 'ink' },
  scenes: [{
    id: 'bad', title: '故意断开', duration: 10,
    elements: [
      { id: 'k', type: 'text', role: 'kicker', text: '负向测试', x: 6, y: 5, w: 60 },
      { id: 'c', type: 'canvas2d', x: 6, y: 20, w: 60, h: 50, monotonic: true,
        draw(ctx, t, el, api) { api.ink.path(ctx, [[0.1, 0.5], [0.5, 0.2 + api.state.p * 0.6], [0.9, 0.5]], api.state.p, { color: api.palette.accent, width: 4 }); } },
    ],
    beats: [
      { at: 0.3, action: 'reveal', target: ['k', 'c'], dur: 0.4 },
      // 第一段到 0.5 就停了，第二段却从 0.8 开始 —— 中间 0.5→0.8 没有来源
      { at: 1.0, action: 'draw', target: 'c', from: 0, to: 0.5, dur: 2 },
      { at: 4.0, action: 'draw', target: 'c', from: 0.8, to: 1, dur: 2 },
    ],
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
  {
    name: 'css-transition',
    why: '元素带了 CSS transition（自带时钟，不属于 render(t)）',
    expect: ['G4'],
    // 这条是**真实事故**：引擎给 #deck-caption 加了 transition: opacity .18s，
    // G4 在同一个 t 连拍两次，一次抓到 opacity=0.084、一次抓到 1，
    // 门禁 1/3 概率随机变红。修法是让透明度由 t 算。
    // 这里故意复现：给 .el 加 transition，元素透明度就"追不上"t 了。
    file: (extra) => `document.head.insertAdjacentHTML('beforeend',
  '<style>#stage .el { transition: opacity 1.2s linear; }</style>');

export const deck = {
  meta: { title: '负向测试：CSS 自带时钟', theme: 'ink', oneLine: 'transition 不属于 render(t)。' },
  scenes: [{
    id: 'bad', title: '带了 transition', duration: 10, beat: 'hook',
    elements: [
      { id: 'k', type: 'text', role: 'kicker', text: '负向测试', x: 6, y: 5, w: 60 },
      { id: 't', type: 'text', role: 'title', text: 'CSS transition 会让同一 t 渲染出不同画面', x: 6, y: 12, w: 80 },
    ],
    beats: [
      { at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.4 },
      { at: 2.0, action: 'fadeOut', target: 't', dur: 3.0 },   // 目标值变了 → transition 开始追
    ],
  }],
};
export const PROVENANCE = [{ claim: '负向测试夹具', source: 'scripts/gate-selftest.mjs' }];
${extra}`,
  },
  {
    name: 'no-signal',
    why: '一屏 4 个元素 + 旁白，却没有任何 spotlight/dim（观众不知道看哪）',
    expect: ['G16'],
    file: (extra) => `export const deck = {
  meta: { title: '负向测试：没有焦点', theme: 'ink', oneLine: '旁白在讲，画面不指。' },
  scenes: [{
    id: 'bad', title: '四个元素一起出现', duration: 14, beat: 'hook',
    elements: [
      { id: 'k', type: 'text', role: 'kicker', text: '负向测试', x: 6, y: 5, w: 60 },
      { id: 't', type: 'text', role: 'title', text: '一屏四个元素，旁白在说其中一个', x: 6, y: 12, w: 80 },
      { id: 'a', type: 'text', role: 'body', text: '甲：这个数是这么来的。', x: 6, y: 30, w: 40 },
      { id: 'b', type: 'text', role: 'body', text: '乙：那个数是那么来的。', x: 6, y: 42, w: 40 },
      { id: 'c', type: 'text', role: 'body', text: '丙：第三个更麻烦。', x: 6, y: 54, w: 40 },
      { id: 'd', type: 'text', role: 'body', text: '丁：最后一个是边界。', x: 6, y: 66, w: 40 },
    ],
    beats: [
      { at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.4 },
      { at: 1.0, action: 'reveal', target: ['a', 'b', 'c', 'd'], dur: 0.5 },
      { at: 2.0, action: 'speak', text: '甲是这么来的。' },
      { at: 5.0, action: 'speak', text: '丙比乙更麻烦。' },
    ],
  }],
};
export const PROVENANCE = [{ claim: '负向测试夹具', source: 'scripts/gate-selftest.mjs' }];
${extra}`,
  },
  {
    name: 'orphan-element',
    why: '元素在旁白全部说完之后才出现（coherence 违规）',
    expect: ['G17'],
    file: (extra) => `export const deck = {
  meta: { title: '负向测试：孤儿元素', theme: 'ink', oneLine: '讲完了才出现。' },
  scenes: [{
    id: 'bad', title: '话说完画面才长出来', duration: 14, beat: 'hook',
    elements: [
      { id: 'k', type: 'text', role: 'kicker', text: '负向测试', x: 6, y: 5, w: 60 },
      { id: 't', type: 'text', role: 'title', text: '旁白早就说完了', x: 6, y: 12, w: 80 },
      { id: 'late', type: 'text', role: 'body', text: '这一条没人讲过。', x: 6, y: 40, w: 50 },
    ],
    beats: [
      { at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.4 },
      { at: 1.0, action: 'speak', text: '开场就这一句。' },   // 1.0 + 8/4.6 ≈ 2.7s 说完
      { at: 8.0, action: 'reveal', target: 'late', dur: 0.5 },  // ← 旁白早没了
    ],
  }],
};
export const PROVENANCE = [{ claim: '负向测试夹具', source: 'scripts/gate-selftest.mjs' }];
${extra}`,
  },
  {
    name: 'no-beat',
    why: '有旁白有画面，但没声明这一幕服务哪个叙事节拍',
    expect: ['LINT'],
    lintOnly: true,
    file: (extra) => `export const deck = {
  meta: { title: '负向测试：缺节拍', theme: 'ink', oneLine: '没有节拍的幕不知道自己在论证什么。' },
  scenes: [{
    id: 'bad', title: '没写 beat', duration: 10,
    elements: [
      { id: 'k', type: 'text', role: 'kicker', text: '负向测试', x: 6, y: 5, w: 60 },
    ],
    beats: [{ at: 0.3, action: 'reveal', target: 'k', dur: 0.4 }],
  }],
};
export const PROVENANCE = [{ claim: '负向测试夹具', source: 'scripts/gate-selftest.mjs' }];
${extra}`,
  },
  {
    name: 'quiz-gives-answer',
    why: '预测题的正确选项原样写在画面文字里（那不是预测，是找不同）',
    expect: ['G19'],
    file: (extra) => `export const deck = {
  meta: { title: '负向测试：送答案', theme: 'ink', oneLine: '题还没问，答案已经在屏幕上。' },
  scenes: [{
    id: 'bad', title: '答案就在画面上', duration: 14, beat: 'hook',
    elements: [
      { id: 'k', type: 'text', role: 'kicker', text: '负向测试', x: 6, y: 5, w: 60 },
      { id: 't', type: 'text', role: 'title', text: '先猜一下结果', x: 6, y: 12, w: 80 },
      { id: 'leak', type: 'text', role: 'body', text: '瓶颈在 CPU 每帧发出的命令太多。', x: 6, y: 40, w: 60 },
    ],
    beats: [
      { at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.4 },
      { at: 1.0, action: 'reveal', target: 'leak', dur: 0.5 },
      { at: 2.0, action: 'speak', text: '先猜一下瓶颈在哪。' },
      { at: 4.0, action: 'speak', text: '再想一想。' },
    ],
    quiz: {
      at: 5.0,
      q: '先猜一下：瓶颈最可能在哪儿？',
      opts: [
        { t: 'GPU 顶点处理不过来', ok: false, why: '两万乘三十六顶点，GPU 毫秒级就画完了。' },
        { t: 'CPU 每帧发出的命令太多', ok: true, why: '对。开销是两万次 writeBuffer 加两万次 drawIndexed。' },
      ],
    },
  }],
};
export const PROVENANCE = [{ claim: '负向测试夹具', source: 'scripts/gate-selftest.mjs' }];
${extra}`,
  },
  {
    name: 'speak-clash',
    why: '两句旁白在时间轴上重叠 —— 画面看不出来，一铺音轨就是两个人同时说话',
    expect: ['G21'],
    file: (extra) => `export const deck = {
  meta: { title: '负向测试：旁白抢话', theme: 'ink', oneLine: '两句话要求在同一段时间里念出来。' },
  scenes: [{
    id: 'bad', title: '句子排太密', duration: 14, beat: 'hook',
    elements: [
      { id: 'k', type: 'text', role: 'kicker', text: '负向测试', x: 6, y: 5, w: 60 },
      { id: 't', type: 'text', role: 'title', text: '旁白窗口重叠', x: 6, y: 12, w: 80 },
    ],
    beats: [
      { at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.4 },
      { at: 0.6, action: 'speak', text: '第一句有二十八个字，按每秒四点六字要念六秒多才念得完。' },
      { at: 2.0, action: 'speak', text: '第二句在两点零秒就开口，于是两句挤在同一段时间里。' },
    ],
  }],
};
export const PROVENANCE = [{ claim: '负向测试夹具', source: 'scripts/gate-selftest.mjs' }];
${extra}`,
  },
  {
    name: 'text-tags',
    why: '文本里的标记没被解释，原样印在画面上（用户看到的是「<br>」两个字）',
    expect: ['G20'],
    // 这条是**真实事故**：引擎里 renderText 用 node.textContent，而 renderList 用 innerHTML ——
    // 同一套 DSL 两套语义。8 份课件把作者写的 <br>/<b> 原样印在了标题和注脚里，
    // 而当时没有任何一条门禁看得见它。
    // 这里用 `&lt;br&gt;` 复现同一个症状：作者想要换行，画面直接显示「<br>」。
    file: (extra) => `export const deck = {
  meta: { title: '负向测试：标记没被解释', theme: 'ink', oneLine: '作者想要换行，画面印出了 &lt;br&gt;。' },
  scenes: [{
    id: 'bad', title: '标记被当成了字面文字', duration: 12, beat: 'hook',
    elements: [
      { id: 'k', type: 'text', role: 'kicker', text: '负向测试', x: 6, y: 5, w: 60 },
      { id: 't', type: 'text', role: 'title', text: '带宽没变，&lt;br&gt;为什么快了四倍？', x: 6, y: 12, w: 84 },
      { id: 'n', type: 'text', role: 'body', text: '这里想要&lt;b&gt;加粗&lt;/b&gt;，结果印出了标签。', x: 6, y: 40, w: 84 },
    ],
    beats: [
      { at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.4 },
      { at: 1.2, action: 'reveal', target: 'n', dur: 0.5 },
      { at: 1.6, action: 'speak', text: '标题里的标记没有被解释成换行。' },
      { at: 5.2, action: 'speak', text: '正文里的加粗标记也被原样印了出来。' },
    ],
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
