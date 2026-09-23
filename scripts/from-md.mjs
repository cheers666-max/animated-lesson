#!/usr/bin/env node
/**
 * animated-lesson · scripts/from-md.mjs
 *
 * 缺的那一环：**素材 → 课件**。
 * 之前这个 skill 只有"引擎 + 门禁"，每份课件都要从空文件手写，
 * 于是内容自然薄（而且薄在同一个地方：没有量级、没有参照、没有边界）。
 *
 * 这个脚本把一份 Markdown（文档 / 论文笔记 / 设计说明 / 复盘）变成
 * **能跑、能过门禁的课件骨架**，并且顺手把论证结构搭出来：
 *
 *   主张（小节标题 + 首段）· 机制（列表/代码）· 量级（自动抽出的数字）
 *   · 参照（与数字同句出现的比较词）· 边界（"但是/除非/只在"那几句）
 *   · 溯源（每条 claim → 原文 file:line）
 *
 * 它不做的事（也不假装做）：
 *   · 不改写文案 —— 所有文字都是原文逐字搬运；旁白是草稿，标了 TODO
 *   · 不设计画面 —— 每幕给一块**通用数据柱状图**（已经 data-driven，能过 G11），
 *     作者要做的第一件事就是把它换成真正解释这件事的画法
 *   · 不判断哪一段值得讲 —— 它按 h2 切幕，多了就用 --max-scenes 砍，砍掉的会打印出来
 *
 * 用法：
 *   node scripts/from-md.mjs docs/foo.md --out=templates/scenes.foo.js
 *   node scripts/from-md.mjs docs/foo.md --out=... --max-scenes=6 --level=2 --theme=ink
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const args = process.argv.slice(2);
const opt = (n, d = null) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const SRC = args.find((a) => !a.startsWith('--'));
if (!SRC) {
  console.error('用法: node scripts/from-md.mjs <input.md> --out=templates/scenes.x.js [--max-scenes=8] [--level=2] [--theme=ink]');
  process.exit(2);
}
const LEVEL = Number(opt('level', 2));
const MAX = Number(opt('max-scenes', 8));
const THEME = opt('theme', 'ink');
const OUT = resolve(opt('out', 'templates/scenes.generated.js'));

// ------------------------------------------------------------------ 与 lint 同源的判定规则
const BASELINE = /比|相比|差了?|倍|相对|对照|基线|参照|不到|只有|仅|省下|从[^，。]{1,8}到/;
const BOUNDARY = /边界|不成立|不万能|只在|超过|注意|除非|别用|不该|不要|反例|会错|失败|代价|限制|未覆盖|不适用/;
const NUM_UNIT = /(\d[\d,.]*)\s*(%|倍|ms|µs|us|ns|s|秒|分钟|小时|天|年|GB|MB|KB|B|MiB|GiB|FPS|fps|次|个|条|项|步|层|张|人|字|px|核|卡)?/g;
const stripMd = (s) => s
  .replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '').trim();
const slug = (s) => stripMd(s).toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '').slice(0, 22) || 'scene';

// ------------------------------------------------------------------ 解析 Markdown
function parse(md) {
  const lines = md.split('\n');
  const sections = [];
  let cur = null;
  let inFence = false, fenceLang = '', fenceBuf = [];
  const push = () => { if (cur && (cur.paras.length || cur.bullets.length || cur.codes.length)) sections.push(cur); };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\r$/, '');
    const fence = /^\s*```(\w*)/.exec(line);
    if (fence) {
      if (!inFence) { inFence = true; fenceLang = fence[1] || 'text'; fenceBuf = []; }
      else {
        inFence = false;
        if (cur) cur.codes.push({ lang: fenceLang, code: fenceBuf.join('\n'), line: i - fenceBuf.length });
      }
      continue;
    }
    if (inFence) { fenceBuf.push(line); continue; }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h && h[1].length <= LEVEL) {
      if (h[1].length === LEVEL) { push(); cur = { title: stripMd(h[2]), line: i + 1, paras: [], bullets: [], codes: [], quotes: [] }; }
      continue;
    }
    if (!cur) { cur = { title: '(前言)', line: i + 1, paras: [], bullets: [], codes: [], quotes: [] }; }
    if (/^\s*>\s?/.test(line)) { cur.quotes.push({ text: stripMd(line.replace(/^\s*>\s?/, '')), line: i + 1 }); continue; }
    const b = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (b) { cur.bullets.push({ text: stripMd(b[1]), line: i + 1 }); continue; }
    if (!line.trim()) continue;
    if (/^\s*\|/.test(line)) continue;                       // 表格先跳过（不假装能理解）
    if (/^\s*!\[/.test(line)) continue;
    cur.paras.push({ text: stripMd(line), line: i + 1 });
  }
  push();
  return sections;
}

/** 从一段文字里抽"量级"：数字 + 单位 + 是否带参照 */
function numbersIn(text) {
  const out = [];
  for (const m of text.matchAll(NUM_UNIT)) {
    if (!m[1]) continue;
    const v = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(v)) continue;
    out.push({ raw: `${m[1]}${m[2] ?? ''}`, v, unit: m[2] ?? '', idx: m.index });
  }
  return out;
}
/** 数字附近有没有比较词（参照）—— 判定"这个数观众能不能判断大小" */
function hasBaselineNear(text, idx, win = 60) {
  return BASELINE.test(text.slice(Math.max(0, idx - win), idx + win));
}

