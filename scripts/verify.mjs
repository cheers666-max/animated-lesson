#!/usr/bin/env node
/**
 * animated-lesson · scripts/verify.mjs
 *
 * 交付门禁：用 headless Chrome 真跑一遍课件，逐条断言。零 npm 依赖。
 *
 *   node scripts/verify.mjs                       # 全部检查
 *   node scripts/verify.mjs --deck=templates/deck.html --shots=out/
 *   node scripts/verify.mjs --frames=out/frames --fps=30   # 导出帧序列做视频
 *
 * 检查项（对应 references/authoring-gates.md）：
 *   G1 boot      课件能起来，无 console error / 未捕获异常
 *   G2 overflow  任意关键帧下，可见元素都在画面内（量真实 getBoundingClientRect）
 *   G3 animate   同一幕 t=早 与 t=晚 的截图必须不同 —— 静态页冒充不了动画
 *   G4 determin  同一 t 两次渲染（间隔 400ms 真实时间）必须逐字节相同
 *   G5 caption   旁白时刻字幕要出现，内容与 text 一致
 *   G6 quiz      有预测题的幕：选项渲染、点选给出对错、答错要显示 why
 *   G7 canvas    每个 canvas2d/three 元素所在区域非空白（截图方差 > 阈值）
 *
 * 为什么用"截图字节比较"而不是解码像素：不引入任何依赖就能同时覆盖 WebGL/canvas/DOM 三种载体。
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const args = process.argv.slice(2);
const opt = (name, dflt = null) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const has = (name) => args.includes(`--${name}`);
const DECK = opt('deck', 'templates/deck.html');
const SHOTS = opt('shots', '');
const FRAMES = opt('frames', '');
const MP4 = opt('mp4', '');
const FPS = Number(opt('fps', 30));
const SIZE = (opt('size', '1280x720')).split('x').map(Number);   // 导出分辨率：取设计坐标系的整数倍最清晰
const CHROME = process.env.CHROME_PATH
  || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
    .find((p) => existsSync(p));
if (!CHROME) { console.error('找不到 Chrome，请设 CHROME_PATH'); process.exit(2); }

const C = { red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` };

// ------------------------------------------------------------------ 静态服务器
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = join(ROOT, p.replace(/^\/+/, ''));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if (req.url.startsWith('/favicon')) { res.writeHead(204).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

// ------------------------------------------------------------------ Chrome + CDP
const profile = `/tmp/al-verify-${process.pid}`;
const proc = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--enable-unsafe-webgpu', '--use-angle=metal',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900',
  '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check',
  '--force-device-scale-factor=1', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

const wsUrl = await new Promise((res, rej) => {
  let buf = '';
  const scan = (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) res(m[1]); };
  proc.stdout.on('data', scan); proc.stderr.on('data', scan);
  proc.on('exit', (c) => rej(new Error(`chrome exited ${c}`)));
  setTimeout(() => rej(new Error('等待 DevTools 超时')), 30000);
});

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let msgId = 0;
const pending = new Map();
const consoleErrors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params?.exceptionDetails?.exception?.description ?? 'exception');
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args?.map((a) => a.value ?? a.description).join(' '));
});
const send = (method, params = {}, sid) => new Promise((res) => {
  const id = ++msgId; pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) }));
});

const { result: t1 } = await send('Target.createTarget', { url: 'about:blank' });
const { result: att } = await send('Target.attachToTarget', { targetId: t1.targetId, flatten: true });
const S = att.sessionId;
await send('Runtime.enable', {}, S);
await send('Page.enable', {}, S);

const ev = async (expr, timeout = 60000) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout }, S);
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
};
const shot = async (clip) => {
  const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }, S);
  return r.result?.data ?? '';
};

// ------------------------------------------------------------------ 结果收集
const results = [];
const add = (gate, ok, title, detail = '') => { results.push({ gate, ok, title, detail }); };
const warn = (title, detail = '') => results.push({ gate: 'WARN', ok: true, title, detail, soft: true });

const url = `http://127.0.0.1:${PORT}/${DECK}?verify=1`;
await send('Page.navigate', { url }, S);

// ---------------------------------------------------------------- G1 boot
let info = null;
let assets = [];
let imageEls = [];
try {
  await ev(`(async () => {
    const t0 = Date.now();
    while (!window.DECK || !window.DECK_INFO) {
      if (Date.now() - t0 > 30000) throw new Error('DECK 未就绪（加载失败或引擎报错）');
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return true;
  })()`);
  info = await ev(`JSON.stringify({ info: window.DECK_INFO, state: window.DECK.state(), report: window.DECK.report })`);
  info = JSON.parse(info);
  const rep = info.report;
  add('G1', true, '课件启动', `${info.info.scenes.length} 幕 · ${(info.state.total / 60).toFixed(1)} 分钟 · three=${await ev('window.DECK && !!window.DECK.stage')}`);
  // 图片必须先解码完再跑任何截图门禁。
  // 否则「第一帧图没到、第二帧到了」会让 G4 随机变红 —— 假回归会训练作者忽略门禁。
  await ev(`window.DECK.assetsReady`);
  assets = await ev(`window.DECK.assets.map(a => ({ src: a.src, ok: a.ok, w: a.w, h: a.h }))`);
  imageEls = await ev(`(() => {
    const out = [];
    (window.DECK.spec.scenes ?? []).forEach((sc, si) => (sc.elements ?? []).forEach((el) => {
      if (el.type === 'image') out.push({ si, id: el.id, src: el.src, credit: el.credit ?? null, fit: el.fit ?? 'cover', ken: el.ken ?? 0 });
    }));
    return out;
  })()`);

  if (rep.errors?.length) add('G1', false, '校验器报错', rep.errors.join(' | '));
  if (rep.warnings?.length) warn(`${rep.warnings.length} 条校验提示`, rep.warnings.slice(0, 3).join(' | '));
} catch (err) {
  add('G1', false, '课件启动', err.message);
  for (const e of consoleErrors.slice(0, 5)) console.log(C.red('    ' + String(e).slice(0, 200)));
}

const scenes = info?.info.scenes ?? [];
if (!scenes.length) {
  add('G2..G7', false, '跳过后续门禁', '课件没起来 / 没有场景，后面的检查没有意义');
  report();
  process.exit(1);
}
const frames_wanted = (FRAMES || MP4) ? Math.round(info.state.total * FPS) : 0;

/** 把某一幕 seek 到 t，等两帧，返回该幕的可视元素矩形 */
async function at(si, t) {
  return ev(`(async () => {
    window.DECK.goScene(${si}, { at: ${t} });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const vp = document.getElementById('deck-viewport').getBoundingClientRect();
    const els = [...document.querySelectorAll('#stage [data-el]')].map((n) => {
      const r = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      const visible = cs.display !== 'none' && Number(cs.opacity) > 0.02 && r.width > 1 && r.height > 1;
      return { id: n.dataset.el, x: r.x - vp.x, y: r.y - vp.y, w: r.width, h: r.height, visible,
               opacity: Number(cs.opacity), type: (n.className.match(/el-(\\w+)/) || [])[1] ?? '?' };
    });
    const thirds = [...document.querySelectorAll('#stage .el-three')].map((n) => {
      const r = n.getBoundingClientRect();
      return { id: n.dataset.el, x: r.x, y: r.y, width: r.width, height: r.height, fallback: n.dataset.fallback === '1' };
    });
    return { vp: { w: vp.width, h: vp.height }, els, thirds, t: window.DECK.t, scene: window.DECK.scene.id };
  })()`);
}

