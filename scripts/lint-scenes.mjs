#!/usr/bin/env node
/**
 * animated-lesson · scripts/lint-scenes.mjs
 *
 * 静态校验：不启浏览器，毫秒级出结果 —— 作者循环里跑这个。
 * 它复用引擎里的 validate()（**与运行时同一份实现**），额外加两项源码级检查：
 *   · 确定性：场景文件里不许出现 Date.now / Math.random / performance.now
 *   · 溯源：必须导出 PROVENANCE，正文里的数字才有出处可查
 *
 *   node scripts/lint-scenes.mjs templates/scenes.instancing.js
 *   node scripts/lint-scenes.mjs                 # 默认扫 templates/*.js
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const NONDET = [
  [/\bDate\.now\s*\(/g, 'Date.now()'],
  [/\bMath\.random\s*\(/g, 'Math.random()'],
  [/\bperformance\.now\s*\(/g, 'performance.now()'],
  [/\bnew\s+Date\s*\(/g, 'new Date()'],
];

/**
 * 去掉字符串字面量，只留代码。
 * 为什么需要：课件正文里经常要**提到** performance.now() / Math.random()（比如在讲
 * "确定性要求不能用当前时间戳"），那是内容不是代码。早期版本直接扫原文，
 * 于是任何引用这些名字的课件都会被误报 —— 假阳性会让作者开始忽略这个检查。
 * 局限：跨行的模板字面量按行处理不了（场景文件里极少见）。
 */
function stripStrings(line) {
  return line
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

function lintSource(file, src) {
  const problems = [];
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    if (line.includes('determinism-ok')) return;      // 显式豁免
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;      // 注释不算
    const code = stripStrings(line);                  // 字符串内容不算
    for (const [re, name] of NONDET) {
      re.lastIndex = 0;
      if (re.test(code)) {
        problems.push({ file, line: i + 1, msg: `${name} —— 时间/随机必须来自传入的 t（或标 // determinism-ok）` });
      }
    }
  });
  return problems;
}

/**
 * 内容安全区（纯算术，不需要浏览器）。
 * 设计坐标系 1280×720：
 *   · 上：面包屑在右上角占 y 2.5%~5%，内容从 3% 起
 *   · 下：字幕条占 y 90%~98% —— 导出视频时字幕是唯一的旁白通道，必须保留
 * 只有显式声明 h 的元素能在这里精确判；自动高度的文本/列表由 verify.mjs 的 G2d 实测兜底。
 */
const SAFE = { top: 3, bottom: 92, autoWarn: 90 };
// 满幅背景图/色块是 PPT 的常规手法，不该被安全区拦住 ——
// 但要**显式**写 bleed: true，否则视为漏了 y（见下面的 continue）。
function lintSafeZone(spec) {
  const errors = [], warnings = [];
  for (const [si, sc] of spec.scenes.entries()) {
    for (const el of sc.elements ?? []) {
      // bleed: 出血背景（满幅图/色块）—— 它本来就该铺满，安全区管的是**内容**。
      // 要求显式声明，这样"铺满"是作者的决定，而不是漏了 y。
      if (el.bleed === true) continue;
      if (typeof el.y === 'number' && el.y < SAFE.top) {
        errors.push(`scenes[${si}](${sc.id}).${el.id}: y=${el.y}% < ${SAFE.top}% —— 会顶到面包屑带`);
      }
      if (typeof el.h === 'number' && el.y + el.h > SAFE.bottom) {
        errors.push(`scenes[${si}](${sc.id}).${el.id}: y+h=${(el.y + el.h).toFixed(1)}% > ${SAFE.bottom}% —— 会钻到字幕条下面`);
      }
      if (typeof el.y === 'number' && !el.h && el.y >= SAFE.autoWarn) {
        warnings.push(`scenes[${si}](${sc.id}).${el.id}: y=${el.y}% 且未声明 h —— 自动高度元素可能伸进字幕带（G2d 会实测兜底）`);
      }
    }
  }
  return { errors, warnings };
}

/**
 * 内容深度体检。
 *
 * 「内容显得简单」的可测定义，是每一幕缺了论证链条里的哪一环：
 *   主张 → 机制 → 量级 → 边界 → 可算的推论
 * 这里能静态查的是三条（其余两条由 verify.mjs 的 G11 数据扰动 + 预测题覆盖）：
 *   · 量级：有没有数字；数字有没有**参照**（没有参照的数字观众无法判断大小）
 *   · 边界：有没有说"什么时候不成立"（只有支持证据的讲解是宣传，不是教学）
 *   · 机制：画面有没有声明 data（没声明就无法证明画面在承载信息，见 G11）
 *
 * 这些都是启发式，所以输出是"体检表 + 提示"，不是硬门禁。硬门禁在浏览器里量。
 */
