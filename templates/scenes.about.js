/**
 * templates/scenes.about.js —— 元课件：用这个模式介绍这个模式
 *
 * 一边讲「按笔画 / 确定性时间轴 / 注意力控制 / 可验证」，一边画面就在做这件事。
 * 媒介即信息：讲逐笔时画面正逐笔，讲 spotlight 时画面正 spotlight，
 * 讲门禁时画面正在逐个点亮门禁。
 *
 * 内容结构（对应用户要的四个问题）：
 *   背景（为什么是现在）→ 问题（PPT 的三个结构性缺陷）
 *   → 优势（确定性 / 过程可见 / 注意力可控 / 可验证）
 *   → 场景（该用 vs 不该用）→ 人群（四类人，四种用法）→ 边界与结论
 *
 * 确定性：无 Date.now / Math.random / performance.now。
 */

const clamp01 = (p) => Math.max(0, Math.min(1, p));

/** 逐笔工具：第 k 笔画完才轮到第 k+1 笔（见 references/stroke-drawing.md） */
function strokesOf(ctx, list, p, ink, pal) {
  const total = clamp01(p) * list.length;
  list.forEach((st, i) => {
    const local = clamp01(total - i);
    if (local <= 0) return;
    const o = { color: pal[st.tone] ?? st.tone ?? pal.accent, width: st.width ?? 2.5, glow: st.glow, dash: st.dash, alpha: st.alpha };
    const head = st.cubic ? ink.cubic(ctx, st.cubic, local, o) : ink.path(ctx, st.pts, local, o);
    const fade = clamp01((1 - local) / 0.14);
    if (fade > 0) ink.nib(ctx, head, o.color, (st.nib ?? 4.5) * (0.65 + 0.35 * fade), fade);
  });
}

// ================================================================= 各幕画法

/**
 * 01 背景：**真实时间轴**（不是装饰性曲线）
 *
 * 旧版本画的是三条硬编码比例的上升曲线 —— 看着像回事，但读不出任何一个值。
 * 现在横轴是真实年份，每个标记是一次真实发布，位置由 api.data 决定：
 * 数据一改，标记就移动（G11 会扰动数据来验证这一点）。
 * 画面上能直接读出的量：Chrome 113 → Safari 26 的差距 = 2 年 4 个月。
 */
function drawTimeline(ctx, t, el, api) {
  const { w, h, ink, palette: pal } = api;
  const p = api.state.p;
  const D = api.data;
  if (!D) return;
  const [t0, t1] = D.span;
  // 左侧 0.26w 是泳道名的排水沟 —— 否则"Chrome / Edge"会和第一个标记的标签叠在一起（实测 37×13px）
  const X = (year) => w * 0.27 + ((year - t0) / (t1 - t0)) * w * 0.69;
  const yA = h * 0.78;

  // ---- 阶段 A（p 0→0.3）：时间轴 + 年份刻度
  const axisP = clamp01(p / 0.3);
  const years = D.years ?? [];
  strokesOf(ctx, [
    { pts: [[X(t0), yA], [X(t1), yA]], tone: 'line', width: 1.5, nib: 0 },
    ...years.map((y) => ({ pts: [[X(y), yA], [X(y), yA - 6]], tone: 'line', width: 1.2, nib: 0 })),
  ], axisP, ink, pal);
  if (axisP > 0.35) years.forEach((y) => ink.label(ctx, String(y), X(y), yA + 14, { color: pal.muted, align: 'center', font: '11px ui-monospace, monospace' }));

  // ---- 阶段 B（p 0.3→0.75）：泳道名 + 标记，一条泳道一条泳道地出现
  const laneP = clamp01((p - 0.3) / 0.45) * D.lanes.length;
  D.lanes.forEach((lane, i) => {
    const local = clamp01(laneP - i);
    if (local <= 0) return;
    const y = h * (0.13 + i * 0.21);
    const col = pal[lane.tone] ?? pal.accent;
    // 泳道基线
    ctx.save(); ctx.globalAlpha = local * 0.5; ctx.strokeStyle = pal.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(t0), y); ctx.lineTo(X(t1), y); ctx.stroke(); ctx.restore();
    ink.label(ctx, lane.name, w * 0.245, y, { color: col, alpha: local, align: 'right', font: 'bold 11px ui-monospace, monospace' });
    lane.marks.forEach((mk, j) => {
      const ml = clamp01(local * lane.marks.length - j);
      if (ml <= 0) return;
      const mx = X(mk.at);
      ctx.save(); ctx.globalAlpha = ml;
      ctx.strokeStyle = col; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(mx, y); ctx.lineTo(mx, yA); ctx.stroke();      // 落到时间轴的引线
      ctx.restore();
      ink.dot(ctx, mx, y, 4.5 * ml + 1, col, ml);
      // 同一条泳道内交错上下，否则相邻两个标记的标签会撞（实测 3×13px）
      const ly = j % 2 === 0 ? y - 10 : y + 15;
      const align = j % 2 === 0 ? 'center' : (mx > X(t1) - w * 0.14 ? 'right' : 'center');
      ink.label(ctx, mk.label, mx, ly, { color: col, align, alpha: ml, font: '11px ui-monospace, monospace' });
    });
  });

  // ---- 阶段 C（p 0.75→1）：把「差距」量出来 —— 这是画面上唯一一个能读出的数
  const gp = clamp01((p - 0.75) / 0.25);
  if (gp > 0) {
    const lastLane = D.lanes[D.lanes.length - 1];
    const first = D.lanes[0].marks[0].at;
    const last = lastLane.marks[lastLane.marks.length - 1].at;
    const yb = h * 0.94;      // 与年份标签（yA+14 ≈ 0.83h）留出安全间距
    const xa = X(first), xb = X(last);
    ink.path(ctx, [[xa, yb], [xa, yb - 5]], gp, { color: pal['accent-2'], width: 1.6 });
    ink.path(ctx, [[xb, yb], [xb, yb - 5]], gp, { color: pal['accent-2'], width: 1.6 });
    ink.path(ctx, [[xa, yb], [xa + (xb - xa) * gp, yb]], 1, { color: pal['accent-2'], width: 2 });
    if (gp > 0.9) {
      const yrs = last - first;
      const mo = Math.round((yrs % 1) * 12);
      ink.label(ctx, `差 ${Math.floor(yrs)} 年 ${mo} 个月`, (xa + xb) / 2, yb - 12, { color: pal['accent-2'], align: 'center', font: 'bold 12px ui-monospace, monospace' });
    }
    ink.path(ctx, [[X(t1), h * 0.06], [X(t1), yA]], 1, { color: pal.muted, width: 1.3, dash: [5, 5], alpha: 0.8 });
    ink.label(ctx, '现在', X(t1), h * 0.03, { color: pal.muted, align: 'right' });
  }
}