/**
 * 发射一个元素对象：永远多行，缩进由 base 决定。
 * 不用正则去修饰 jsLit 的输出 —— 那种"字符串后处理"正是上一个版本出语法错的原因。
 */
function emitObj(obj, base, trailingFn = null) {
  const pad = ' '.repeat(base);
  const keys = Object.keys(obj).filter((k) => k !== 'draw');
  const lines = keys.map((k) => `${pad}  ${k}: ${jsLit(obj[k], base + 2)}`);
  if (trailingFn) lines.push(`${pad}  draw: ${trailingFn}`);
  return `${pad}{\n${lines.join(',\n')},\n${pad}}`;
}

// ------------------------------------------------------------------ 生成场景数据
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');

/**
 * 把值序列化成合法的 JS 字面量。
 * 之前这里用 JSON.stringify + 把双引号换成单引号的骚操作，
 * 结果内容里本来就有引号时（storeOp:'discard'）生成的文件直接语法错误。
 * 老老实实递归发射，键不加引号（标识符键 JS 允许）。
 */
function jsLit(v, indent = 0) {
  const pad = '  '.repeat(indent);
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    const flat = v.every((x) => typeof x !== 'object' || x === null);
    if (flat) return `[${v.map((x) => jsLit(x)).join(', ')}]`;
    return `[\n${v.map((x) => pad + '  ' + jsLit(x, indent + 1)).join(',\n')},\n${pad}]`;
  }
  const keys = Object.keys(v);
  if (!keys.length) return '{}';
  const oneLine = `${keys.map((k) => `${k}: ${jsLit(v[k])}`).join(', ')}`;
  if (oneLine.length < 110) return `{ ${oneLine} }`;
  return `{\n${keys.map((k) => `${pad}  ${k}: ${jsLit(v[k], indent + 1)}`).join(',\n')},\n${pad}}`;
}
function buildScene(sec, si, srcRel) {
  const body = [...sec.paras.map((p) => p.text), ...sec.bullets.map((b) => b.text), ...sec.quotes.map((q) => q.text)].join(' ');
  const nums = numbersIn(body);
  const withBase = nums.filter((n) => hasBaselineNear(body, n.idx));
  const hasBoundary = BOUNDARY.test(body);
  const boundaryText = sec.paras.map((p) => p.text).find((t) => BOUNDARY.test(t))
    ?? sec.bullets.map((b) => b.text).find((t) => BOUNDARY.test(t)) ?? null;

  const elements = [];
  const beats = [];
  const speaks = [];
  const id = slug(sec.title);
  const claim = (sec.paras[0]?.text ?? sec.bullets[0]?.text ?? sec.title).slice(0, 60);

  // 头：kicker + title（title 用原文小节标题，不改写）
  elements.push({ id: 'k', group: 'head', type: 'text', role: 'kicker', text: `§${si + 1} · 来源 ${srcRel}:${sec.line}`, x: 6, y: 5, w: 70 });
  elements.push({ id: 't', group: 'head', type: 'text', role: 'title', text: sec.title.slice(0, 34), x: 6, y: 10, w: 74, size: 34 });
  beats.push({ at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.5 });

  // 主张：首段原文
  if (sec.paras[0]) {
    elements.push({ id: 'claim', group: 'claim', type: 'text', role: 'body', text: sec.paras[0].text.slice(0, 150), x: 6, y: 20, w: 88, size: 17 });
    beats.push({ at: 0.9, action: 'reveal', target: 'claim', dur: 0.5 });
    speaks.push({ at: 1.2, action: 'speak', text: sec.paras[0].text.slice(0, 42) });   // TODO 改写成本人口吻
  }

  // 机制：列表（最多 5 条，逐条出现 —— 天然满足 G9 的节流）
  const bullets = sec.bullets.slice(0, 5);
  let clock = 4.5;
  if (bullets.length) {
    elements.push({ id: 'l', group: 'mech', type: 'list', x: 6, y: 34, w: 88, items: bullets.map((b, i) => ({ badge: String(i + 1), text: b.text.slice(0, 90) })) });
    beats.push({ at: 4.2, action: 'reveal', target: 'l', dur: 0.7 });
    clock = 6.0;
  }

  // 代码：原样搬运
  if (sec.codes.length) {
    const c = sec.codes[0];
    elements.push({ id: 'code', group: 'code', type: 'code', lang: c.lang, text: c.code.split('\n').slice(0, 10).join('\n'), x: 6, y: bullets.length ? 62 : 40, w: 52, h: bullets.length ? 26 : 44 });
    beats.push({ at: clock, action: 'reveal', target: 'code', dur: 0.6 });
    clock += 1.2;
  }

  // 量级：自动抽出的数字（这是"内容不简单"的关键一环）
  if (nums.length) {
    const top = nums.slice(0, 6);
    const el = { id: 'num', group: 'num', type: 'text', role: 'quote', text: `量级（原文抽出）：${top.map((n) => n.raw).join(' · ')}`, x: 6, y: 62, w: 88, size: 16 };
    if (bullets.length && sec.codes.length) { el.y = 62; el.x = 62; el.w = 32; }
    elements.push(el);
    beats.push({ at: clock, action: 'reveal', target: 'num', dur: 0.6 });
    clock += 1.2;
  }

  // 数据画面：通用柱状图。**已经 data-driven**，所以开箱就能过 G11。
  // 作者的第一件事应该是把它换成真正解释这件事的画法（见 references/content-depth.md）。
  if (nums.length) {
    const bars = nums.slice(0, 6).map((n, i) => ({ k: n.raw, v: Math.abs(n.v) || 1, tone: i % 3 === 0 ? 'accent' : i % 3 === 1 ? 'accent-2' : 'good' }));
    const y = sec.codes.length ? 40 : 34;
    elements.push({ id: 'c', group: 'canvas', type: 'canvas2d', x: 62, y: 20, w: 32, h: 40, monotonic: true, draw: 'drawAutoBars', data: { bars, unit: '' } });
    beats.push({ at: clock, action: 'reveal', target: 'c', dur: 0.4 });
    beats.push({ at: clock + 0.1, action: 'draw', target: 'c', dur: 4 });
    clock += 4.6;
  }

  // 边界：原文里那几句"但是/除非/只在"—— 逐字搬运，不自己编
  if (boundaryText) {
    elements.push({ id: 'b', group: 'boundary', type: 'text', role: 'body', text: `边界：${boundaryText.slice(0, 120)}`, x: 6, y: 86, w: 88, size: 14 });
    beats.push({ at: clock, action: 'reveal', target: 'b', dur: 0.5 });
    clock += 1.4;
  }

  // 时长：按旁白字数预算（4.6 字/秒）+ 收尾，夹在 [14, 40]
  const speakChars = speaks.reduce((a, s) => a + s.text.length, 0);
  const duration = Math.max(14, Math.min(40, Math.round(clock + speakChars / 4.6 + 2)));

  // 引用块 → 收尾金句
  if (sec.quotes.length) {
    elements.push({ id: 'q', group: 'concl', type: 'text', role: 'quote', text: sec.quotes[0].text.slice(0, 110), x: 6, y: 78, w: 88, size: 17 });
    beats.push({ at: Math.max(clock, duration - 5), action: 'reveal', target: 'q', dur: 0.6 });
  }

  return {
    scene: { id, title: sec.title.slice(0, 34), duration, elements, beats: [...beats, ...speaks].sort((a, b) => a.at - b.at) },
    nums, withBase, hasBoundary, srcLine: sec.line,
  };
}

