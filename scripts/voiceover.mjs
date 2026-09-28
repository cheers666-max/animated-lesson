#!/usr/bin/env node
/**
 * voiceover.mjs —— 给课件铺一条旁白音轨。
 *
 * 出发点：**台词和画面必须同源。**
 * 旁白文本不另写一份，直接从编译后的 `beats` 里取（`window.DECK_INFO.scenes[i].speaks`），
 * 所以字幕显示什么、配音就念什么，改了场景文件两边一起变。
 *
 * 三件事：
 *   ① 逐句用 macOS `say` 合成，用 ffprobe 量**真实**时长；
 *   ② 和场景声明的窗口（`SPEAK_CPS = 4.6` 字/秒算出来的）逐句对账，超了就报出来；
 *   ③ 按 `at` 铺到时间轴上，apad + atrim 到精确总时长，再可选地 mux 进 mp4。
 *
 * 用法：
 *   node scripts/voiceover.mjs kvcache                     # 只对账，不产出
 *   node scripts/voiceover.mjs kvcache --build             # 产出 out/kvcache-vo.m4a
 *   node scripts/voiceover.mjs kvcache --build --mux=out/kvcache.mp4
 *   node scripts/voiceover.mjs kvcache --voice=Flo --check # 换音色；超窗口就退出码 1
 *
 * 注意：`say -v 不存在的音色` **不报错**，会静默回退到默认音色 —— 所以这里自己校验。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { extname, join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n, d) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const has = (n) => args.includes(`--${n}`);
const DECK = args.find((x) => !x.startsWith('--')) ?? 'kvcache';
const VOICE = flag('voice', 'Tingting');
const WORK = flag('work', '/tmp/al-vo');
const OUT = flag('out', `out/${DECK}-vo.m4a`);
const MUX = flag('mux', null);
const CHECK = has('check');
const CAP = parseFloat(flag('tempo-cap', '1.3'));   // 语速最多提到这么快；超了就说明这一幕的台词配不上它的时长
const BUILD = has('build') || !!MUX;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = String(9530 + (process.pid % 200));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const sh = (cmd, a) => spawnSync(cmd, a, { encoding: 'utf8' });

// ── 0. 音色必须真实存在（say 对不存在的音色静默回退，是这个脚本最大的坑）──
const voices = (sh('say', ['-v', '?']).stdout ?? '').split('\n').map((l) => l.split(/\s{2,}/)[0].trim()).filter(Boolean);
if (!voices.includes(VOICE)) {
  const cn = voices.filter((v) => /[\u4e00-\u9fff]/.test(v) || /^(Tingting|Meijia|Sinji)$/.test(v));
  console.error(`✗ 没有音色「${VOICE}」。这台机器上可用的中文音色：\n  ${cn.join(' / ')}`);
  process.exit(2);
}

// ── 1. 起 deck，读编译后的旁白时间轴 ─────────────────────────────
const srv = createServer(async (req, res) => {
  try {
    const p = join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    const b = await readFile(p);
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] ?? 'application/octet-stream' });
    res.end(b);
  } catch { res.writeHead(404); res.end('nope'); }
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${srv.address().port}/templates/deck.html?scenes=./scenes.${DECK}.js`;

const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--window-size=1440,900', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${WORK}/.profile`, url], { stdio: 'ignore' });

let wsUrl;
for (let i = 0; i < 80; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const t = l.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
    if (t) { wsUrl = t.webSocketDebuggerUrl; break; }
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
if (!wsUrl) { console.error('✗ 起不来 Chrome'); chrome.kill(); srv.close(); process.exit(2); }

const sock = new WebSocket(wsUrl);
await new Promise((r) => sock.addEventListener('open', r));
let seq = 0; const pend = new Map();
sock.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const cmd = (method, params) => new Promise((r) => { const id = ++seq; pend.set(id, r); sock.send(JSON.stringify({ id, method, params })); });

let info = null;
for (let i = 0; i < 80; i++) {
  const r = await cmd('Runtime.evaluate', { expression: 'window.DECK_INFO ? JSON.stringify(window.DECK_INFO) : null', returnByValue: true });
  const v = r.result?.result?.value;
  if (v) { info = JSON.parse(v); break; }
  await new Promise((r) => setTimeout(r, 250));
}
chrome.kill(); srv.close();
if (!info) { console.error('✗ 没读到 DECK_INFO'); process.exit(2); }

const total = +info.duration.toFixed(3);
const lines = [];
info.scenes.forEach((s, si) => (s.speaks ?? []).forEach((k) => lines.push({ ...k, scene: s.id, si })));
lines.sort((a, b) => a.at - b.at);
console.log(`《${info.title}》· 音色 ${VOICE} · ${info.scenes.length} 幕 / ${lines.length} 句 / 总长 ${total}s\n`);

// ── 2. 逐句合成 + 量真实时长 ────────────────────────────────────
await mkdir(join(WORK, DECK), { recursive: true });
const rows = [];
for (let i = 0; i < lines.length; i++) {
  // 缓存名 = 音色+文本的内容哈希。**不要按序号命名** —— 排序一变序号就错位，
  // 会拿甲的音频去配乙的台词（这个坑真踩过：第一版用幕内相对时间排，改全局后全错）。
  const key = createHash('sha1').update(`${VOICE}\u0000${lines[i].text}`).digest('hex').slice(0, 12);
  const f = join(WORK, DECK, `${key}.aiff`);
  const cached = has('reuse') && await stat(f).then(() => true).catch(() => false);
  if (!cached) {
    const r = sh('say', ['-v', VOICE, '-o', f, lines[i].text]);
    if (r.status !== 0) { console.error(`✗ 合成失败：${lines[i].text}`); process.exit(2); }
  }
  const d = sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).stdout.trim();
  const real = parseFloat(d);
  const end = lines[i].at + real;
  // 逐句压缩到它自己的声明窗口里：tempo = 实测 / 窗口。
  // 这样**字幕窗口和声音按构造对齐** —— 不需要去拟合"中文每秒几个字"，
  // 也不需要为了迁就 TTS 去改 deck 的时间轴（时间轴是权威，音频适配它）。
  // 只加速、不减速：有余量的句子放它自然说完，硬拉长反而难听。
  const tempo = Math.min(CAP, Math.max(1, real / lines[i].dur));
  const fit = real / tempo;
  const next = lines[i + 1]?.at ?? Infinity;
  rows.push({ ...lines[i], i, file: f, real, tempo, fit, end: lines[i].at + fit,
    over: real - lines[i].dur, clash: lines[i].at + fit - next, needs: real / lines[i].dur });
}

const fmt = (n, w = 6, d = 2) => n.toFixed(d).padStart(w);
const hot = rows.filter((r) => r.needs > CAP + 1e-6);
console.log('  #  幕          起    窗口   实测   微调   静默/超支   末句相撞  台词');
console.log('  ─'.padEnd(66, '─'));
let bad = 0, clash = 0, maxOver = 0;
for (const r of rows) {
  const slack = r.dur - r.real;
  const over = slack < -0.15;
  const hit = r.clash > 0.02;
  if (over) bad++;
  if (hit) clash++;
  maxOver = Math.min(maxOver, slack);
  if (over || hit || has('all')) {
    console.log(`  ${String(r.i).padStart(2)}  ${r.scene.padEnd(11)} ${fmt(r.at)} ${fmt(r.dur)} ${fmt(r.real)} ${('×' + r.tempo.toFixed(2)).padStart(6)} ${fmt(slack)}  ${hit ? '撞 ' + r.clash.toFixed(2) + 's' : ''}  ${r.text.slice(0, 24)}`);
  }
}
console.log('  ─'.padEnd(66, '─'));
const tmax = Math.max(...rows.map((r) => r.tempo));
const slow = rows.filter((r) => r.tempo <= 1.001).length;
console.log(`  共 ${rows.length} 句 · 无需微调 ${slow} 句 · 最快 ×${tmax.toFixed(2)} · 与下一句相撞 ${clash} 句 · 最紧余量 ${maxOver.toFixed(2)}s`);
if (hot.length) console.log(`  ⚠ ${hot.length} 句需要超过 ×${CAP} 才塞得下（最快 ×${Math.max(...hot.map((r) => r.needs)).toFixed(2)}）—— 这几句的台词配不上它分到的时间`);
const speech = rows.reduce((a, r) => a + r.real, 0);
console.log(`  说话总时长 ${speech.toFixed(1)}s / 片长 ${total}s —— 静默占比 ${(100 * (1 - speech / total)).toFixed(0)}%\n`);

if (has('dump')) { console.log('DUMP ' + JSON.stringify(rows.map((r) => ({ text: r.text, dur: r.dur, real: r.real })))); process.exit(0); }

if (CHECK && (hot.length || clash)) {
  console.error(`✗ 配音塞不进时间轴：${hot.length} 句需要超过 ×${CAP}，${clash} 句仍撞到下一句。`);
  console.error('  改法：给该幕加时长、把旁白拆短，或跑 scripts/fix-speak-timing.mjs 重排时间点。');
  process.exit(1);
}

if (!BUILD) { console.log('（只对账。加 --build 产出音轨。）'); process.exit(0); }

// ── 3. 按 at 铺到时间轴：adelay 定位 + amix 叠 + apad/atrim 卡到精确总长 ──
const inputs = []; const chain = []; const labels = [];
inputs.push('-f', 'lavfi', '-i', `anullsrc=r=24000:cl=mono:d=${total}`);
chain.push(`[0:a]anull[base]`);
rows.forEach((r, k) => {
  inputs.push('-i', r.file);
  const L = `v${k}`;
  const tp = r.tempo > 1.001 ? `atempo=${r.tempo.toFixed(4)},` : '';
  chain.push(`[${k + 1}:a]aformat=sample_fmts=fltp:sample_rates=24000:channel_layouts=mono,${tp}adelay=${Math.round(r.at * 1000)}:all=1[${L}]`);
  labels.push(`[${L}]`);
});
chain.push(`${labels.join('')}amix=inputs=${rows.length}:normalize=0:duration=longest[mix]`);
chain.push(`[base][mix]amix=inputs=2:normalize=0:duration=longest[out0]`);
chain.push(`[out0]apad,atrim=0:${total},asetpts=N/SR/TB[out]`);

await mkdir(dirname(resolve(ROOT, OUT)), { recursive: true });
const ff = sh('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', chain.join(';'),
  '-map', '[out]', '-c:a', 'aac', '-b:a', '128k', resolve(ROOT, OUT)]);
if (ff.status !== 0) { console.error('✗ ffmpeg 失败：\n' + (ff.stderr || '')); process.exit(2); }
const voDur = parseFloat(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', resolve(ROOT, OUT)]).stdout.trim());
console.log(`✓ 音轨 ${OUT} —— ${voDur.toFixed(3)}s（片长 ${total.toFixed(3)}s，差 ${Math.abs(voDur - total).toFixed(3)}s）`);

// ── 4. 可选：mux 回视频（视频流 copy，不重编码）────────────────
if (MUX) {
  const inV = resolve(ROOT, MUX);
  const outV = inV.replace(/\.mp4$/, '-voiced.mp4');
  const r = sh('ffmpeg', ['-y', '-loglevel', 'error', '-i', inV, '-i', resolve(ROOT, OUT),
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-shortest', outV]);
  if (r.status !== 0) { console.error('✗ mux 失败：\n' + (r.stderr || '')); process.exit(2); }
  const vd = parseFloat(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', outV]).stdout.trim());
  console.log(`✓ 合成 ${outV.replace(ROOT + '/', '')} —— ${vd.toFixed(3)}s，含音轨`);
}
process.exit(0);