/**
 * 02 问题：把"过程被压掉"量出来。
 * 静态一页只有 1 个信息单元；同一件事按构造顺序讲是 12 步（以贝塞尔曲线为例，
 * 4 层 de Casteljau × 3 步插值 —— 这个例子在第 3 份课件里逐笔演示过）。
 * 两个数字都来自 data，扰动后柱子高度会变（G11）。
 */
function drawCompression(ctx, t, el, api) {
  const { w, h, ink, palette: pal } = api;
  const p = api.state.p;
  const D = api.data ?? { bars: [{ k: '一页静态图', v: 1, tone: 'bad' }, { k: '逐笔的构造过程', v: 12, tone: 'good' }], unit: '个信息单元' };
  const max = Math.max(...D.bars.map((b) => b.v));
  const bw = w * 0.24, y0 = h * 0.82, maxH = h * 0.56;

  // 基线
  strokesOf(ctx, [{ pts: [[w * 0.1, y0], [w * 0.9, y0]], tone: 'line', width: 1.5, nib: 0 }], clamp01(p * 3), ink, pal);

  D.bars.forEach((b, i) => {
    const local = clamp01(p * 2 - 0.35 - i * 0.25);
    if (local <= 0) return;
    const x = w * (0.22 + i * 0.42), bh = maxH * (b.v / max) * local;
    const col = pal[b.tone] ?? pal.accent;
    ctx.save(); ctx.globalAlpha = local * 0.85; ctx.fillStyle = col;
    ctx.fillRect(x - bw / 2, y0 - bh, bw, bh); ctx.restore();
    ctx.save(); ctx.globalAlpha = local; ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.strokeRect(x - bw / 2, y0 - bh, bw, bh); ctx.restore();
    ink.label(ctx, String(b.v), x, y0 - bh - 13, { color: col, align: 'center', alpha: local, font: 'bold 20px ui-monospace, monospace' });
    ink.label(ctx, b.k, x, y0 + 16, { color: pal.muted, align: 'center', alpha: local, font: '12px ui-monospace, monospace' });
  });

  if (p > 0.8) {
    const ratio = (max / Math.min(...D.bars.map((b) => b.v))).toFixed(0);
    ink.label(ctx, `差 ${ratio} 倍`, w * 0.5, h * 0.08, { color: pal['accent-2'], align: 'center', font: 'bold 15px ui-monospace, monospace' });
    ink.label(ctx, `单位：${D.unit}`, w * 0.96, h * 0.96, { color: pal.muted, align: 'right', font: '11px ui-monospace, monospace' });
  }
}

/** 03 优势①：曲线 + 三个时刻游标 + 「同一 t 两次渲染」对照 */
function drawDeterminism(ctx, t, el, api) {
  const { w, h, ink, palette: pal } = api;
  const p = api.state.p;
  const P = [[w * 0.06, h * 0.66], [w * 0.3, h * 0.08], [w * 0.7, h * 0.08], [w * 0.94, h * 0.66]];
  strokesOf(ctx, [{ cubic: P, tone: 'accent', width: 3, glow: 12, nib: 5 }], p * 1.7, ink, pal);

  if (p > 0.62) {
    const at = (u) => {
      const v = 1 - u;
      return [
        v * v * v * P[0][0] + 3 * v * v * u * P[1][0] + 3 * v * u * u * P[2][0] + u * u * u * P[3][0],
        v * v * v * P[0][1] + 3 * v * v * u * P[1][1] + 3 * v * u * u * P[2][1] + u * u * u * P[3][1],
      ];
    };
    (api.data?.cursors ?? [0.25, 0.55, 0.85]).forEach((u) => {
      const q = at(u);
      ink.path(ctx, [[q[0], h * 0.06], [q[0], h * 0.8]], 1, { color: pal.muted, width: 1.2, dash: [4, 5], alpha: 0.7 });
      ink.dot(ctx, q[0], q[1], 6, pal['accent-2']);
      ink.label(ctx, `t=${u.toFixed(2)}`, q[0], h * 0.86, { color: pal['accent-2'], align: 'center' });
    });
    // 同一时刻、两次渲染：两个方框里的内容必须完全一样
    const yy = h * 0.95;
    ink.label(ctx, '同一 t 渲染两次', w * 0.1, yy, { color: pal.muted });
    [0.34, 0.62].forEach((fx) => {
      ink.path(ctx, [[w * fx, yy - 6], [w * (fx + 0.1), yy - 6], [w * (fx + 0.1), yy + 6], [w * fx, yy + 6], [w * fx, yy - 6]],
        1, { color: pal.good, width: 1.5, alpha: 0.9 });
      ink.dot(ctx, w * (fx + 0.05), yy, 3.5, pal.good, 0.9);
    });
    ink.label(ctx, `差异 ${api.data?.diffBytes ?? 0} 字节 ✓`, w * 0.75, yy, { color: pal.good });
  }
}