// ------------------------------------------------------------------ 主流程
const srcAbs = resolve(SRC);
const md = readFileSync(srcAbs, 'utf8');
const srcRel = relative(ROOT, srcAbs);
const all = parse(md);
const sections = all.slice(0, MAX);
const built = sections.map((s, i) => buildScene(s, i, srcRel));

const gaps = [];
built.forEach((b, i) => {
  const at = `scenes[${i}](${b.scene.id})`;
  if (!b.nums.length) gaps.push(`${at}: 原文这一段没有数字 —— 主张无法被检验（要么去别处找量级，要么承认这是定性主张）`);
  else if (!b.withBase.length) gaps.push(`${at}: 有数字但附近没有参照词 —— 观众不知道这个数是大是小`);
  if (!b.hasBoundary) gaps.push(`${at}: 原文没有"但是/除非/只在"这类边界句 —— 考虑补一句，或从别处引用`);
  gaps.push(`${at}: 画面还是通用柱状图（drawAutoBars）—— 要换成真正解释这件事的画法`);
  gaps.push(`${at}: 旁白是从原文首句抄的草稿 —— 必须改写成本人口吻（TODO）`);
});

const head = `/**
 * ${basename(OUT)} —— 由 scripts/from-md.mjs 从 ${srcRel} 生成
 *
 * 这是**骨架**，不是成品。所有文字都是原文逐字搬运；需要你做的：
 *   1. 把每幕的 \`c\`（通用柱状图）换成真正解释这件事的画法
 *   2. 把 \`speak\` 的草稿改写成本人口吻
 *   3. 补上 from-md 报出来的缺项（量级 / 参照 / 边界）
 *
 * 重新生成：node scripts/from-md.mjs ${srcRel} --out=${relative(ROOT, OUT)}
 */

const clamp01 = (p) => Math.max(0, Math.min(1, p));

/** 通用数据柱状图：开箱即 data-driven（能过 G11 的数据扰动门禁） */
function drawAutoBars(ctx, t, el, api) {
  const { w, h, ink, palette: pal } = api;
  const p = api.state.p;
  const D = api.data ?? { bars: [] };
  if (!D.bars?.length) return;
  const max = Math.max(...D.bars.map((b) => b.v)) || 1;
  const n = D.bars.length;
  const gap = w * 0.06;
  const bw = (w - gap * (n + 1)) / n;
  const y0 = h * 0.84, maxH = h * 0.6;
  ctx.save(); ctx.strokeStyle = pal.line; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(w * 0.04, y0); ctx.lineTo(w * 0.96, y0); ctx.stroke(); ctx.restore();
  D.bars.forEach((b, i) => {
    const local = clamp01(p * 1.6 - i * 0.1);
    if (local <= 0) return;
    const x = gap + i * (bw + gap), bh = maxH * (b.v / max) * local;
    const col = pal[b.tone] ?? pal.accent;
    ctx.save(); ctx.globalAlpha = 0.85 * local; ctx.fillStyle = col;
    ctx.fillRect(x, y0 - bh, bw, bh); ctx.restore();
    ink.label(ctx, b.k, x + bw / 2, y0 - bh - 11, { color: col, align: 'center', alpha: local, font: '11px ui-monospace, monospace' });
  });
  if (p > 0.9) ink.label(ctx, D.unit ?? '', w * 0.96, y0 + 14, { color: pal.muted, align: 'right', font: '11px ui-monospace, monospace' });
}

export const deck = {
  meta: { title: ${JSON.stringify(basename(srcAbs, '.md'))}, subtitle: '从 ${srcRel} 生成的骨架', theme: ${JSON.stringify(THEME)} },
  scenes: [
`;

