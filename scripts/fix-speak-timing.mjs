#!/usr/bin/env node
/**
 * fix-speak-timing.mjs —— 把互相抢话的旁白按「上一句念完再开口」重排。
 *
 * 背景：旁白窗口是 `max(1.6, 字数 / SPEAK_CPS)` 算出来的，字数没错；
 * 错的是 `at` —— 作者（包括我）凭感觉把两句话排得太近，
 * 于是时间轴上两句话要求**同时**念出来。画面看不出来，音轨一铺就原形毕露。
 *
 * 只改两样东西，都是确定性的：
 *   ① 后一句的 `at` 推到前一句念完之后（GAP 秒呼吸）；
 *   ② 这一幕装不下就加 `duration`（只加不减）。
 * 台词一个字都不动 —— 改台词是改内容，那是作者的事，脚本不替人做决定。
 *
 * 用法：
 *   node scripts/fix-speak-timing.mjs --dry        # 只看会怎么改
 *   node scripts/fix-speak-timing.mjs              # 真改
 *   node scripts/fix-speak-timing.mjs scenes.kvcache.js ...
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const files = args.length
  ? args.map((f) => resolve(ROOT, f.startsWith('templates/') ? f : join('templates', f)))
  : globSync('templates/scenes.*.js', { cwd: ROOT }).map((f) => resolve(ROOT, f));

const CPS = 4.6, MIN_DUR = 1.6, GAP = 0.2, TAIL = 0.6;
const durOf = (text) => Math.max(MIN_DUR, text.length / CPS);

// 一幕一段：从 `id: '...'` 到下一个 `id: '...'`（顶层数组元素）
const SCENE_RE = /\n    \{\n      id: '([a-z0-9-]+)'/g;

let totShift = 0, totGrow = 0, totScenes = 0, fixed = 0;
for (const file of files) {
  let src = await readFile(file, 'utf8');
  const marks = [...src.matchAll(SCENE_RE)].map((m) => ({ id: m[1], at: m.index }));
  if (!marks.length) continue;
  const spans = marks.map((m, i) => ({ id: m.id, from: m.at, to: i + 1 < marks.length ? marks[i + 1].at : src.length }));

  let out = '', cursor = 0, shifts = [], grows = [];
  for (const sp of spans) {
    let seg = src.slice(sp.from, sp.to);

    // 这一段的 duration
    const dm = seg.match(/\n      duration: ([\d.]+),/);
    if (!dm) continue;
    const oldDur = parseFloat(dm[1]);

    // 这一段的 speak，按出现顺序
    const speaks = [...seg.matchAll(/\{ at: ([\d.]+), action: 'speak', text: '((?:[^'\\]|\\.)*)' \}/g)];
    if (!speaks.length) continue;

    // r1 = 写到小数点后一位时**向上**取整。用 round 会把值提前最多 0.04s，
    // 于是刚排好的「不抢话」又差那么一点点 —— 门禁 G21 就会以 0.01s 的残差报红。
    // 而且要把取整后的值往下传，否则误差会累积。
    const r1 = (x) => Math.ceil(x * 10) / 10;
    let need = r1(parseFloat(speaks[0][1]));
    const plan = [{ old: parseFloat(speaks[0][1]), next: need, text: speaks[0][2] }];
    for (let i = 1; i < speaks.length; i++) {
      const oldAt = parseFloat(speaks[i][1]);
      need = Math.max(r1(oldAt), r1(plan[i - 1].next + durOf(speaks[i - 1][2]) + GAP));
      plan.push({ old: oldAt, next: need, text: speaks[i][2] });
    }
    const end = need + durOf(speaks[speaks.length - 1][2]);
    const newDur = Math.max(oldDur, Math.ceil((end + TAIL) * 2) / 2);   // 半秒粒度

    // 写回（从后往前替换，避免位移）
    for (let i = plan.length - 1; i >= 0; i--) {
      const p = plan[i];
      const d = p.next - p.old;
      if (Math.abs(d) < 0.05) continue;
      const from = speaks[i].index + `{ at: `.length;
      const to = from + String(speaks[i][1]).length;
      seg = seg.slice(0, from) + p.next + seg.slice(to);
      shifts.push({ id: sp.id, old: p.old, next: p.next, d, text: p.text });
    }
    if (newDur > oldDur + 0.001) {
      seg = seg.replace(`\n      duration: ${dm[1]},`, `\n      duration: ${newDur},`);
      grows.push({ id: sp.id, from: oldDur, to: newDur });
    }
    out += src.slice(cursor, sp.from) + seg;
    cursor = sp.to;
    totScenes++;
  }
  out += src.slice(cursor);
  if (!shifts.length && !grows.length) continue;

  fixed++;
  totShift += shifts.length; totGrow += grows.length;
  const name = file.replace(ROOT + '/', '');
  console.log(`\n── ${name}`);
  for (const s of shifts.sort((a, b) => b.d - a.d).slice(0, 4)) {
    console.log(`   推后 ${s.d.toFixed(2)}s  ${s.old}→${s.next}  ${s.text.slice(0, 26)}`);
  }
  if (shifts.length > 4) console.log(`   … 共推后 ${shifts.length} 句`);
  for (const g of grows) console.log(`   加时长 ${g.id}: ${g.from}s → ${g.to}s`);
  if (!DRY) await writeFile(file, out);
}

console.log(`\n${DRY ? '（演练，未写盘）' : '✓ 已写回'} —— ${fixed} 份课件 · 推后 ${totShift} 句 · 加长 ${totGrow} 幕`);