/** 04 优势②：四步构造逐笔 + 当前一步高亮（注意力可控的可视化） */
function drawAttention(ctx, t, el, api) {
  const { w, h, ink, palette: pal } = api;
  const p = api.state.p;
  const names = api.data?.steps ?? ['构造', '规则', '组合', '结果'];
  const n = names.length, total = clamp01(p) * n;
  const y = h * 0.46, bw = w * 0.2, bh = h * 0.42;
  const cur = Math.min(n - 1, Math.floor(total + 1e-6));
  [0.13, 0.37, 0.61, 0.85].forEach((fx, i) => {
    const local = clamp01(total - i);
    if (local <= 0) return;
    const x = w * fx;
    const active = i === cur && total < n - 1e-6;
    const col = active ? pal['accent-2'] : pal.line;
    const rect = [[x - bw / 2, y - bh / 2], [x + bw / 2, y - bh / 2], [x + bw / 2, y + bh / 2], [x - bw / 2, y + bh / 2], [x - bw / 2, y - bh / 2]];
    const head = ink.path(ctx, rect, local, { color: col, width: active ? 3.2 : 2, glow: active ? 14 : 0 });
    if (local < 1) ink.nib(ctx, head, col, active ? 6 : 3.5);
    ink.label(ctx, names[i], x, y, { color: active ? col : pal.muted, align: 'center', font: 'bold 13px ui-monospace, monospace' });
    if (i > 0 && local > 0) ink.arrow(ctx, [x - bw - w * 0.055, y], [x - bw / 2, y], 1, { color: pal.line, width: 1.8 });
  });
  ink.label(ctx, `正在画第 ${Math.min(n, cur + 1)} 步 —— 只有它在亮，其余留在背景`, w * 0.04, h * 0.9, { color: pal.muted });
  // 节流预算：把 G9 的阈值画出来（数字来自 data，扰动后条带会变）
  const bud = api.data?.budget ?? { perWindow: 3, window: 0.5 };
  const bx = w * 0.04, by = h * 0.97, bw2 = w * 0.92;
  ink.path(ctx, [[bx, by], [bx + bw2, by]], 1, { color: pal.line, width: 1 });
  for (let i = 0; i < Math.max(1, Math.round(bud.perWindow)); i++) ink.dot(ctx, bx + bw2 * (0.12 + i * 0.3), by, 4, pal.good);
  ink.label(ctx, `预算：每 ${bud.window}s ≤ ${bud.perWindow} 个信息单元`, bx + bw2, by - 11, { color: pal.muted, align: 'right', font: '11px ui-monospace, monospace' });
}

/** 05 优势③：15 项门禁逐个点亮 */
function drawGates(ctx, t, el, api) {
  const { w, h, ink, palette: pal } = api;
  const p = api.state.p;
  const names = api.data?.gates ?? ['G0', 'G1', 'G2', 'G2b', 'G2d', 'G3', 'G4', 'G5', 'G5b', 'G6', 'G7', 'G8', 'G9', 'G9b', 'G10', 'G11'];
  const cols = 4, rows = 4;
  const gap = 14, padT = 6, padB = 26;          // 底部 padB 留给计数条
  const sw = (w - gap * (cols + 1)) / cols;
  const sh = (h - padT - padB - gap * (rows - 1)) / rows;
  let lit = 0;
  names.forEach((nm, i) => {
    const local = clamp01(p * 1.25 * names.length - i);
    if (local <= 0) return;
    lit++;
    const cx = gap + (i % cols) * (sw + gap), cy = padT + Math.floor(i / cols) * (sh + gap);
    ctx.save();
    ctx.globalAlpha = local;
    ctx.strokeStyle = pal.good; ctx.lineWidth = 1.8;
    ctx.strokeRect(cx, cy, sw, sh);
    ink.label(ctx, nm, cx + 6, cy + sh / 2, { color: pal.good, font: '12px ui-monospace, monospace' });
    ctx.restore();
  });
  // 计数条：原来写在 h + 4（画布外面），被裁掉看不见 —— 现在放进预留的 padB 里
  const pass = api.data?.passed ?? names.length;
  ink.label(ctx, `${pass} / ${names.length} 项通过`, w - gap, h - 13, { color: pass === names.length ? pal.good : pal.bad, align: 'right', font: '13px ui-monospace, monospace' });
}