const NUM = /\d/;
const BASELINE = /比|相比|差了?|倍|相对|对照|基线|参照|不到|只有|仅|省下|从[^，。]{1,8}到/;
const BOUNDARY = /边界|不成立|不万能|只在|超过|注意|除非|别用|不该|不要|反例|会错|失败|代价|代价是/;
const textOf = (el) => [el.text, el.label, el.value, ...(el.items ?? []).map((i) => i.text ?? i)].filter(Boolean).join(' ');
function depthOf(sc) {
  const els = sc.elements ?? [];
  const all = els.map(textOf).join(' ');
  const dataEls = els.filter((e) => e.data);
  const canvas = els.filter((e) => e.type === 'canvas2d' || e.type === 'three');
  return {
    numbers: (all.match(/\d+(?:\.\d+)?/g) ?? []).length,
    baseline: BASELINE.test(all),
    boundary: BOUNDARY.test(all),
    data: dataEls.length,
    canvas: canvas.length,
    quiz: !!sc.quiz,
    words: all.replace(/<[^>]+>/g, '').length,
  };
}
function depthTable(spec) {
  const rows = spec.scenes.map((sc, i) => {
    const d = depthOf(sc);
    const mark = (ok) => (ok ? C.green('●') : C.dim('○'));
    return `  ${String(i + 1).padStart(2, '0')} ${C.bold((sc.id ?? '').padEnd(14))} ` +
      `数字 ${String(d.numbers).padStart(2)} ${mark(d.numbers > 0)}  ` +
      `参照 ${mark(d.baseline)}  ` +
      `边界 ${mark(d.boundary)}  ` +
      `数据画面 ${d.data}/${d.canvas} ${mark(d.canvas === 0 || d.data === d.canvas)}  ` +
      `预测题 ${mark(d.quiz)}`;
  });
  const hints = [];
  spec.scenes.forEach((sc, i) => {
    const d = depthOf(sc);
    if (d.numbers === 0) hints.push(`scenes[${i}](${sc.id}): 一个数字都没有 —— 主张无法被检验，考虑补一个可核对的量级`);
    else if (!d.baseline) hints.push(`scenes[${i}](${sc.id}): 有数字但没有参照 —— 观众不知道这个数是"大"还是"小"，补一个"和什么比"`);
    if (!d.boundary) hints.push(`scenes[${i}](${sc.id}): 没有边界 —— 只有支持证据的讲解是宣传；补一句"什么时候不成立"`);
    if (d.canvas > d.data) hints.push(`scenes[${i}](${sc.id}): ${d.canvas - d.data} 块画布没声明 data —— 无法证明画面在承载信息（G11 会扰动数据验证）`);
  });
  return { rows, hints };
}

function fmtSpec(spec) {
  const rows = spec.scenes.map((s, i) => {
    const secs = `${s.duration}s`.padStart(5);
    const els = String((s.elements ?? []).length).padStart(2);
    const beats = String((s.beats ?? []).length).padStart(2);
    const speaks = (s.beats ?? []).filter((b) => b.action === 'speak').length;
    const quiz = s.quiz ? ' 🤔' : '  ';
    return `  ${String(i + 1).padStart(2, '0')} ${C.bold((s.title ?? s.id).padEnd(26))} ${secs}  ${els} 元素  ${beats} 动作  ${String(speaks).padStart(2)} 旁白${quiz}`;
  });
  const total = spec.scenes.reduce((a, s) => a + s.duration, 0);
  return rows.join('\n') + `\n  ${C.dim('─'.repeat(58))}\n  共 ${spec.scenes.length} 幕 · ${(total / 60).toFixed(1)} 分钟`;
}

async function lintOne(file) {
  const abs = resolve(file);
  const src = readFileSync(abs, 'utf8');
  const name = basename(abs);
  console.log(`\n${C.bold('▶ ' + name)}`);

  const srcProblems = lintSource(name, src);
  const mod = await import(pathToFileURL(abs).href + `?t=${Date.now()}`);
  const spec = mod.deck ?? mod.default;
  if (!spec?.scenes) {
    console.log(C.red('  ✗ 没有导出 deck（export const deck = {...}）'));
    return 1;
  }
  const { validate } = await import(pathToFileURL(resolve(ROOT, 'engine/scene.js')).href);
  const report = validate(spec);

  console.log(fmtSpec(spec));

  if (!('PROVENANCE' in mod)) {
    console.log(C.yellow('  ⚠ 未导出 PROVENANCE —— 正文里的数字没有出处可查（交付前应补）'));
  } else if (!Array.isArray(mod.PROVENANCE) || !mod.PROVENANCE.length) {
    console.log(C.yellow('  ⚠ PROVENANCE 为空'));
  } else {
    console.log(C.dim(`  · ${mod.PROVENANCE.length} 条数字溯源`));
  }

  const zone = lintSafeZone(spec);
  const depth = depthTable(spec);
  console.log(C.dim('  ── 内容深度体检 ─────────────────────────────────────'));
  depth.rows.forEach((r) => console.log(r));
  console.log(C.dim('  ────────────────────────────────────────────────────'));

  for (const p of srcProblems) console.log(C.red(`  ✗ ${name}:${p.line} ${p.msg}`));
  for (const e of report.errors) console.log(C.red(`  ✗ ${e}`));
  for (const z of zone.errors) console.log(C.red(`  ✗ 安全区 ${z}`));
  for (const z of zone.warnings) console.log(C.yellow(`  ⚠ 安全区 ${z}`));
  for (const h of depth.hints) console.log(C.yellow(`  ⚠ 深度 ${h}`));
  for (const w of report.warnings) console.log(C.yellow(`  ⚠ ${w}`));

  const bad = srcProblems.length + report.errors.length + zone.errors.length;
  if (bad === 0) console.log(C.green(`  ✓ 通过（${report.warnings.length + zone.warnings.length + depth.hints.length} 个提示）`));
  return bad ? 1 : 0;
}

const args = process.argv.slice(2);
const files = args.length
  ? args
  : readdirSync(resolve(ROOT, 'templates')).filter((f) => f.endsWith('.js')).map((f) => resolve(ROOT, 'templates', f));

let failed = 0;
for (const f of files) {
  try { failed += await lintOne(f); }
  catch (err) { console.log(C.red(`  ✗ 加载失败: ${err.message}`)); failed++; }
}
console.log(failed ? C.red(`\n${failed} 个文件未通过\n`) : C.green('\n全部通过\n'));
process.exit(failed ? 1 : 0);