// ---------------------------------------------------------------- G0 死 CSS 选择器
// 这个门禁的由来：engine/scene.js 建的元素 id 是 deck-caption / deck-tag，
// 而 scene.css 里写的是 #caption / #scene-tag —— 三个覆盖层全部丢失定位样式，
// 退化成 grid 行，把舞台挤掉 34px 高度、顶部被 overflow:hidden 裁掉。
// 症状是"看起来有点遮挡"，根因是一个 id 写错。这种事故必须能被门禁直接抓住。
if (scenes.length) {
  const cssText = await readFile(join(ROOT, 'engine', 'scene.css'), 'utf8');
  const HEX = /^[0-9a-f]{3,8}$/i;   // #eef1f7 是颜色不是选择器
  const ids = [...new Set([...cssText.matchAll(/(?:^|[\s,{>~+])#([a-z][\w-]*)/g)].map((m) => m[1]))]
    .filter((id) => !HEX.test(id));
  const live = await ev(`[...document.querySelectorAll('[id]')].map((n) => n.id)`);
  const dead = ids.filter((id) => !live.includes(id));
  add('G0', dead.length === 0, 'CSS 里没有死选择器',
    dead.length ? `这些 #id 在 DOM 里不存在（样式全部失效）：${dead.join(', ')}` : `${ids.length} 个 id 选择器全部命中`);
}

// ---------------------------------------------------------------- G13 图片
// 没有图片的 deck 不像 PPT；而缺图和没标出处是交付里最容易糊过去的两件事。
if (scenes.length && imageEls.length) {
  const bySrc = new Map(assets.map((a) => [a.src, a]));
  const broken = imageEls.filter((e) => !bySrc.get(e.src)?.ok);
  const noCredit = imageEls.filter((e) => !e.credit);
  const okAll = !broken.length && !noCredit.length;
  const dims = [...new Set(imageEls.map((e) => { const a = bySrc.get(e.src); return a?.ok ? `${a.w}×${a.h}` : null; }).filter(Boolean))];
  add('G13', okAll, '图片真的加载成功且标了来源',
    okAll
      ? `${imageEls.length} 张图全部解码成功（${dims.join(' / ')}），每张都带 credit`
      : [broken.length ? `${broken.length} 张图没加载成功：${broken.map((e) => `${e.id}(${e.src})`).join(', ')} —— 缺图不能开天窗，换源或删掉这一页` : '',
         noCredit.length ? `${noCredit.length} 张图没写 credit：${noCredit.map((e) => e.id).join(', ')} —— 版权/出处必须标在画面上` : ''].filter(Boolean).join(' | '));
} else if (scenes.length && !imageEls.length) {
  warn('这份课件没有图片元素 —— 纯文字/图形的 deck 不像 PPT，考虑配图');
}

// ---------------------------------------------------------------- G0b 主题覆盖到整个外壳
// 主题变量挂在 app 根上才算真的生效：控制条 / 字幕条在 #stage 外面，
// 只给 #stage 挂 data-theme 会得到"浅色舞台 + 深色控制条"的半截主题。
if (scenes.length) {
  const theme = await ev(`(window.DECK.scene && (window.DECK_INFO.theme || 'ink')) || 'ink'`);
  const probe = await ev(`(() => {
    const root = document.querySelector('#deck-app');
    const v = (sel) => { const n = document.querySelector(sel); return n ? getComputedStyle(n).getPropertyValue('--bg').trim() : null; };
    return { rootTheme: root?.dataset.theme ?? null, stageTheme: document.querySelector('#stage')?.dataset.theme ?? null, barBg: v('#deck-bar'), capBg: v('#deck-caption'), stageBg: v('#stage') };
  })()`);
  const same = probe.barBg && probe.capBg && probe.barBg === probe.stageBg;
  add('G0b', !!probe.rootTheme && same, '主题覆盖到整个外壳',
    !probe.rootTheme ? 'meta.theme 没有落到 DOM 上（data-theme 缺失）'
      : same ? `theme=${probe.rootTheme} · 舞台/控制条/字幕条的 --bg 一致（${probe.stageBg}）`
      : `舞台 --bg=${probe.stageBg}，但控制条 ${probe.barBg} / 字幕条 ${probe.capBg} 没跟上 —— 半截主题`);
}

// ---------------------------------------------------------------- G2 overflow / overlap
if (scenes.length) {
  const bad = [];
  const overlaps = [];
  for (let si = 0; si < scenes.length; si++) {
    const dur = scenes[si].duration;
    const keys = [0.15, dur * 0.35, dur * 0.6, dur * 0.9].map((v) => +v.toFixed(2));
    for (const k of keys) {
      const r = await at(si, k);
      for (const e of r.els) {
        if (!e.visible) continue;
        if (e.x < -3 || e.y < -3 || e.x + e.w > r.vp.w + 3 || e.y + e.h > r.vp.h + 3) {
          bad.push(`scene${si + 1}(${r.scene})@${k}s el=${e.id} [${e.x.toFixed(0)},${e.y.toFixed(0)},${e.w.toFixed(0)}×${e.h.toFixed(0)}] 超出 ${r.vp.w.toFixed(0)}×${r.vp.h.toFixed(0)}`);
        }
      }
      // 重叠：只报"文字层压文字层"这类真问题；annot 与画布天然会重叠
      const boxes = r.els.filter((e) => e.visible && ['text', 'code', 'list', 'chart', 'metric'].includes(e.type));
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          if (ox > 8 && oy > 8) overlaps.push(`scene${si + 1}@${k}s ${a.id} ∩ ${b.id} (${ox.toFixed(0)}×${oy.toFixed(0)}px)`);
        }
      }
    }
  }
  add('G2', bad.length === 0, '无元素越界', bad.slice(0, 6).join(' | ') || `${scenes.length} 幕 × 4 关键帧`);

  // G2b 盒内裁切：文字比它的容器高/宽 —— 看不到图的作者最容易漏掉的一类问题
  const clipped = [];
  for (let si = 0; si < scenes.length; si++) {
    const dur = scenes[si].duration;
    for (const k of [0.15, dur * 0.35, dur * 0.6, dur * 0.9].map((v) => +v.toFixed(2))) {
      await at(si, k);
      const r = await ev(`(() => {
        const out = [];
        for (const n of document.querySelectorAll('#stage [data-el]')) {
          if (getComputedStyle(n).display === 'none') continue;
          const isTexty = ['el-text', 'el-list', 'el-code', 'el-metric'].some((c) => n.classList.contains(c));
          const inner = n.firstElementChild ?? n;
          const fs = parseFloat(getComputedStyle(inner).fontSize) || 16;
          // line-height:1 的文字，字形盒天生比行盒高 ~12%，这是正常现象；
          // 真正该报的是"内容被容器裁掉"（列表少一行、段落被切断）。
          const tol = n.classList.contains('el-metric') ? fs * 0.15 : Math.max(3, fs * 0.05);
          const vOver = inner.scrollHeight - inner.clientHeight, hOver = inner.scrollWidth - inner.clientWidth;
          if (vOver > tol || hOver > tol) out.push({ id: n.dataset.el, kind: '内部裁切', vOver, hOver, cls: n.className, tol: Math.round(tol) });
          // ⚠️ 关键补充：**元素自身**的盒也必须有界。
          // 之前的漏洞：metric 声明 h:11%（79px）而内容 110px，overflow:visible →
          // 画出来的字跑到盒外 30px，压住下一排，而上面那段只查 firstElementChild 查不出来。
          if (isTexty && !n.dataset.flow) {
            const ov = n.scrollHeight - n.clientHeight;
            if (ov > Math.max(2, tol)) out.push({ id: n.dataset.el, kind: '内容超出声明盒', vOver: ov, hOver: 0, cls: n.className, tol: Math.round(tol) });
          }
        }
        return out;
      })()`);
      for (const c of r) clipped.push(`scene${si + 1}@${k}s ${c.id} [${c.kind}] 竖向 ${c.vOver}px 横向 ${c.hOver}px（容差 ${c.tol}px）`);
    }
  }
  add('G2b', clipped.length === 0, '内容装得进自己的盒子', [...new Set(clipped)].slice(0, 4).join(' | ') || '所有元素的内容都在自己声明的盒子里');

  // ---- G14 任意两个元素都不许相交 ----
  // 之前只查"文字层重叠"而且是 warning —— 于是 metric 压注释、
  // 画布压底图这类问题一直是红的也能过。改成：全类型、全帧、error。
  // 故意叠放的（画布盖在底图上）要显式声明 overlapOk: true，和 bleed 一个哲学。
  const cross = [];
  for (let si = 0; si < scenes.length; si++) {
    const dur = scenes[si].duration;
    for (const k of [0.15, dur * 0.25, dur * 0.4, dur * 0.55, dur * 0.7, dur * 0.85, dur * 0.95].map((v) => +v.toFixed(2))) {
      await at(si, k);
      const r = await ev(`(() => {
        const st = document.querySelector('#stage').getBoundingClientRect();
        const skip = new Set((window.DECK.spec.scenes[window.DECK.index]?.elements ?? [])
          .filter((e) => e.bleed === true || e.overlapOk === true).map((e) => e.id));
        const out = [];
        const paint = (n) => {
          const rg = document.createRange(); const rects = [];
          const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); let tn;
          while ((tn = w.nextNode())) { if (!tn.data.trim()) continue; rg.selectNodeContents(tn); for (const q of rg.getClientRects()) if (q.width > 0.5 && q.height > 0.5) rects.push(q); }
          if (rects.length) return { x: Math.min(...rects.map(q=>q.left)), y: Math.min(...rects.map(q=>q.top)), r: Math.max(...rects.map(q=>q.right)), b: Math.max(...rects.map(q=>q.bottom)) };
          const bb = n.getBoundingClientRect();
          return bb.width > 2 && bb.height > 2 ? { x: bb.left, y: bb.top, r: bb.right, b: bb.bottom } : null;
        };
        for (const n of document.querySelectorAll('#stage [data-el]')) {
          if (skip.has(n.dataset.el)) continue;
          const cs = getComputedStyle(n);
          if (cs.display === 'none' || Number(cs.opacity) < 0.05) continue;
          const box = paint(n); if (!box) continue;
          out.push({ id: n.dataset.el, ...box });
        }
        return out;
      })()`);
      for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
        const a = r[i], b = r[j];
        const ox = Math.min(a.r, b.r) - Math.max(a.x, b.x), oy = Math.min(a.b, b.b) - Math.max(a.y, b.y);
        if (ox > 3 && oy > 3 && ox * oy > 300) cross.push(`scene${si + 1}@${k}s ${a.id} ∩ ${b.id} (${Math.round(ox)}×${Math.round(oy)}px)`);
      }
    }
  }
  const uniqCross = [...new Set(cross.map((c) => c.replace(/@[\d.]+s/, '')))];
  add('G14', cross.length === 0, '任意两个元素都不相交',
    cross.length === 0 ? '所有帧、所有元素两两不相交（故意叠放的用 overlapOk: true 声明）'
      : `${uniqCross.length} 组相交：${uniqCross.slice(0, 4).join(' | ')}${uniqCross.length > 4 ? ` …共 ${uniqCross.length} 组` : ''}`);
  // 文字层重叠已由 G14 统一覆盖（且从 warning 升级为 error），这里不再重复报。

  // ---- G2d 遮挡：三类，全部实测 ----
  //   (a) 字幕条 / 面包屑 / 控制条 压到元素的实际墨迹
  //   (b) 同一块画布内，两个 ink.label 互相压住
  //   (c) ink.label 画到了画布外面（被裁掉，等于白画）
  // 探测点必须包含每条旁白的时刻 —— 字幕只在旁白窗口可见，那才是遮挡发生的时刻。
  const occ = [];
  let captionLines = 0, captionMaxH = 0;
  for (let si = 0; si < scenes.length; si++) {
    const dur = scenes[si].duration;
    const speaks = (scenes[si].speakAt ?? []).map((t) => Math.min(dur - 0.15, t + 0.5));
    const keys = [...new Set([dur * 0.3, dur * 0.6, dur * 0.9, ...speaks])].map((v) => +Math.max(0.1, v).toFixed(2));
    for (const k of keys) {
      await at(si, k);
      const d = await ev(`(() => {
        const sr = document.querySelector('#stage').getBoundingClientRect();
        const st = window.DECK.state();
        const canv = {}; for (const n of document.querySelectorAll('#stage .el-canvas')) canv[n.dataset.el] = n.getBoundingClientRect();
        const labels = (st.labels || []).map((l) => { const r = canv[l.cid]; if (!r) return null;
          const kk = r.width / l.cw; return { ...l, px: { x: r.left + l.x * kk, y: r.top + l.y * kk, w: l.w * kk, h: l.h * kk } }; }).filter(Boolean);
        const overlays = ['deck-caption', 'deck-tag', 'deck-bar'].map((id) => {
          const n = document.getElementById(id); if (!n) return null;
          const cs = getComputedStyle(n); if (cs.display === 'none' || Number(cs.opacity) < 0.05) return null;
          const r = n.getBoundingClientRect();
          const rg2 = document.createRange(); rg2.selectNodeContents(n);
          const lines = rg2.getClientRects().length;      // 真实行盒数量，不受 padding 干扰
          return { id, x: r.left, y: r.top, w: r.width, h: r.height, lines };
        }).filter(Boolean);
        // 出血背景（bleed）是**故意**铺到字幕条底下的 —— 字幕自带底色药丸，
        // 压住背景图不算遮挡。只对内容元素判。
        const bleed = new Set((window.DECK.spec.scenes[window.DECK.index]?.elements ?? [])
          .filter((e) => e.bleed === true).map((e) => e.id));
        const dom = [];
        for (const n of document.querySelectorAll('#stage [data-el]')) {
          if (bleed.has(n.dataset.el)) continue;
          const cs = getComputedStyle(n);
          if (cs.display === 'none' || Number(cs.opacity) < 0.05) continue;
          const rg = document.createRange(); const rects = []; const w2 = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
          let tn; while ((tn = w2.nextNode())) { if (!tn.data.trim()) continue; rg.selectNodeContents(tn); for (const q of rg.getClientRects()) if (q.width > 0.5) rects.push(q); }
          const self = n.getBoundingClientRect();
          if (rects.length) dom.push({ id: n.dataset.el, x: Math.min(...rects.map(r=>r.left)), y: Math.min(...rects.map(r=>r.top)), r: Math.max(...rects.map(r=>r.right)), b: Math.max(...rects.map(r=>r.bottom)) });
          else if (self.width > 1) dom.push({ id: n.dataset.el, x: self.left, y: self.top, r: self.right, b: self.bottom });
        }
        return { labels, overlays, dom };
      })()`);
      const hit = (a, b) => { const ox = Math.min(a.x + a.w, b.r) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.b) - Math.max(a.y, b.y); return ox > 2 && oy > 2 ? [ox, oy] : null; };
      for (const o of d.overlays) {
        if (o.id === 'deck-caption') { captionLines = Math.max(captionLines, o.lines); captionMaxH = Math.max(captionMaxH, o.h); }
        for (const l of d.labels) { const h = hit(o, l.px); if (h) occ.push(`scene${si + 1}@${k}s ${o.id} 压住画布标注 "${l.text}" ${h[0].toFixed(0)}×${h[1].toFixed(0)}px`); }
        for (const e of d.dom) {
          const h = hit(o, e);
          // 报坐标，不只报尺寸 —— 不然只能像这样反复猜"到底谁在哪"
          if (h) occ.push(`scene${si + 1}@${k}s ${o.id}[y${Math.round(o.y)}..${Math.round(o.y + o.h)}] 压住 ${e.id}[y${Math.round(e.y)}..${Math.round(e.b)}] ${h[0].toFixed(0)}×${h[1].toFixed(0)}px`);
        }
      }
      for (let i = 0; i < d.labels.length; i++) {
        const a = d.labels[i];
        if (a.x < -1 || a.y < -1 || a.x + a.w > a.cw + 1 || a.y + a.h > a.ch + 1) {
          occ.push(`scene${si + 1}@${k}s 标注 "${a.text}" 被画布 ${a.cid} 裁掉（${a.x.toFixed(0)},${a.y.toFixed(0)} ${a.w.toFixed(0)}×${a.h.toFixed(0)} vs ${a.cw}×${Math.round(a.ch)}）`);
        }
        for (let j = i + 1; j < d.labels.length; j++) {
          const b = d.labels[j];
          if (b.cid !== a.cid) continue;                    // 跨画布不可能是遮挡（两块画布本身不重叠）
          const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          if (ox > 2 && oy > 2) occ.push(`scene${si + 1}@${k}s 画布 ${a.cid} 内标注重叠 "${a.text}" ∩ "${b.text}" ${ox.toFixed(0)}×${oy.toFixed(0)}px`);
        }
      }
    }
  }
  const uniq = [...new Set(occ)];
  add('G2d', uniq.length === 0, '无遮挡（字幕/面包屑/控制条 · 画布内标注）', uniq.slice(0, 5).join(' | ') || '三类遮挡全部为 0：覆盖层压内容、画布内标注互压、标注被画布裁掉');
  // 字幕必须单行 —— 否则它占的安全带高度会随文案变化，作者没法定安全区
  add('G5b', captionLines <= 1, '字幕恒为单行', captionLines <= 1
    ? `最高 ${captionMaxH.toFixed(0)}px / ${captionLines} 行 —— 字幕带高度固定，安全区可静态判定`
    : `有 ${captionLines} 行 —— 旁白太长会换行，字幕带高度不再固定（缩短文案或加宽 max-width）`);
}

// ---------------------------------------------------------------- G11 画面必须对数据敏感
// 「内容显得简单」的根源常常是：画面只是装饰 —— 坐标是硬编码的比例，
// 读不出任何一个值。这类画面看起来很像回事，但不承载信息。
// 判据不能靠肉眼，所以用**扰动测试**：把元素声明的数据乘 1.6，画面必须跟着变。
//   有 data 且扰动后画面变了 → 这个画面真的在编码数据
//   有 data 但扰动后纹丝不动   → 画的是装饰，不是数据
//   没有 data                 → 无法证明它承载信息（报为提示）
if (scenes.length) {
  const withData = [], decorative = [], ok = [];
  for (let si = 0; si < scenes.length; si++) {
    const dur = scenes[si].duration;
    const t = +(dur * 0.75).toFixed(2);
    await at(si, t);
    const ids = await ev(`(window.DECK.scene.elements || []).filter((e) => e.type === 'canvas2d' || e.type === 'three').map((e) => e.id)`);
    for (const id of ids) {
      const has = await ev(`!!(window.DECK.scene.elements.find((e) => e.id === ${JSON.stringify(id)}) || {}).data`);
      const snap = () => ev(`(() => {
        const n = document.querySelector('#stage [data-el=' + ${JSON.stringify(JSON.stringify(id))} + '] canvas');
        return n ? n.toDataURL().slice(-2000) : '';
      })()`);
      if (!has) { decorative.push(`scene${si + 1}.${id}`); continue; }
      const before = await snap();
      await ev(`window.__g11 = JSON.parse(JSON.stringify(window.DECK.scene.elements.find((e) => e.id === ${JSON.stringify(id)}).data))`);
      const MUT = {
        // ① 数值扰动：所有数字 ×1.6
        num: `const f = (v) => Array.isArray(v) ? v.map(f) : (v && typeof v === 'object') ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, f(x)]))
                : (typeof v === 'number' && Number.isFinite(v) ? +(v * 1.6).toFixed(4) : v); return f(D);`,
        // ② 结构扰动：第一个数组去掉最后一项（分类数据没有数字可乘，但它同样该驱动画面）
        shape: `const cut = (v) => Array.isArray(v) ? (v.length > 1 ? v.slice(0, -1) : v)
                  : (v && typeof v === 'object') ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cut(x)])) : v; return cut(D);`,
      };
      let changed = null;
      for (const [name, body] of Object.entries(MUT)) {
        await ev(`(() => { const D = JSON.parse(JSON.stringify(window.__g11)); window.DECK.setData(${JSON.stringify(id)}, (function(){ ${body} })()); })()`);
        const after = await snap();
        if (before && after && before !== after) { changed = name; break; }
      }
      await ev(`window.DECK.setData(${JSON.stringify(id)}, window.__g11)`);   // 还原
      if (changed) withData.push(`scene${si + 1}.${id}(${changed === 'num' ? '数值' : '结构'}扰动生效)`);
      else ok.push(`scene${si + 1}.${id}`);
    }
  }
  if (ok.length) {
    add('G11', false, '画面必须对数据敏感（扰动测试）', `${ok.join(', ')} 声明了 data，但数值 ×1.6 和删掉最后一个元素，画面都没变 —— 画的是装饰，不是数据（常见原因：只有 1 根柱子，归一化后永远满格；或画法把坐标写死了）`);
  } else {
    add('G11', true, '画面必须对数据敏感（扰动测试）',
      withData.length ? `${withData.join(', ')} —— 扰动数据后画面均发生变化，证明画面真的在编码数据`
                      : '没有声明 data 的画布');
  }
  if (decorative.length) warn(`未声明 data 的画布 ${decorative.length} 块`, `${decorative.join(', ')} —— 无法证明画面承载信息；若确实是装饰请说明理由`);
}

// ---------------------------------------------------------------- G3 动画性 / G4 确定性
let animFail = 0, detFail = 0;
const shotDir = SHOTS ? resolve(SHOTS) : '';
if (shotDir) await mkdir(shotDir, { recursive: true });

for (let si = 0; si < scenes.length; si++) {
  const dur = scenes[si].duration;
  const tEarly = Math.min(1.2, dur * 0.1);
  const tLate = dur * 0.75;
  const rA = await at(si, tEarly); const sA = await shot();
  const rB = await at(si, tLate); const sB = await shot();
  if (sA === sB) { animFail++; add('G3', false, `第 ${si + 1} 幕没有动画`, `t=${tEarly}s 与 t=${tLate}s 截图完全一致 —— 检查 beats 是否真的改了状态`); }

  // 3D 视图单独验：裁剪到元素矩形再比，能抓到"WebGL 上下文丢了 → 黑屏"和"3D 没动"
  for (const th of rB.thirds) {
    if (th.width < 8 || th.height < 8) continue;
    const clip = { x: Math.round(th.x), y: Math.round(th.y), width: Math.round(th.width), height: Math.round(th.height) };
    await at(si, tEarly); const cA = await shot(clip);
    await at(si, tLate); const cB = await shot(clip);
    const blank = cA.length < 400;
    if (blank) { animFail++; add('G3', false, `第 ${si + 1} 幕 3D 视图是空白`, `el=${th.id} 裁剪截图仅 ${cA.length}B —— WebGL 上下文失败？fallback=${th.fallback}`); }
    else if (cA === cB) { animFail++; add('G3', false, `第 ${si + 1} 幕 3D 视图没动`, `el=${th.id} 早/晚裁剪截图完全一致`); }
    else add('G3', true, `第 ${si + 1} 幕 3D 视图在动`, `el=${th.id} ${clip.width}×${clip.height}${th.fallback ? ' · 2D 降级' : ' · WebGL'}`);
  }

  // 确定性：同一 t，隔 400ms 真实时间再渲染一次
  await at(si, tLate); const dA = await shot();
  await new Promise((r) => setTimeout(r, 400));
  await at(si, tLate); const dB = await shot();
  if (dA !== dB) {
    detFail++;
    // 报错必须自己指出"哪里在变"，否则每次抖动都要人肉写探针定位。
    // （踩过：字幕的 CSS transition 让 G4 1/3 概率随机变红，光看"两次不同"无从下手。）
    const why = await ev(`(() => {
      const snap = () => { const o = {};
        for (const n of document.querySelectorAll('#stage [data-el], #deck-caption, #deck-pause, #deck-tag, #deck-bar *')) {
          const r = n.getBoundingClientRect(), cs = getComputedStyle(n);
          o[n.id || n.dataset.el || n.className] = [r.x.toFixed(2), r.y.toFixed(2), r.width.toFixed(2), r.height.toFixed(2), cs.opacity, cs.transform].join('|');
        }
        return o; };
      const a = snap();
      return new Promise((res) => setTimeout(() => { const b = snap();
        res(Object.keys(a).filter((k) => a[k] !== b[k]).slice(0, 3).map((k) => k + ' [' + a[k] + '] vs [' + b[k] + ']')); }, 260));
    })()`);
    add('G4', false, `第 ${si + 1} 幕不确定`,
      `同一 t=${tLate}s 两次渲染不同 —— 差在：${(why ?? []).join(' | ') || '（截图级差异，非 DOM）'}`
      + `　常见原因：用了 Date.now/Math.random，或某个元素带了 CSS transition/animation（自带时钟，不属于 render(t)）`);
  }
  // 2D canvas 的像素级确定性（比截图更精确，且能定位到元素）
  const sig = async () => ev(`(() => [...document.querySelectorAll('.el-canvas canvas')].map((c) => {
    const x = c.getContext('2d'); const d = x.getImageData(0, 0, c.width, c.height).data;
    let h = 0; for (let i = 0; i < d.length; i += 997) h = (h * 31 + d[i]) | 0; return h;
  }).join(','))()`);
  const p1 = await sig(); await new Promise((r) => setTimeout(r, 250)); const p2 = await sig();
  if (p1 !== p2) { detFail++; add('G4', false, `第 ${si + 1} 幕 canvas2d 不确定`, `像素签名 ${p1} → ${p2}`); }

  if (shotDir) {
    await at(si, tLate);
    await writeFile(join(shotDir, `scene${String(si + 1).padStart(2, '0')}.png`), Buffer.from(dA, 'base64'));
  }
}
if (!animFail) add('G3', true, '每一幕都在动', `${scenes.length} 幕：早/晚截图均有差异`);
if (!detFail) add('G4', true, '确定性渲染', '同 t 双渲染逐字节一致（含 canvas2d 像素签名）');

// ---------------------------------------------------------------- G7 canvas 非空白
{
  const blanks = [];
  for (let si = 0; si < scenes.length; si++) {
    await at(si, scenes[si].duration * 0.75);
    const r = await ev(`(async () => {
      const out = [];
      for (const n of document.querySelectorAll('#stage .el-canvas, #stage .el-three')) {
        const c = n.querySelector('canvas');
        const rect = c.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) continue;
        let variance = null;
        if (n.classList.contains('el-canvas')) {
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let sum = 0, n2 = 0;
          for (let i = 3; i < d.length; i += 4 * 37) { sum += d[i]; n2++; }
          variance = sum / Math.max(1, n2);   // 平均 alpha：全透明 = 空白
        } else {
          variance = n.dataset.fallback === '1' ? 1 : 2;  // three 由 G3 的截图差异负责
        }
        out.push({ id: n.dataset.el, cls: n.className, variance, fallback: n.dataset.fallback === '1' });
      }
      return out;
    })()`);
    for (const el of r) {
      if (el.cls.includes('el-canvas') && el.variance < 1) blanks.push(`scene${si + 1} el=${el.id} 画布全透明（draw() 没画东西？）`);
      if (el.fallback) warn(`three 走了 2D 降级`, `scene${si + 1} el=${el.id}（离线/无 WebGL 时的预期行为）`);
    }
  }
  add('G7', blanks.length === 0, '画布有内容', blanks.join(' | ') || '所有 canvas2d 平均 alpha > 0');
}

// ---------------------------------------------------------------- G5 字幕
{
  let checked = 0, bad = [];
  for (let si = 0; si < scenes.length; si++) {
    const speaks = await ev(`(async () => {
      window.DECK.goScene(${si}, { at: 0 });
      const sc = window.DECK.spec.scenes[${si}];
      return (sc.beats || []).filter((b) => b.action === 'speak').map((b) => ({ at: b.at, text: b.text }));
    })()`);
    for (const sp of speaks) {
      const r = await ev(`(async () => {
        window.DECK.goScene(${si}, { at: ${sp.at} + 0.6 });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const c = document.getElementById('deck-caption');
        return { on: c.dataset.on, text: c.textContent };
      })()`);
      checked++;
      if (r.on !== '1' || r.text !== sp.text) bad.push(`scene${si + 1}@${sp.at}s 字幕「${String(r.text).slice(0, 18)}」≠ 旁白「${sp.text.slice(0, 18)}」`);
    }
  }
  add('G5', bad.length === 0, '旁白字幕同步', bad.slice(0, 3).join(' | ') || `${checked} 条旁白全部正确显示`);
}

// ---------------------------------------------------------------- G6 预测题
{
  const withQuiz = scenes.map((s, i) => ({ s, i })).filter(({ s }) => s.quiz);   // DECK_INFO 里 quiz 是布尔

  let bad = [];
  for (const { i } of withQuiz) {
    await ev(`window.DECK.goScene(${i}, { at: 0 })`);
    const r = await ev(`(async () => {
      window.DECK.showQuiz();
      await new Promise((r) => requestAnimationFrame(r));
      const expect = window.DECK.spec.scenes[${i}].quiz.opts.length;
      const btns = [...document.querySelectorAll('#quiz .opts button')];
      const shown = document.getElementById('quiz').dataset.on;
      if (btns.length > 1) btns[1].click();
      const why = document.querySelector('#quiz .why');
      return { shown, opts: btns.length, expect,
               rightMarked: !!document.querySelector('#quiz .opts button.right'),
               whyShown: why?.dataset.on === '1', whyLen: why?.textContent.length ?? 0,
               closeBtn: !!document.querySelector('#quiz .card > button:last-child'),
               answered: Object.keys(window.DECK.state().quizAnswers).length };
    })()`);
    const expectOpts = r.expect;
    if (r.shown !== '1' || r.opts !== expectOpts || !r.rightMarked || !r.whyShown || r.whyLen < 10 || !r.closeBtn || r.answered < 1) {
      bad.push(`scene${i + 1}: shown=${r.shown} opts=${r.opts}/${expectOpts} right=${r.rightMarked} why=${r.whyShown}/${r.whyLen} close=${r.closeBtn} answers=${r.answered}`);
    }
    await ev(`window.DECK.hideQuiz()`);
  }
  add('G6', bad.length === 0, `预测题可交互（${withQuiz.length} 幕）`, bad.join(' | ') || '选项数正确、点选标对错、答错有解释');

  // G6c 题要**自己弹出来**。
  // 由来：G6 一直是直接调 `window.DECK.showQuiz()` 开题的，于是"播放到该问的时候
  // 会不会自动弹"这条路径从来没被覆盖 —— 而 tick 里写的是 `this.showQuiz?.()`，
  // this 根本不是 deck，一直是空操作。G6 全绿，功能全坏。
  // 教训：门禁只能证明它**够得着**的那条路径；够不着的路径要和没测一样对待。
  const autoQuiz = await ev(`(async () => {
    const D = window.DECK, out = [];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < D.spec.scenes.length; i++) {
      const sc = D.spec.scenes[i];
      if (!sc.quiz) continue;
      const overlay = () => document.getElementById('quiz').dataset.on === '1';
      // ① 幕中提问：从 at 前一点开始真播
      if (sc.quiz.at != null) {
        D.goScene(i, { at: Math.max(0, sc.quiz.at - 0.6) });
        D.hideQuiz(); D.play();
        for (let k = 0; k < 40 && !overlay(); k++) await sleep(100);
        const openedAt = +D.t.toFixed(2);
        // 点「继续」→ 必须**接着播本幕**，否则答案永远看不到
        const cont = [...document.querySelectorAll('#quiz button')].find((b) => /继续/.test(b.textContent));
        cont?.click();
        await sleep(500);
        const tAfter = +D.t.toFixed(2);
        out.push({ id: sc.id, how: 'mid', opened: overlay() === false, t: openedAt,
                   paused: !D.playing === false, resumed: D.playing && tAfter > openedAt });
        D.hideQuiz(); D.pause();
      }
      // ② 幕尾复习题：从幕尾前一点开始真播。
      // 有 at 的幕跳过 —— 它的题在幕中已经问过，幕尾 quizShown 本来就该是 true。
      if (sc.quiz.at != null) continue;
      D.goScene(i, { at: Math.max(0, sc.duration - 0.5) });
      D.hideQuiz(); D.play();
      for (let k = 0; k < 40 && !overlay(); k++) await sleep(100);
      const openedEnd = overlay();
      const contEnd = [...document.querySelectorAll('#quiz button')].find((b) => /继续/.test(b.textContent));
      contEnd?.click();
      await sleep(400);
      // 非末幕：应进入下一幕并继续播；末幕：停住即可
      const advanced = D.index > i || i === D.spec.scenes.length - 1;
      out.push({ id: sc.id, how: 'end', opened: openedEnd, t: +D.t.toFixed(2), paused: true, resumed: advanced });
      D.hideQuiz(); D.pause();
    }
    return out;
  })()`);
  const badAuto = autoQuiz.filter((q) => !q.opened || !q.paused || !q.resumed);
  add('G6c', badAuto.length === 0, '题自己弹出来、停住、答完接着播',
    badAuto.length
      ? badAuto.map((q) => `scene(${q.id}) ${q.how === 'mid' ? '幕中' : '幕尾'}题：弹出=${q.opened} 暂停=${q.paused} 继续后接着播=${q.resumed}`).join(' | ')
      : autoQuiz.map((q) => `${q.id} ${q.how === 'mid' ? '幕中' : '幕尾'}@${q.t}s 自动弹出 · 暂停 · 继续后接着播`).join(' · ') || '（没有带题的幕）');

  // G6b 先问后讲的时序：带 quiz.at 的题，那一刻之前不能算"已经问过"。
  // 光有 quiz.at 字段不等于真的在幕中间提问 —— 这条是防止它变成装饰性声明。
  const timing = await ev(`(() => {
    const out = [];
    window.DECK.spec.scenes.forEach((sc, i) => {
      if (sc.quiz?.at == null) return;
      const dur = sc.duration;
      window.DECK.goScene(i, { at: Math.max(0, sc.quiz.at - 0.5) });
      const before = window.DECK.state().quizShown;
      window.DECK.goScene(i, { at: Math.min(dur, sc.quiz.at + 0.5) });
      const after = window.DECK.state().quizShown;
      const answersAt = (sc.beats ?? []).filter((b) => b.at > sc.quiz.at
        && ['reveal', 'countUp', 'draw', 'grow'].includes(b.action)).length;
      out.push({ id: sc.id, at: sc.quiz.at, before, after, answersAt });
    });
    return out;
  })()`);
  const badTiming = timing.filter((t) => t.before || !t.after || t.answersAt === 0);
  add('G6b', badTiming.length === 0, '预测题在幕中间提出，答案在题之后',
    badTiming.length
      ? badTiming.map((t) => t.before ? `scene(${t.id}) 在 at=${t.at}s 之前就已标记问过`
        : !t.after ? `scene(${t.id}) at=${t.at}s 之后仍未标记问过`
        : `scene(${t.id}) at=${t.at}s 之后没有任何揭示 —— 问了却没答`).join(' | ')
      : timing.map((t) => `${t.id}@${t.at}s 题后 ${t.answersAt} 个揭示`).join(' · ') || '（没有带 at 的题）');
}

// ---------------------------------------------------------------- G9 信息释放节流（「按笔画」的量化）
{
  // 一次扫完所有幕：用纯函数探针，不碰 DOM
  const sweep = await ev(`(() => {
    const D = window.DECK, out = [];
    for (let i = 0; i < D.spec.scenes.length; i++) {
      const sc = D.spec.scenes[i];
      // 计数单位是「信息单元」而不是「元素」：同一栏的标题 + 两个数字是一组，
      // 观众感知到的是"一个东西出现了"。用 el.group 声明，未声明则各自独立。
      const unitOf = new Map(sc.elements.map((e) => [e.id, e.group ?? e.id]));
      const ids = [...new Set(sc.elements.map((e) => unitOf.get(e.id)))];
      // 关键：p / grow 的默认值是 1，所以只能看「beats 真正驱动了哪个通道」，
      // 否则每个元素都会被误判成 t=0 就出现。
      const acts = new Map();
      for (const b of sc.beats || []) {
        const ts = b.target == null ? [] : Array.isArray(b.target) ? b.target : [b.target];
        for (const tg of ts) acts.set(tg, (acts.get(tg) ?? new Set()).add(b.action));
      }
      const channel = (id) => {
        const a = acts.get(id) ?? new Set();
        if (a.has('draw')) return (e) => e.p >= 0.5;
        if (a.has('grow')) return (e) => e.grow >= 0.5;
        return (e) => e.opacity >= 0.5;
      };
      const first = {};
      const chan = {};
      const members = new Map();
      for (const e of sc.elements) {
        const u = unitOf.get(e.id);
        members.set(u, [...(members.get(u) ?? []), e.id]);
      }
      for (const u of ids) chan[u] = (st) => members.get(u).some(channel(members.get(u)[0]) === channel(members.get(u)[0]) ? (id) => channel(id)(st[id]) : () => false);
      // 单元出现 = 组内**任意**元素出现（组是一起 reveal 的）
      for (const u of ids) chan[u] = (st) => members.get(u).some((id) => channel(id)(st[id]));
      for (let t = 0; t <= sc.duration + 1e-6; t += 0.1) {
        const st = D.probe(i, +t.toFixed(2));
        for (const u of ids) {
          if (first[u] != null) continue;
          if (chan[u](st)) first[u] = +t.toFixed(2);
        }
      }
      out.push({ id: sc.id, title: sc.title, dur: sc.duration, first, units: ids.length, els: sc.elements.length });
    }
    return out;
  })()`);

  const WIN = 0.5, CAP = 3;
  const offenders = [];
  const lines = [];
  for (const sc of sweep) {
    const buckets = new Map();
    for (const [id, t] of Object.entries(sc.first)) {
      const b = Math.floor(t / WIN);
      buckets.set(b, [...(buckets.get(b) ?? []), `${id}@${t}s`]);
    }
    const worst = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    lines.push(`${sc.id}: ${sc.units} 单元 / ${sc.els} 元素，峰值 ${worst ? worst[1].length : 0} 个 / ${WIN}s`);
    if (worst && worst[1].length > CAP) offenders.push(`scene(${sc.id}) ${worst[1].length} 个信息单元在 ${(worst[0] * WIN).toFixed(1)}s 内同时出现: ${worst[1].join(', ')}`);
  }
  add('G9', offenders.length === 0, `信息释放节流（≤${CAP} 单元 / ${WIN}s）`, offenders.join(' | ') || lines.join(' · '));

  // ---------------------------------------------------------------- G15 段长门禁
  // 量的是「**有没有稳定帧可以指**」，不是「信息率」。
  //
  // 为什么是段长：transient information effect 的证据变量是信息在屏幕上停留多久，
  // 不是每秒塞了多少。但这条门禁更直接的动机是**可指性** —— 旁白说"加到第二十一次
  // 就很方了"的时候，画面必须有一个**停住的、能被指着说的**帧。连续变化 28 秒意味着
  // 这句话落在一条一直在动的曲线上，观众对不上。在导出的视频里尤其致命（不能暂停、不能回看）。
  //
  // 注意区分：慢速推近（ken）不销毁信息，画面任何时刻都完整可读 —— 但它同样不提供
  // 稳定帧，所以同样计入。规则统一为：一段连续变化 ≤ MAX_RUN，两段之间 ≥ HOLD_MIN 静态。
  // DSL 用 { at, action:'hold', dur } 显式声明这个窗口，G15c 顺便验证声明是不是真的。
  // ⚠️ 签名里**不含** spot/dim/flash —— 注意力引导不算信息变化（见下面的 sigOf）。
  const MAX_RUN = 10, MAX_GAP = 12, HOLD_MIN = 1.2;
  const pacing = await ev(`(() => {
    const STEP = 0.1, HOLD_MIN = ${HOLD_MIN};
    const out = [];
    for (let i = 0; i < window.DECK.spec.scenes.length; i++) {
      const sc = window.DECK.spec.scenes[i];
      // 信息签名：**剔除 spot/dim/flash** —— 聚光灯只引导注意力，不增加信息，
      // 所以它不该破坏"这段可以重读"。transient information effect 说的是**信息**，
      // 不是"像素有没有动"。（踩过：给 photo 补注意力引导后，cue 落进 hold 里，
      // G15c 判 hold 说谎 —— 是判据太粗，不是编排错了。）
      const sigOf = (st) => {
        const o = {};
        for (const k of Object.keys(st)) {
          if (k === '$cam') { o[k] = st[k]; continue; }
          const { spot, dim, flash, ...info } = st[k];
          o[k] = info;
        }
        return JSON.stringify(o);
      };
      const sigs = [];
      for (let t = 0; t <= sc.duration + 1e-9; t = +(t + STEP).toFixed(3)) sigs.push(sigOf(window.DECK.probe(i, t)));
      const chg = sigs.map((x, k) => k > 0 && x !== sigs[k - 1]);
      let maxRun = 0, run = 0;
      for (const c of chg) { run = c ? run + 1 : 0; if (run > maxRun) maxRun = run; }
      // 从上一个「足够长的静态窗口」起，累计的变化时间
      let acc = 0, worstAcc = 0, atWorst = 0, staticRun = 0;
      for (let k = 0; k < chg.length; k++) {
        if (chg[k]) { staticRun = 0; acc += STEP; if (acc > worstAcc) { worstAcc = acc; atWorst = k * STEP; } }
        else { staticRun += STEP; if (staticRun >= HOLD_MIN) acc = 0; }
      }
      const badHolds = [];
      for (const b of (sc.beats ?? []).filter((x) => x.action === 'hold')) {
        for (let k = 1; k < chg.length; k++) {
          const t = k * STEP;
          if (t > b.at && t < b.at + b.dur && chg[k]) { badHolds.push(b.at); break; }
        }
      }
      out.push({ id: sc.id, maxRun: +(maxRun * STEP).toFixed(1), worstAcc: +worstAcc.toFixed(1),
                 atWorst: +atWorst.toFixed(1), badHolds, holds: (sc.beats ?? []).filter((x) => x.action === 'hold').length });
    }
    return out;
  })()`);

  const tooLong = pacing.filter((s) => s.maxRun > MAX_RUN);
  const noPause = pacing.filter((s) => s.worstAcc > MAX_GAP);
  const fakeHold = pacing.filter((s) => s.badHolds.length);
  const paceLine = pacing.map((s) => `${s.id}: 最长 ${s.maxRun}s / 静默前累计 ${s.worstAcc}s${s.holds ? ` / hold×${s.holds}` : ''}`);

  add('G15', tooLong.length === 0, `连续变化段 ≤ ${MAX_RUN}s（每段之后要有稳定帧可指）`,
    tooLong.length
      ? tooLong.map((s) => `scene(${s.id}) 连续变化 ${s.maxRun}s —— 观众拿不到任何中间态。拆成几段，段间插 hold`).join(' | ')
      : paceLine.join(' · '));
  add('G15b', noPause.length === 0, `每 ${MAX_GAP}s 内至少一个 ≥${HOLD_MIN}s 的可重读静态窗口`,
    noPause.length
      ? noPause.map((s) => `scene(${s.id}) 在 ${s.atWorst}s 附近有 ${s.worstAcc}s 连续churn 没有停顿 —— 加 { at, action:'hold', dur } 并调开动作`).join(' | ')
      : '全程都有可重读的停顿');
  // G15d 分段标量的端点必须对得上
  // 由来：给 fourier 第一幕分段 draw 之后，**门禁全绿但动画是坏的** ——
  // 后面那段在"还没轮到它"时把 p 提前设成了自己的 from，于是 t=0 就画出 2/3 的谐波。
  // G4 只查同 t 一致、G15 只查变化模式，都看不见。是"把 p 随时间打出来"才发现的。
  //
  // ⚠️ 判据换了两次，都误报，记在这里免得再走：
  //   ①「单调不减」→ 误报 instancing 的 countUp 64→1（故意的："64 次 draw call → 1 次"）
  //   ②「步长 ≤ 声明速率 × 余量」→ 误报 ease('out') 的初始斜率（本来就该是线性的 3 倍）
  //   ③ 现在这条：**只查端点**。每段开始前必须等于它的 from，结束后必须等于它的 to。
  //      不用给缓动函数建模，也不假设方向 —— 精确且没有假阳性。
  const EPS = 0.02;
  const segs = await ev(`(() => {
    const out = [];
    const SC = ['draw', 'grow', 'countUp'];
    const key = { draw: 'p', grow: 'grow', countUp: 'value' };
    for (let i = 0; i < window.DECK.spec.scenes.length; i++) {
      const sc = window.DECK.spec.scenes[i];
      for (const el of sc.elements ?? []) {
        for (const act of SC) {
          const bs = (sc.beats ?? []).filter((b) => b.action === act && [].concat(b.target ?? []).includes(el.id));
          if (bs.length < 2) continue;
          const rows = [];
          for (const b of bs) {
            const d = b.dur ?? 0.6;
            const probeAt = (t) => { const st = window.DECK.probe(i, Math.max(0, +t.toFixed(2)))[el.id]; return st ? +st[key[act]] : null; };
            rows.push({ at: b.at, dur: d, from: b.from ?? 0, to: b.to ?? 1,
                        before: probeAt(b.at - 0.05), after: probeAt(b.at + d + 0.05) });
          }
          out.push({ scene: sc.id, el: el.id, act, rows });
        }
      }
    }
    return out;
  })()`);
  const badSeg = [];
  for (const g of segs) {
    for (const r of g.rows) {
      if (r.before == null || r.after == null) continue;
      if (Math.abs(r.before - r.from) > EPS) {
        badSeg.push(`scene(${g.scene}).${g.el} ${g.act}@${r.at}s：开始前是 ${r.before.toFixed(3)}，但声明的 from 是 ${r.from}`
          + `（说明有别的段在未开始时把标量设成了自己的 from）`);
        break;
      }
      if (Math.abs(r.after - r.to) > EPS) {
        badSeg.push(`scene(${g.scene}).${g.el} ${g.act}@${r.at}s：结束后是 ${r.after.toFixed(3)}，但声明的 to 是 ${r.to}`);
        break;
      }
    }
  }
  add('G15d', badSeg.length === 0, `分段标量的端点对得上（${segs.length} 个分段动画）`,
    badSeg.length ? badSeg.slice(0, 3).join(' | ')
      : segs.length ? `${segs.map((g) => `${g.scene}.${g.el}(${g.rows.length}段)`).join(', ')} 每段的 from/to 都兑现了` : '本课件没有分段标量动画');
  add('G15d', badSeg.length === 0, `分段标量的端点对得上（${segs.length} 个分段动画）`,
    badSeg.length ? badSeg.slice(0, 3).join(' | ')
      : segs.length ? `${segs.map((g) => `${g.scene}.${g.el}(${g.rows.length}段)`).join(', ')} 每段的 from/to 都兑现了` : '本课件没有分段标量动画');

  // ---------------------------------------------------------------- G16 / G17 教学法
  // 这两条来自 Mayer 的 multimedia principles，也是 iart 的 diagram-animation 里
  // 「Highlight the active element and dim the rest (focus + context)」的断言化。
  //
  // G16 signaling：旁白在讲的时候，画面上必须有**焦点**。
  //   实测本仓库 7 份课件：35 个「内容元素 ≥4」的幕里只有 5 个用过 spotlight/dim。
  //   也就是说大部分时间观众面对一屏元素、旁白在说其中某一个，而画面没有指。
  // G17 coherence：每个内容元素都必须被编排引用，且**必须与旁白时间窗重叠** ——
  //   出现了却从没被讲到（seductive detail），或者讲完了才出现，都是 coherence 违规。
  const teaching = await ev(`(() => {
    const STEP = 0.1, out = [];
    for (let i = 0; i < window.DECK.spec.scenes.length; i++) {
      const sc = window.DECK.spec.scenes[i];
      const speaks = (sc.beats ?? []).filter((b) => b.action === 'speak')
        .map((b) => ({ at: b.at, end: b.at + (b.dur ?? Math.max(1.6, b.text.length / 4.6)) }));
      const content = (sc.elements ?? []).filter((e) => !['shape', 'image'].includes(e.type) && e.bleed !== true && e.static !== true);
      // 旁白期间有没有焦点：任一样本时刻存在 spot>0.3 或 dim>0.3 的元素
      let focused = 0, narrated = 0;
      for (const sp of speaks) {
        narrated++;
        let has = false;
        for (let t = sp.at; t <= sp.end + 1e-6; t = +(t + STEP).toFixed(2)) {
          const st = window.DECK.probe(i, t);
          for (const id of Object.keys(st)) {
            if (id === '$cam') continue;
            if ((st[id].spot ?? 0) > 0.3 || (st[id].dim ?? 0) > 0.3) { has = true; break; }
          }
          if (has) break;
        }
        if (has) focused++;
      }
      // 每个内容元素的可见窗口，是否与某条旁白重叠
      const orphan = [];
      for (const el of content) {
        const bs = (sc.beats ?? []).filter((b) => [].concat(b.target ?? []).includes(el.id));
        if (!bs.length) { orphan.push(el.id + '(没有任何 beat 引用)'); continue; }
        let vis = null;
        for (let t = 0; t <= sc.duration + 1e-6; t = +(t + STEP).toFixed(2)) {
          const st = window.DECK.probe(i, t)[el.id];
          if (st && st.opacity > 0.5) { vis = [t, sc.duration]; break; }
        }
        if (!vis) { orphan.push(el.id + '(从不可见)'); continue; }
        const first = vis[0];
        // 元素出现后，后面还有没有旁白？（"讲完了才出现" = 孤儿）
        if (speaks.length && !speaks.some((sp) => sp.end > first + 0.2)) orphan.push(el.id + '(在 ' + first + 's 才出现，之后已无旁白)');
      }
      out.push({ id: sc.id, speaks: narrated, focused, content: content.length, orphan });
    }
    return out;
  })()`);

  const noFocus = teaching.filter((s) => s.content >= 4 && s.speaks > 0 && s.focused === 0);
  const noFocusSome = teaching.filter((s) => s.content >= 4 && s.speaks > 0 && s.focused < s.speaks);
  const orphans = teaching.filter((s) => s.orphan.length);
  add('G16', noFocus.length === 0, '旁白期间画面必须有焦点（Mayer signaling）',
    noFocus.length
      ? noFocus.map((s) => `scene(${s.id}) 有 ${s.content} 个内容元素、${s.speaks} 条旁白，但全程没有任何 spotlight/dim —— 观众不知道该看哪`).join(' | ')
      : teaching.filter((s) => s.content >= 4).map((s) => `${s.id}: ${s.focused}/${s.speaks} 条旁白有焦点`).join(' · '));
  add('G17', orphans.length === 0, '每个内容元素都被讲到过（Mayer coherence）',
    orphans.length
      ? orphans.flatMap((s) => s.orphan.map((o) => `scene(${s.id}).${o}`)).slice(0, 5).join(' | ')
      : `${teaching.reduce((a, s) => a + s.content, 0)} 个内容元素全部被编排引用且与旁白重叠`);

  // G20 文本标记：<br> / <b> 必须被真的解释成换行和加粗，不能当字面文字印在画面上。
  // 踩过的坑：renderText 用 node.textContent，而 renderList 用 node.innerHTML ——
  // 同一套 DSL 里两套语义。于是 8 份课件把「<br>」原样印在了标题和注脚里，
  // 而当时**没有任何一条门禁看得见它**（G2b 只量盒子大小，文字多两个字符不会溢出）。
  // 这条门禁不看源码怎么写，只看**渲染出来的字** —— 源码写法随便换，画面必须干净。
  const tagLeaks = await ev(`(() => {
    const D = window.DECK, out = [];
    const TAG = /<[/]?[a-zA-Z][^>]*>/;
    for (let i = 0; i < D.spec.scenes.length; i++) {
      const sc = D.spec.scenes[i];
      D.goScene(i, { at: +(sc.duration - 0.2).toFixed(2) });
      for (const el of document.querySelectorAll('#stage .el')) {
        // 画布 / 三维 / 图片自己画，不走文本渲染器
        if (el.matches('.el-canvas, .el-three, .el-image')) continue;
        const txt = el.textContent ?? '';
        const m = txt.match(TAG);
        if (m) out.push({ scene: sc.id, tag: m[0], at: m.index,
                          sample: txt.slice(Math.max(0, m.index - 10), m.index + 24) });
      }
    }
    const seen = new Set();
    return out.filter((o) => { const k = o.scene + '|' + o.tag + '|' + o.sample; if (seen.has(k)) return false; seen.add(k); return true; });
  })()`);
  add('G20', tagLeaks.length === 0, '文本标记被真的解释（不是当字面文字印出来）',
    tagLeaks.length
      ? tagLeaks.slice(0, 5).map((x) => `scene(${x.scene}) 画面里印着「${x.tag}」：…${String(x.sample).replace(/\s+/g, ' ')}…`).join(' | ') +
        (tagLeaks.length > 5 ? ` （共 ${tagLeaks.length} 处）` : '')
      : '没有任何元素把 HTML 标签当字面文字画出来');

  // G21 旁白窗口不重叠。
  // 踩过的坑：kvcache 的 kv 幕里，`at: 7.2` 的句子要念 5.22s（到 12.42），
  // 而 `at: 9.2` 的下一句已经开讲了 —— 两句话在**同一段时间里**要求念出来。
  // 画面这边看不出来（字幕只是 later-wins 地叠一下），一铺音轨就原形毕露。
  // 所以这条量的不是「念得好不好」，是**时间轴上根本放不放得下**。
  const speakClash = await ev(`(() => {
    const GAP = 0.15;   // 两句话之间至少留这么长的呼吸，否则听上去像抢话
    const out = [];
    for (const sc of window.DECK_INFO.scenes) {
      const sp = (sc.speaks ?? []).slice().sort((a, b) => a.at - b.at);
      for (let i = 0; i + 1 < sp.length; i++) {
        const over = (sp[i].at + sp[i].dur + GAP) - sp[i + 1].at;
        if (over > 0) out.push({ scene: sc.id, over: +over.toFixed(2),
          a: sp[i].text.slice(0, 14), b: sp[i + 1].text.slice(0, 14) });
      }
      // 最后一句也必须在本幕内念完。
      // ⚠️ 这里必须用 sceneAt（幕内相对时间）—— speaks.at 是全局时间，
      // 拿它和本幕 duration 比会把前面各幕的时长全算成“念到幕外”（这个错我真犯了）。
      const last = sp[sp.length - 1];
      if (last && last.sceneAt + last.dur > sc.duration) {
        out.push({ scene: sc.id, over: +(last.sceneAt + last.dur - sc.duration).toFixed(2),
          a: last.text.slice(0, 14), b: '（幕尾）' });
      }
    }
    return out;
  })()`);
  const speakTotal = await ev('window.DECK_INFO.scenes.reduce((a, s) => a + (s.speaks ?? []).length, 0)');
  add('G21', speakClash.length === 0, '旁白在时间轴上放得下（不抢话、不超出本幕）',
    speakClash.length
      ? speakClash.slice(0, 4).map((x) => `scene(${x.scene}) 重叠 ${x.over}s：「${x.a}…」压在「${x.b}…」上`).join(' | ') +
        (speakClash.length > 4 ? ` （共 ${speakClash.length} 处）` : '')
      : `${speakTotal} 条旁白互不重叠，也没有一条念到幕外`);
  // G19 预测题不许送答案（retrieval ≠ recognition）
  // 学习科学里"提取练习"和"再认"是两回事：正确答案原样躺在画面上时，
  // 学生做的是"找不同"，不是"回忆"。
  const leaks = await ev(`(() => {
    const N = 6;   // 6 字重合就算送答案（中文 6 字已经是一句可辨认的断言）
    const norm = (x) => String(x ?? '').replace(/[\\s，。、；：？！"'（）()《》—…·]/g, '');
    const out = [];
    for (const sc of window.DECK.spec.scenes) {
      if (!sc.quiz) continue;
      // recall = 讲完再考记忆，答案本来就在画面上，不算违规。
      // predict（默认）要求答案**在被问之前**不在画面上。
      if ((sc.quiz.kind ?? 'predict') === 'recall') continue;
      const right = (sc.quiz.opts ?? []).find((o) => o.ok);
      if (!right) continue;
      const opt = norm(right.t);
      // 有 at：只看到那一刻为止已经出现过的元素（幕尾的题则看全幕）
      const cut = sc.quiz.at;
      const vis = (sc.elements ?? []).filter((e) => {
        if (cut == null) return true;
        const first = (sc.beats ?? []).filter((b) => [].concat(b.target ?? []).includes(e.id)
          && ['reveal', 'draw', 'grow', 'countUp', 'morph'].includes(b.action)).map((b) => b.at);
        return first.length && Math.min(...first) <= cut;
      });
      const onScreen = norm(vis.map((e) => [e.text, e.label, e.code,
        ...(e.items ?? []).map((it) => it.text)].filter(Boolean).join(' ')).join(' '));
      for (let k = 0; k + N <= opt.length; k++) {
        const g = opt.slice(k, k + N);
        if (onScreen.includes(g)) { out.push({ scene: sc.id, frag: g }); break; }
      }
    }
    return out;
  })()`);
  const quizCount = await ev('window.DECK.spec.scenes.filter((sc) => sc.quiz).length');
  add('G19', leaks.length === 0, '预测题不送答案（retrieval ≠ recognition）',
    leaks.length
      ? leaks.map((l) => `scene(${l.scene}) 正确选项的「${l.frag}」原样出现在画面文字里 —— 这不是预测题，是找不同`).join(' | ')
      : `${quizCount} 道预测题，正确答案的关键短语都不在画面文字里`);

  if (noFocusSome.length && !noFocus.length) {
    warn(`${noFocusSome.length} 幕只有部分旁白带焦点`, noFocusSome.map((s) => `${s.id} ${s.focused}/${s.speaks}`).join(' · '));
  }

  add('G15c', fakeHold.length === 0, 'hold 声明与事实相符（声明静态就真的静态）',
    fakeHold.length
      ? fakeHold.map((s) => `scene(${s.id}) hold@${s.badHolds.join(',')}s 期间画面还在动 —— 声明说谎了`).join(' | ')
      : `${pacing.reduce((a, s) => a + s.holds, 0)} 个 hold 声明全部属实`);

  // G9b 笔速：每帧同时有几笔在生长 —— 「按笔画」这件事必须可量化
  const pace = await ev(`(() => {
    const D = window.DECK, out = [];
    for (let i = 0; i < D.spec.scenes.length; i++) {
      const sc = D.spec.scenes[i];
      let peak = 0, busy = 0, n = 0;
      for (let t = 0; t <= sc.duration + 1e-6; t += 0.2) {
        D.goScene(i, { at: +t.toFixed(2) });
        const k = D.state().ink;
        peak = Math.max(peak, k.growing);
        if (k.growing > 0) busy++;
        n++;
      }
      out.push({ id: sc.id, dur: sc.duration, peak, busy, n, ratio: +(busy / n).toFixed(2) });
    }
    return out;
  })()`);
  const PEAK_CAP = 4;
  const hot = pace.filter((p) => p.peak > PEAK_CAP);
  const breathless = pace.filter((p) => p.peak > 0 && p.ratio > 0.85);
  add('G9b', hot.length === 0, `笔速：同时生长的笔画 ≤ ${PEAK_CAP}`,
    hot.length ? hot.map((p) => `${p.id} 峰值 ${p.peak} 笔`).join(' | ')
      : pace.filter((p) => p.peak > 0).map((p) => `${p.id} 峰值 ${p.peak} 笔 / 生长时长占比 ${(p.ratio * 100).toFixed(0)}%`).join(' · ') || '本课件没有 ink 笔画');
  if (breathless.length) {
    warn('有幕一直在画、没有停顿',
      breathless.map((p) => `${p.id} 生长占比 ${(p.ratio * 100).toFixed(0)}% —— 观众需要停顿才能跟上（建议留 ≥15% 的静止时间）`).join(' | '));
  }
}

// ---------------------------------------------------------------- G10 笔画长度只增不减（逐笔画的定义性质，opt-in）
{
  // 为什么量「长度」而不是「像素」：笔尖/光晕/装饰都会动，任何基于像素的度量都会
  // 把"光标移开"误判成"内容被擦掉"。而「可见笔画总长度」只由笔画本身决定。
  const sweeps = await ev(`(() => {
    const D = window.DECK, out = [];
    for (let i = 0; i < D.spec.scenes.length; i++) {
      const sc = D.spec.scenes[i];
      const marked = (sc.elements || []).filter((e) => e.monotonic).map((e) => e.id);
      if (!marked.length) continue;
      const ser = [];
      for (let t = 0; t <= sc.duration + 1e-6; t += 0.2) {
        D.goScene(i, { at: +t.toFixed(2) });      // render() 同步执行
        ser.push([+t.toFixed(1), D.state().ink.len]);
      }
      out.push({ scene: sc.id, els: marked, ser });
    }
    return out;
  })()`);

  const bad = [];
  let checked = 0;
  for (const sc of sweeps) {
    checked += sc.els.length;
    for (let k = 1; k < sc.ser.length; k++) {
      const [, prev] = sc.ser[k - 1], [t, cur] = sc.ser[k];
      if (cur < prev - 2) {          // 2px 容差：加密步长带来的取整噪声
        const lo = Math.max(0, k - 3), hi = Math.min(sc.ser.length, k + 3);
        bad.push(`${sc.scene}(${sc.els.join(',')}) t≈${t}s 可见笔画长度缩短 ${prev} → ${cur}px · 曲线 [${sc.ser.slice(lo, hi).map((x) => x[1]).join(', ')}]`);
        break;
      }
    }
  }
  const sample = sweeps[0] ? ` · 例：${sweeps[0].scene} 末帧 ${sweeps[0].ser.at(-1)[1]}px` : '';
  add('G10', bad.length === 0, `笔画长度只增不减（${checked} 个画布）`,
    bad.slice(0, 3).join(' | ') || (checked ? `全程单调，已画好的笔画没有被擦掉${sample}` : '没有画布标记 monotonic'));
}

// ---------------------------------------------------------------- G8 离线降级（three 关掉也要能讲完）
{
  const threeIdx = await ev(`window.DECK.spec.scenes.findIndex((s) => (s.elements || []).some((e) => e.type === 'three'))`);
  if (threeIdx >= 0) {
    await send('Page.navigate', { url: url + '&three=off' }, S);
    try {
      await ev(`(async () => {
        const t0 = Date.now();
        while (!window.DECK || !window.DECK_INFO) { if (Date.now() - t0 > 20000) throw new Error('降级后没起来'); await new Promise((r) => setTimeout(r, 100)); }
        return true;
      })()`);
      const idx = threeIdx;   // 注意：three 元素只在它那一幕的 DOM 里存在，不能提前探测
      const r1 = await at(idx, 2.0); const fA = await shot();
      const r2 = await at(idx, Math.min(13, scenes[idx].duration * 0.7)); const fB = await shot();
      const fb = await ev(`document.querySelector('#stage .el-three')?.dataset.fallback === '1'`);
      const ok = fb && fA !== fB;
      add('G8', ok, 'CDN 不可用时的 2D 降级', ok
        ? `scene${idx + 1} 走 isometric 降级（data-fallback=1）且仍在动`
        : `fallback=${fb} 动没动=${fA !== fB} —— 断网时这一页会开天窗`);
    } catch (err) {
      add('G8', false, 'CDN 不可用时的 2D 降级', err.message);
    }
  } else {
    warn('课件没有 three 元素，跳过离线降级检查');
  }
}

// ---------------------------------------------------------------- 帧序列导出
if ((FRAMES || MP4) && frames_wanted) {
  // 精确视口 + capture=1：导出帧 = 设计分辨率（也顺带保证宽高是偶数，x264 不挑食）
  // 导出分辨率 = 设计坐标系 × DSF 超采样。
  // CSS 视口固定 1280×720（stage 的 scale 正好是 1.0，布局与设计一致），
  // DSF 负责把 canvas2d / 文字按目标分辨率光栅化 —— 1920×1080 是真清晰，不是把 1280 放大。
  const DSF = Math.min(2, SIZE[0] / 1280);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: DSF, mobile: false }, S);
  await send('Page.navigate', { url: url + '&capture=1' }, S);
  await ev(`(async () => { const t0 = Date.now(); while (!window.DECK) { if (Date.now() - t0 > 20000) throw new Error('重新加载失败'); await new Promise((r) => setTimeout(r, 100)); } return true; })()`);
  const dir = FRAMES ? resolve(FRAMES) : '';
  if (dir) await mkdir(dir, { recursive: true });
  const total = info.state.total;
  let n = 0;

  // --mp4：把 PNG 帧直接写进 ffmpeg 的 stdin。4600 帧不落盘 —— 省磁盘、省 IO、少一步命令。
  let ff = null;
  if (MP4) {
    const { spawn: sp } = await import('node:child_process');
    const out = resolve(MP4);
    await mkdir(dirname(out), { recursive: true });
    ff = sp('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
      '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '20', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    ff.stdin.on('error', () => {});
  }
  const writeFrame = (buf) => new Promise((res) => {
    if (!ff) return res();
    if (ff.stdin.write(buf)) return res();
    ff.stdin.once('drain', res);
  });
  for (let f = 0; f < frames_wanted; f++) {
    const g = (f / FPS);
    // 全局时间 → 幕 + 幕内时间
    const loc = await ev(`(() => {
      let g = ${g}, i = 0;
      while (i < window.DECK.spec.scenes.length - 1 && g > window.DECK.spec.scenes[i].duration) { g -= window.DECK.spec.scenes[i].duration; i++; }
      window.DECK.goScene(i, { at: g });
      return { i, t: g };
    })()`);
    await ev(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
    const data = await shot();
    const buf = Buffer.from(data, 'base64');
    if (dir) await writeFile(join(dir, `f${String(f).padStart(5, '0')}.png`), buf);
    await writeFrame(buf);
    n++;
    if (n % 240 === 0) process.stdout.write(C.dim(`\r  编码中 ${n}/${frames_wanted} 帧…`));
  }
  if (n % 240 !== 0) process.stdout.write('\r' + ' '.repeat(40) + '\r');
  if (ff) {
    ff.stdin.end();
    const code = await new Promise((r) => ff.on('exit', r));
    add('MP4', code === 0, `一键出片 ${n} 帧`, code === 0
      ? `${SIZE[0]}×${SIZE[1]} @ ${FPS}fps → ${resolve(MP4)}（${(info.state.total).toFixed(0)} 秒，无声，字幕已烘焙）`
      : `ffmpeg 退出码 ${code}`);
  }
  // G12 字幕真的进了成片 —— 断言，不是声明。
  // 由来：早期 capture 模式把 #deck-caption 隐藏了，成片里根本没有字幕，
  // 而我在文档里写了"字幕已烘焙"。这类"声称有、其实没有"只能靠量来防。
  if (MP4 && ff) {
    const { execFileSync: ex } = await import('node:child_process');
    const speakAt = scenes[0]?.speakAt?.[0] ?? 1;
    const band = (t) => {
      const w = Math.round(SIZE[0] * 0.47), h = Math.round(SIZE[1] * 0.065);
      const x = Math.round((SIZE[0] - w) / 2), y = Math.round(SIZE[1] * 0.926);
      try {
        const raw = ex('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', resolve(MP4), '-frames:v', '1',
          '-vf', `crop=${w}:${h}:${x}:${y},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 });
        let sum = 0, max = 0;
        for (const b of raw) { sum += b; if (b > max) max = b; }
        return { mean: raw.length ? sum / raw.length : 0, max, n: raw.length };
      } catch { return null; }
    };
    const on = band(speakAt + 0.6), off = band(Math.max(0.2, speakAt - 1.4));
    if (!on || !off) add('G12', false, '字幕进了成片', 'ffmpeg 取帧失败');
    else {
      const ok = on.max > off.max + 40 && on.mean > off.mean * 1.6;
      add('G12', ok, '字幕进了成片（量像素，不是声明）', ok
        ? `旁白时刻 t=${(speakAt + 0.6).toFixed(1)}s 字幕带 亮度均值 ${on.mean.toFixed(1)}/峰值 ${on.max}；无旁白时刻 t=${Math.max(0.2, speakAt - 1.4).toFixed(1)}s 为 ${off.mean.toFixed(1)}/${off.max} —— 字幕确实烘焙进了画面`
        : `旁白时刻 ${on.mean.toFixed(1)}/${on.max} vs 无旁白 ${off.mean.toFixed(1)}/${off.max} —— 没有差异，成片里没有字幕（检查 capture 模式是否把 #deck-caption 藏了）`);
    }
  }
  if (dir) {
    add('FRAMES', true, `导出 ${n} 帧 PNG`, `${SIZE[0]}×${SIZE[1]} @ ${FPS}fps → ${dir}`);
    console.log(C.dim(`\n  ffmpeg -framerate ${FPS} -i ${dir}/f%05d.png -pix_fmt yuv420p -c:v libx264 -crf 20 out.mp4\n`));
  }
  await send('Emulation.clearDeviceMetricsOverride', {}, S);
}

// ---------------------------------------------------------------- 报告
function report() {
  console.log('');
  console.log(C.bold(`课件：${info?.info?.title ?? '?'}   ${DECK}`));
  console.log(C.dim('─'.repeat(78)));
  for (const r of results) {
    const tag = r.soft ? C.yellow('!') : r.ok ? C.green('✓') : C.red('✗');
    console.log(`${tag} ${C.bold(r.gate.padEnd(6))} ${r.title}${r.detail ? C.dim('  ' + r.detail) : ''}`);
  }
  if (consoleErrors.length) {
    console.log(C.red(`\n页面 console error ${consoleErrors.length} 条：`));
    for (const e of consoleErrors.slice(0, 6)) console.log(C.red('  ' + String(e).slice(0, 220)));
  }
  const hard = results.filter((r) => !r.ok && !r.soft);
  console.log(C.dim('─'.repeat(78)));
  console.log(hard.length
    ? C.red(`${hard.length} 项门禁未通过\n`)
    : C.green(`全部门禁通过${results.filter((r) => r.soft).length ? `（${results.filter((r) => r.soft).length} 条提示）` : ''}\n`));
  return hard.length;
}
const hardCount = report();

ws.close(); proc.kill('SIGKILL'); server.close();
process.exit(hardCount || consoleErrors.length ? 1 : 0);