/** 06 场景：左「有顺序 → 逐笔」，右「并列 → 一次给完」 */
function drawOrdered(ctx, t, el, api) {
  const { w, h, ink, palette: pal } = api;
  const p = api.state.p;
  const steps = api.data?.steps ?? ['输入', '变换', '合并', '输出'];
  const total = clamp01(p) * steps.length;
  const y = h * 0.5, bw = w * 0.2, bh = h * 0.36;
  steps.forEach((nm, i) => {
    const local = clamp01(total - i);
    if (local <= 0) return;
    const x = w * (0.16 + i * 0.24);
    const rect = [[x - bw / 2, y - bh / 2], [x + bw / 2, y - bh / 2], [x + bw / 2, y + bh / 2], [x - bw / 2, y + bh / 2], [x - bw / 2, y - bh / 2]];
    const head = ink.path(ctx, rect, local, { color: i === 0 ? pal.good : pal.accent, width: 2.2 });
    if (local < 1) ink.nib(ctx, head, pal.accent, 4);
    ink.label(ctx, nm, x, y, { color: pal.muted, align: 'center', font: '12px ui-monospace, monospace' });
    if (i > 0) ink.arrow(ctx, [x - bw - w * 0.04, y], [x - bw / 2, y], 1, { color: pal.line, width: 1.8 });
  });
}

function drawParallel(ctx, t, el, api) {
  const { w, h, ink, palette: pal } = api;
  const p = clamp01(api.state.p * 14);           // 一瞬间全部到位
  const vals = api.data?.values ?? [0.62, 0.86, 0.44, 0.74];
  const bw = w * 0.14, gap = w * 0.06, y0 = h * 0.84, maxH = h * 0.64;
  vals.forEach((v, i) => {
    const x = w * 0.09 + i * (bw + gap);
    const bh = maxH * v * p;
    ctx.fillStyle = i === 1 ? pal.good : pal.line;
    ctx.fillRect(x, y0 - bh, bw, bh);
    ink.label(ctx, `${Math.round(v * 100)}`, x + bw / 2, y0 - bh - 9, { color: pal.muted, align: 'center', alpha: p });
  });
}