const body = built.map(({ scene }) => {
  const els = scene.elements.map((e) => emitObj(e, 8, e.draw === 'drawAutoBars' ? 'drawAutoBars' : null)).join(',\n');
  const beats = scene.beats.map((b) => `        ${jsLit(b)}`).join(',\n');
  return `    {
      id: '${scene.id}',
      title: '${esc(scene.title)}',
      duration: ${scene.duration},
      elements: [
${els},
      ],
      beats: [
${beats}
      ],
    },`;
}).join('\n');

const prov = built.map((b) => `  { claim: ${JSON.stringify(b.scene.title)}, source: '${srcRel}:${b.srcLine}' },`).join('\n');
const tail = `
  ],
};

/** 溯源：每条 claim 指向原文行号 —— 生成器顺手做掉的事，手工写十有八九会漏 */
export const PROVENANCE = [
${prov}
];

export default deck;
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, head + body + tail);

console.log(`\n${C.bold('▶ from-md')}  ${srcRel}  →  ${relative(ROOT, OUT)}`);
console.log(`  ${sections.length} 幕 / 共 ${all.length} 个小节${all.length > sections.length ? C.yellow(`（--max-scenes=${MAX} 砍掉了 ${all.length - sections.length} 个：${all.slice(MAX).map((s) => s.title).join(' / ')}）`) : ''}`);
console.log(`  ${built.reduce((a, b) => a + b.scene.duration, 0)} 秒 · 数字 ${built.reduce((a, b) => a + b.nums.length, 0)} 个 · 带参照 ${built.reduce((a, b) => a + b.withBase.length, 0)} 个 · 有边界 ${built.filter((b) => b.hasBoundary).length} 幕`);
console.log(`\n${C.bold('  待你补齐（生成器不会替你编内容）：')}`);
gaps.forEach((g) => console.log(C.yellow('    ⚠ ' + g)));
// 打印"下一步"时路径必须真的能敲。
// 踩过的坑：早期用 relative(ROOT, OUT)，而 ROOT 是**脚本自己**的位置 ——
// 输入文档在 /tmp 时算出 ../../../tmp/x.js，照着敲跑不通。
// 正确做法：lint 用「相对当前工作目录」，verify 用「相对 templates/」（deck 是相对它加载 scenes 的）。
const relCwd = relative(process.cwd(), OUT) || basename(OUT);
const relTpl = relative(join(ROOT, 'templates'), OUT);
const scenesArg = relTpl.startsWith('.') ? relTpl : `./${relTpl}`;
const insideTpl = !relTpl.startsWith('..');
console.log(`\n  下一步：\n    node scripts/lint-scenes.mjs ${relCwd}     ${C.dim('# 看内容深度体检表')}`);
if (insideTpl) {
  console.log(`    node scripts/verify.mjs --deck='templates/deck.html?scenes=${scenesArg}'`);
} else {
  console.log(`    ${C.dim('# 文件在 templates/ 外面，deck 加载不到 —— 建议 --out=templates/…')}`);
}
console.log('');