// ================================================================= 课件
export const deck = {
  meta: { title: '按笔画讲清楚', subtitle: '一个把「过程」做成讲解的模式', theme: 'ink' },
  scenes: [
    // ---------------------------------------------------------- 01 背景
    {
      id: 'bg',
      title: '为什么是现在',
      duration: 30,
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '背景 · 为什么是现在', x: 6, y: 5, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '三件事同时成立，用了两年', x: 6, y: 10, w: 70, size: 36 },
        {
          id: 'c', group: 'canvas', type: 'canvas2d', x: 6, y: 22, w: 54, h: 62, monotonic: true, draw: drawTimeline,
          // ↓ 真实数据：每一条都能在 ~/Projects/webgpu/docs/webgpu-deep-dive.md 里核对
          data: {
            span: [2023, 2026],
            years: [2023, 2024, 2025, 2026],
            lanes: [
              { name: 'Chrome / Edge', tone: 'accent', marks: [{ at: 2023.33, label: '113 · 首个正式版' }] },
              { name: 'Firefox', tone: 'accent-2', marks: [{ at: 2025.5, label: '141 · Windows' }, { at: 2025.92, label: '147 · 全 macOS' }] },
              { name: 'Safari', tone: 'good', marks: [{ at: 2025.67, label: '26.0 · 默认开启' }] },
            ],
          },
        },
        { id: 'l', group: 'list', type: 'list', x: 64, y: 22, w: 30, items: [
          { badge: '1', text: 'Chrome 113 是 2023-05，Safari 26 是 2025-09 —— 平台差了 2 年 4 个月' },
          { badge: '2', text: '这 2 年里库的代价也归零：three.js 一个 CDN 链接，本 skill 的 npm 依赖数是 0' },
          { badge: '3', text: '而"模型会写代码"在 2025 年跨过门槛 —— 三件事第一次同时成立' },
        ] },
        { id: 'q', group: 'concl', type: 'text', role: 'quote', text: '门槛从「会做动画」降到「会描述过程」。', x: 64, y: 62, w: 30, size: 19 },
        { id: 'b', group: 'boundary', type: 'text', role: 'body', text: '边界：Safari 只在 macOS 26 / iOS 26 起默认开启 —— 旧系统上装了 Safari 26 也不开。', x: 6, y: 86, w: 88, size: 14 },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.5 },
        { at: 0.9, action: 'reveal', target: 'c', dur: 0.5 },
        { at: 1.0, action: 'draw', target: 'c', dur: 10 },
        { at: 12.0, action: 'reveal', target: 'l', dur: 0.7 },
        { at: 17.0, action: 'reveal', target: 'q', dur: 0.6 },
        { at: 20.5, action: 'reveal', target: 'b', dur: 0.5 },
        { at: 0.6, action: 'speak', text: '先看时间。Chrome 在 2023 年 5 月就发了 WebGPU 的正式版。' },
        { at: 5.6, action: 'speak', text: 'Safari 要等到 2025 年 9 月的 26.0 —— 中间差了两年四个月。' },
        { at: 11.4, action: 'speak', text: '在这两年里，另外两件事也到位了：三维库变成一个 CDN 链接，而模型学会了写代码。' },
        { at: 18.0, action: 'speak', text: '三件事第一次同时成立，门槛就从会做动画，降到了会描述过程。' },
        { at: 22.0, action: 'speak', text: '但要记住边界：Safari 只在 macOS 26 之后默认开启。' },
      ],
    },
    {
      id: 'problem',
      title: 'PPT 的三个结构性缺陷',
      duration: 31,
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '问题 · 不是审美问题，是结构问题', x: 6, y: 5, w: 70 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '一屏，就是一帧', x: 6, y: 10, w: 70, size: 36 },
        {
          id: 'c', group: 'canvas', type: 'canvas2d', x: 6, y: 22, w: 50, h: 58, monotonic: true, draw: drawCompression,
          data: {
            unit: '个信息单元',
            bars: [{ k: '一页静态图', v: 1, tone: 'bad' }, { k: '逐笔的构造过程', v: 12, tone: 'good' }],
          },
        },
        { id: 'l', group: 'list', type: 'list', x: 60, y: 24, w: 34, items: [
          { badge: '丢', text: '时间维度被丢掉 —— 观众要自己脑补 12 步的顺序' },
          { badge: '压', text: '过程被压成 1 张图 —— 而过程往往才是知识' },
          { badge: '盲', text: '好坏只能靠肉眼 —— 改一版，你说不出是好了还是坏了' },
        ] },
        { id: 'q', group: 'concl', type: 'text', role: 'quote', text: '静态图只能给结果。有些知识，过程本身就是知识。', x: 60, y: 66, w: 34, size: 18 },
        { id: 'b', group: 'boundary', type: 'text', role: 'body', text: '边界：如果信息本来就是并列的（一张对比表），这个 12 倍的差距就是 0 —— 那时静态反而更快。', x: 6, y: 85, w: 88, size: 14 },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.5 },
        { at: 0.9, action: 'reveal', target: 'c', dur: 0.5 },
        { at: 1.0, action: 'draw', target: 'c', dur: 7 },
        { at: 10.0, action: 'reveal', target: 'l', dur: 0.7 },
        { at: 17.0, action: 'reveal', target: 'q', dur: 0.6 },
        { at: 22.0, action: 'reveal', target: 'b', dur: 0.5 },
        { at: 0.6, action: 'speak', text: 'PPT 的问题不是不好看，是结构性的。' },
        { at: 4.6, action: 'speak', text: '同一件事，静态一页只能给一个信息单元；按构造顺序讲，是十二步。' },
        { at: 11.0, action: 'speak', text: '时间维度被丢掉了，观众要自己把这十二步的顺序脑补出来。' },
        { at: 18.0, action: 'speak', text: '而且好坏只能靠肉眼：改一版，你说不出是好了还是坏了。' },
        { at: 23.0, action: 'speak', text: '但要公平：如果信息本来就是并列的，这个差距就是零，静态反而更快。' },
        { at: 26.5, action: 'pause', hint: '你最近一次讲的东西，有顺序吗？' },
      ],
      quiz: {
        q: '如果只能修一个，PPT 最该修的是哪个？',
        opts: [
          { t: '排版和配色', ok: false, why: '那是审美问题。改完你还是只能给结果，时间维度照样丢。' },
          { t: '它只有「一帧」，缺时间这条轴', ok: true, why: '对。缺时间轴 → 顺序丢了、过程被压掉、也没法逐帧比对好坏。' },
          { t: '字体和间距', ok: false, why: '同上。结构不变，改细节收益有限。' },
        ],
      },
    },

    {
      id: 'determinism',
      title: '优势一：确定性时间轴',
      duration: 22,
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '优势 1 / 4', x: 6, y: 5, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '画面是时间的纯函数', x: 6, y: 10, w: 70, size: 38 },
        {
          id: 'c', group: 'canvas', type: 'canvas2d', x: 6, y: 22, w: 56, h: 60, monotonic: true, draw: drawDeterminism,
          data: { cursors: [0.25, 0.55, 0.85], diffBytes: 0 },
        },
        { id: 'l', group: 'list', type: 'list', x: 66, y: 24, w: 30, items: [
          { badge: '拖', text: '可 scrub：任意时刻直接渲染，不依赖"已经播了多久"' },
          { badge: '断', text: '可断言：同一个 t 两次渲染必须逐字节相同' },
          { badge: '导', text: '可导出：逐帧 seek 出图，帧与帧之间不闪' },
          { badge: '复', text: '可复现：评审时每个人看到的关键帧完全一样' },
        ] },
        { id: 'm', group: 'metric', type: 'metric', value: 0, suffix: ' 字节', label: '同一 t 双渲染的差异（实测）', tone: 'good', x: 66, y: 70, w: 30, decimals: 0 },
        { id: 'b', group: 'boundary', type: 'text', role: 'body', text: '代价：render(t) 必须是纯函数 —— 不能用「当前时间戳」做淡入、不能靠物理引擎的累积状态。这是拿"有状态动画"换来的。', x: 66, y: 82, w: 30, size: 13 },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.5 },
        { at: 0.9, action: 'reveal', target: 'c', dur: 0.5 },
        { at: 1.0, action: 'draw', target: 'c', dur: 6 },
        { at: 8.0, action: 'reveal', target: 'l', dur: 0.7 },
        { at: 12.0, action: 'reveal', target: 'm', dur: 0.6 },
        { at: 15.5, action: 'reveal', target: 'b', dur: 0.5 },
        { at: 0.6, action: 'speak', text: '第一个优势：画面是时间的纯函数。' },
        { at: 4.8, action: 'speak', text: '同一个时刻永远渲染出同一帧，不管你怎么跳、跳几次。' },
        { at: 12.4, action: 'speak', text: '所以可以拖动、可以断言、可以逐帧导出，评审时人人看到一样的东西。' },
        { at: 16.0, action: 'speak', text: '代价是：不能用时间戳做淡入，也不能靠物理引擎的累积状态。' },
      ],
    },

    // ---------------------------------------------------------- 04 优势② 过程与注意力
    {
      id: 'process',
      title: '优势二：过程可见，注意力可控',
      duration: 30,
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '优势 2 / 4', x: 6, y: 5, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '一笔一笔，顺序就是知识', x: 6, y: 10, w: 70, size: 38 },
        {
          id: 'c', group: 'canvas', type: 'canvas2d', x: 6, y: 22, w: 52, h: 58, monotonic: true, draw: drawAttention,
          data: { steps: ['构造', '规则', '组合', '结果'], budget: { perWindow: 3, window: 0.5 } },
        },
        { id: 'l', group: 'list', type: 'list', x: 62, y: 24, w: 34, items: [
          { badge: '画', text: 'draw 逐笔画出：把构造顺序变成看得见的东西（11 个动作里最值钱的两个之一）' },
          { badge: '聚', text: 'spotlight / dim：一页只留一个焦点，其余压暗' },
          { badge: '长', text: 'countUp / morph：数字滚上去、文字打出来' },
          { badge: '撑', text: 'grow：图表与进度条按数据长大' },
        ] },
        { id: 'n', group: 'note', type: 'text', role: 'body', text: '纪律：每 0.5 秒最多 3 个信息单元。<br>参照：一页 8 个要点同时弹出 ≈ 8 个单元 / 0 秒 —— 超了 8 倍。', x: 62, y: 72, w: 34, size: 15 },
        { id: 'b', group: 'boundary', type: 'text', role: 'body', text: '边界：逐笔超过 8 秒还没画完，观众会开始等 —— 那时该拆幕，或先给结果再补过程。', x: 62, y: 86, w: 34, size: 13 },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.5 },
        { at: 0.9, action: 'reveal', target: 'c', dur: 0.5 },
        { at: 1.0, action: 'draw', target: 'c', dur: 12 },
        { at: 9.0, action: 'spotlight', target: 'c', dur: 0.6 },     // ← 正在讲 spotlight，画面就在 spotlight
        { at: 14.0, action: 'reset', target: null },
        { at: 13.8, action: 'reveal', target: 'l', dur: 0.7 },
        { at: 19.5, action: 'reveal', target: 'n', dur: 0.6 },
        { at: 23.5, action: 'reveal', target: 'b', dur: 0.5 },
        { at: 0.6, action: 'speak', text: '第二个优势：过程可以看见。' },
        { at: 4.2, action: 'speak', text: '一笔一笔画出来，构造的顺序本身就变成了知识。' },
        { at: 9.6, action: 'speak', text: '注意力也能控制：聚光、压暗、数字长出来、图表按数据长大。' },
        { at: 18.2, action: 'speak', text: '还有一条纪律：每半秒最多释放三个信息单元。' },
        { at: 21.0, action: 'speak', text: '一页塞八个要点同时弹出，超了八倍，观众一个都记不住。' },
        { at: 24.0, action: 'speak', text: '边界是：逐笔超过八秒还没画完，观众就开始等了。' },
      ],
    },

    // ---------------------------------------------------------- 05 优势③ 可验证
    {
      id: 'verify',
      title: '优势三：质量可以被断言',
      duration: 34,
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '优势 3 / 4 · 18 项门禁', x: 6, y: 5, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '十六项门禁，在真浏览器里跑', x: 6, y: 10, w: 72, size: 36 },
        {
          id: 'c', group: 'canvas', type: 'canvas2d', x: 6, y: 22, w: 52, h: 58, monotonic: true, draw: drawGates,
          data: { passed: 16, gates: ['G0 死选择器', 'G1 启动', 'G2 越界', 'G2b 裁切', 'G2d 遮挡', 'G3 在动', 'G4 确定性', 'G5 字幕', 'G5b 单行', 'G6 预测题', 'G7 画布', 'G8 离线', 'G9 节流', 'G9b 笔速', 'G10 只增不减', 'G11 数据敏感'] },
        },
        { id: 'l', group: 'list', type: 'list', x: 62, y: 22, w: 34, items: [
          { badge: 'G3', text: '每一幕必须真的在动 —— 静态页冒充不了动画' },
          { badge: 'G4', text: '同一时刻两次渲染必须逐字节相同' },
          { badge: 'G9', text: '信息释放 ≤ 3 单元 / 0.5 秒' },
          { badge: 'G9b', text: '同时生长的笔画 ≤ 4；不许一直画不停' },
          { badge: 'G10', text: '已画好的笔画不被擦掉（长度只增不减）' },
        ] },
        { id: 'w', group: 'caught', type: 'text', role: 'body', text: '战果：笔尖"啪"地消失 · 四个元素同时弹出 · 旁白说不完 · 盒内文字被裁 · 一个 id 写错导致舞台顶部被裁 17px。', x: 62, y: 72, w: 34, size: 14 },
        { id: 'b', group: 'boundary', type: 'text', role: 'body', text: '参照与边界：G10 的度量改了 3 次才对 —— 前两版分别误报 8.9% 和 0.9%。代理量会把"光标移动"当成"内容被擦掉"。', x: 62, y: 85, w: 34, size: 13 },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.5 },
        { at: 0.9, action: 'reveal', target: 'c', dur: 0.5 },
        { at: 1.0, action: 'draw', target: 'c', dur: 9 },
        { at: 11.0, action: 'reveal', target: 'l', dur: 0.7 },
        { at: 17.5, action: 'reveal', target: 'w', dur: 0.6 },
        { at: 23.0, action: 'reveal', target: 'b', dur: 0.5 },
        { at: 0.6, action: 'speak', text: '第三个优势最有意思：质量第一次可以被断言。' },
        { at: 5.4, action: 'speak', text: '十六项门禁在真浏览器里跑，每一幕都要拿出证据。' },
        { at: 9.0, action: 'speak', text: '同一时刻渲染两次必须逐字节相同，画好的笔画不许被擦掉。' },
        { at: 18.0, action: 'speak', text: '它们真的抓到过笔尖啪地消失，抓到过四个元素同时弹出。' },
        { at: 22.6, action: 'speak', text: '门禁不只是防回归，它能让作者发现自己看不见的问题。' },
        { at: 25.0, action: 'speak', text: '但要小心：度量本身会骗人。笔画长度这个指标我改了三版才正确。' },
      ],
    },

    // ---------------------------------------------------------- 06 场景
    {
      id: 'scenes',
      title: '什么时候用，什么时候不用',
      duration: 26,
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '场景', x: 6, y: 5, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '有顺序，才值得逐笔', x: 6, y: 10, w: 70, size: 36 },
        { id: 'la', group: 'A', type: 'text', role: 'kicker', text: '该用 · 有先后 / 有构造 / 有演进', x: 6, y: 22, w: 44 },
        { id: 'ca', group: 'A', type: 'canvas2d', x: 6, y: 27, w: 44, h: 30, monotonic: true, draw: drawOrdered, data: { steps: ['输入', '变换', '合并', '输出'] } },
        { id: 'lb', group: 'B', type: 'text', role: 'kicker', text: '不该用 · 只是并列的事实', x: 52, y: 22, w: 44 },
        { id: 'cb', group: 'B', type: 'canvas2d', x: 52, y: 27, w: 44, h: 30, draw: drawParallel, data: { values: [0.62, 0.86, 0.44, 0.74] } },
        { id: 'l', group: 'list', type: 'list', x: 6, y: 62, w: 88, items: [
          { badge: '用', text: '讲机制：算法怎么算、管线怎么走、状态怎么变 —— 通常 4~12 步' },
          { badge: '用', text: '讲演进：架构怎么一步步长成今天这样' },
          { badge: '不用', text: '并列事实 / 纯结论 / 要反复检索的参考资料 —— 那些用文档更好（检索 1 秒 vs 看完 20 秒）' },
        ] },
        { id: 'q', group: 'concl', type: 'text', role: 'quote', text: '判据只有一条：信息里有没有「顺序」。有顺序就逐笔，只是并列就一次给完。', x: 6, y: 86, w: 88, size: 18 },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.5 },
        { at: 0.9, action: 'reveal', target: ['la', 'ca'], dur: 0.4 },
        { at: 1.0, action: 'draw', target: 'ca', dur: 6 },
        { at: 7.4, action: 'reveal', target: ['lb', 'cb'], dur: 0.4 },
        { at: 7.5, action: 'draw', target: 'cb', dur: 0.05 },
        { at: 8.6, action: 'reveal', target: 'l', dur: 0.7 },
        { at: 15.5, action: 'reveal', target: 'q', dur: 0.6 },
        { at: 0.6, action: 'speak', text: '该用的地方：讲机制、讲算法顺序、讲架构怎么演进。' },
        { at: 8.0, action: 'speak', text: '不该用的地方：只是并列的事实、纯结论、读者要反复检索的资料。' },
        { at: 16.0, action: 'speak', text: '判据只有一条：信息里有没有顺序。有顺序就逐笔，只是并列就一次给完。' },
        { at: 22.6, action: 'speak', text: '逐笔的价值是顺序，不是动起来。' },
      ],
    },

    // ---------------------------------------------------------- 07 人群
    {
      id: 'who',
      title: '四类人，四种用法',
      duration: 35,
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '人群', x: 6, y: 5, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '谁最适合用它', x: 6, y: 10, w: 70, size: 36 },

        { id: 'p1', group: 'p1', type: 'text', role: 'body', text: '<b>工程师 · 技术分享</b><br>要讲机制、性能拐点、排查路径<br><span>→ draw + countUp + chart</span>', x: 6, y: 24, w: 42, size: 17 },
        { id: 'p2', group: 'p2', type: 'text', role: 'body', text: '<b>老师 · 课程作者</b><br>要讲构造过程：一条曲线怎么算出来<br><span>→ draw + morph 打字机</span>', x: 52, y: 24, w: 42, size: 17 },
        { id: 'p3', group: 'p3', type: 'text', role: 'body', text: '<b>产品 / 架构设计者</b><br>要讲架构怎么一步步演进过来<br><span>→ three 3D + moveTo + spotlight</span>', x: 6, y: 54, w: 42, size: 17 },
        { id: 'p4', group: 'p4', type: 'text', role: 'body', text: '<b>做 AI Agent 的人</b><br>要让 agent 汇报它到底做了什么<br><span>→ 场景数据可由模型生成</span>', x: 52, y: 54, w: 42, size: 17 },

        { id: 'q', group: 'concl', type: 'text', role: 'quote', text: '共同点：他们要讲的东西都有「顺序」，而听众需要看见这个过程。', x: 6, y: 79, w: 88, size: 18 },
        { id: 'b', group: 'boundary', type: 'text', role: 'body', text: '边界：如果信息没有顺序，这四类人的收益都会归零 —— 回到上一幕那条判据（有顺序 → 逐笔，并列 → 一次给完）。', x: 6, y: 87, w: 88, size: 14 },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.5 },
        { at: 1.0, action: 'reveal', target: 'p1', dur: 0.6 },
        { at: 7.0, action: 'reveal', target: 'p2', dur: 0.6 },
        { at: 13.6, action: 'reveal', target: 'p3', dur: 0.6 },
        { at: 20.0, action: 'reveal', target: 'p4', dur: 0.6 },
        { at: 25.6, action: 'reveal', target: 'q', dur: 0.6 },
        { at: 28.5, action: 'reveal', target: 'b', dur: 0.5 },
        { at: 0.7, action: 'speak', text: '四类人最适合用它。工程师做技术分享，讲机制和性能拐点。' },
        { at: 7.0, action: 'speak', text: '老师和课程作者，讲构造过程 —— 比如一条曲线是怎么被算出来的。' },
        { at: 13.6, action: 'speak', text: '产品和架构设计者，讲架构怎么一步步演进过来。' },
        { at: 20.0, action: 'speak', text: '还有做 agent 的人：让 agent 汇报它到底做了什么，动画比一段文字清楚得多。' },
        { at: 29.0, action: 'speak', text: '反过来说：信息里没有顺序，这四类人的收益都会归零。' },
      ],
      quiz: {
        q: '你是老师，要讲「快速排序的分区过程」。该抓哪个动作？',
        opts: [
          { t: 'draw —— 逐笔画出分区的每一步', ok: true, why: '对。分区是有顺序的构造过程，逐笔让观众跟着推理走。' },
          { t: 'flash —— 让每次交换闪一下', ok: false, why: '闪烁只表明"有事发生"，讲不出"发生了什么、为什么这么换"。' },
          { t: '把快排的复杂度曲线画出来', ok: false, why: '那是结论。学生要的是"为什么这样分区能保证有序"，那是过程。' },
        ],
      },
    },

    // ---------------------------------------------------------- 08 边界与结论
    {
      id: 'end',
      title: '它不是万能药',
      duration: 18,
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '边界与结论', x: 6, y: 5, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '别把动画当万能药', x: 6, y: 10, w: 70, size: 36 },
        { id: 'l', group: 'list', type: 'list', x: 6, y: 22, w: 88, items: [
          { badge: '不', text: '要的是可检索的参考资料 —— 用文档，别用动画' },
          { badge: '不', text: '要交付可在 PowerPoint 里继续编辑的 PPTX —— 用 PPT 类工具' },
          { badge: '不', text: '观众只有 30 秒、只要一个结论 —— 一页大数字比逐笔更有效' },
        ] },
        { id: 'q', group: 'concl', type: 'text', role: 'quote', text: '「按笔画」的价值是顺序，不是动起来。<br>没有顺序信息时，动画只是慢。', x: 6, y: 56, w: 88, size: 19 },
        { id: 'cta', group: 'cta', type: 'text', role: 'body', text: 'skill: <b>animated-lesson</b>　·　lint → verify（15 项门禁）→ frames → mp4　·　零 npm 依赖', x: 6, y: 78, w: 88, size: 16 },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.5 },
        { at: 0.9, action: 'reveal', target: 'l', dur: 0.8 },
        { at: 9.0, action: 'reveal', target: 'q', dur: 0.7 },
        { at: 13.0, action: 'reveal', target: 'cta', dur: 0.6 },
        { at: 0.6, action: 'speak', text: '它不万能：要检索的资料、要精确排版的 PPTX、只要结论的三十秒，都别用它。' },
        { at: 9.6, action: 'speak', text: '记住一句话：逐笔的价值是顺序，不是动起来。' },
        { at: 13.8, action: 'speak', text: '没有顺序信息的时候，动画只是慢。' },
      ],
      quiz: {
        q: '最后确认一下：什么情况下**不该**用这个模式？',
        opts: [
          { t: '要讲一个算法为什么这样收敛', ok: false, why: '那正是它的主场 —— 有顺序、有构造过程。' },
          { t: '要一份同事能随时搜索查阅的接口文档', ok: true, why: '对。检索场景需要的是结构化文档，不是按时间播放的动画。' },
          { t: '要讲一次事故的排查顺序', ok: false, why: '排查顺序是典型的有顺序信息，逐笔能让听众跟着推理。' },
        ],
      },
    },
  ],
};

/** 溯源：本课件里的每个可核查说法都指向来源 */
export const PROVENANCE = [
  { claim: 'WebGPU 已是 W3C Candidate Recommendation', source: 'W3C GPU for the Web WG（在 ~/Projects/webgpu/docs/webgpu-deep-dive.md 中核对过）' },
  { claim: 'Safari 26（2025-09）在 macOS 26 起默认开启 WebGPU；Firefox 147（macOS）默认开启', source: 'WebKit / Mozilla GFX 发布说明，见 webgpu-deep-dive.md §1' },
  { claim: '本机 ~/.skills 下有 290 个 skill，PPT 类与学习方法类各 5+ 个，但没有一个产出"会动的讲解"', source: '本机文件扫描（2025-09）' },
  { claim: '15 项浏览器门禁、G9/G9b/G10 的数值阈值与真实战果', source: '本 skill 的 scripts/verify.mjs 与 references/authoring-gates.md' },
];

export default deck;
