/**
 * templates/scenes.kvcache.js — 《被讨厌的算法 · 第一篇：带宽与 KV Cache》
 *
 * 由 Content/2026-09-24-被讨厌的算法-第一篇-带宽与KVCache.md 改编。
 * **所有数字来自 scripts/inference-numbers.mjs 的复算，不是从文章里抄的** ——
 * 跑一遍那个脚本就知道课里有没有编数。
 *
 * 复算改掉了一处文章的说法：文章说 batching「单条延迟几乎不涨」，
 * 实算 batch 1 → 33（显存上限）时每 token 从 10.8 ms 涨到 23.7 ms，是 2.2×。
 * 所以第 5 幕把「免费午餐」讲成「有上限的午餐」—— 那句 2.2× 就是这一课自己的边界。
 *
 * 幕次结构（叙事骨架）：hook → mechanism → evidence → mechanism → boundary → payoff
 */

/**
 * 中文在 `ui-monospace` 里没有字形，Chrome 会回退到中文字体 ——
 * 而回退字形的 ascent 和主字体不一致，`textBaseline='top'` 定位就会把字顶出画布
 * （walls 的轴标签就是这么被上边缘裁掉的）。含中文的标签一律用系统 sans。
 */
const CJK = /[\u3000-\u9fff\uff00-\uffef]/;
const font = (size, text, weight) =>
  `${weight ?? 400} ${size}px ${CJK.test(text) ? 'ui-sans-serif, system-ui, -apple-system, "PingFang SC", sans-serif'
                                            : 'ui-monospace, SFMono-Regular, Menlo, monospace'}`;

// ---------------------------------------------------------------- 画布：三段路
/** 横轴对数刻度。七 GB/s 和三点三五 TB/s 画在一张线性图上，小的那两根会是零。 */
function drawRoads(ctx, t, el, api) {
  const { w, h } = api;
  const D = api.data;                                  // ← 真的读 data，否则 G11 判它是装饰
  const rows = D.roads, n = rows.length;
  const p = api.state.p;
  const L = 138, R = 66, T = 8, B = 22;
  const rowH = (h - T - B) / n;
  const lo = Math.log10(1), hi = Math.log10(D.max);
  const xOf = (g) => L + ((Math.log10(g) - lo) / (hi - lo)) * (w - L - R);

  ctx.save();
  ctx.font = font(11, '磁盘本身');
  ctx.textBaseline = 'top';
  for (const g of D.ticks) {
    const x = xOf(g);
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = api.palette.line;
    ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + rowH * n); ctx.stroke();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = api.palette.muted;
    ctx.textAlign = 'center';
    ctx.fillText(g >= 1000 ? (g / 1000) + ' TB' : g + ' GB', x, T + rowH * n + 5);
  }

  rows.forEach((r, i) => {
    // 每根只在自己的那一段里长出来 —— 同时生长的 ≤ 1 根
    const lp = Math.max(0, Math.min(1, (p * n - i) / 0.72));
    if (lp <= 0.002) return;
    const y = T + i * rowH + rowH * 0.52;
    const x1 = xOf(r.gbps);
    ctx.globalAlpha = 1;
    ctx.fillStyle = api.palette[r.tone] ?? api.palette.accent;
    ctx.globalAlpha = r.tone === 'muted' ? 0.45 : 0.9;
    ctx.fillRect(L, y - 10, Math.max(0, (x1 - L) * lp), 20);
    ctx.globalAlpha = 1;
    // 标签
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = api.palette.ink;
    ctx.font = font(15, r.name, 600);
    ctx.fillText(r.name, 6, y - 6);
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = api.palette.muted;
    ctx.font = font(11, r.spec);
    ctx.fillText(r.spec, 6, y + 10);
    ctx.globalAlpha = 1;
    // 数值跟着条形一起出现
    if (lp > 0.9) {
      ctx.globalAlpha = (lp - 0.9) / 0.1;
      ctx.fillStyle = api.palette.ink;
      ctx.font = font(13, '0/');
      ctx.textAlign = 'left';
      ctx.fillText((r.gbps >= 1000 ? (r.gbps / 1000).toFixed(2) + ' TB/s' : r.gbps + ' GB/s'), L + (x1 - L) * lp + 8, y);
      ctx.globalAlpha = 1;
    }
  });
  ctx.restore();
}

// ---------------------------------------------------------------- 画布：谁在摊运费
/** 同一辆卡车（权重），prefill 有两千个 token 来摊，decode 只有一个。 */
function drawSplit(ctx, t, el, api) {
  const { w, h } = api;
  const D = api.data;
  const p = api.state.p;
  const rows = [
    { key: 'prefill', name: 'prefill', sub: D.prefill + ' 个 token', share: D.weightsGB / D.prefill, tone: 'accent', n: D.prefill },
    { key: 'decode', name: 'decode', sub: '1 个 token', share: D.weightsGB, tone: 'bad', n: 1 },
  ];
  const L = 92, R = 214, T = 6, B = 6;
  const rowH = (h - T - B) / rows.length;
  const barH = Math.max(30, rowH * 0.7);

  ctx.save();
  rows.forEach((r, i) => {
    const lp = Math.max(0, Math.min(1, (p * rows.length - i) / 0.7));
    if (lp <= 0.002) return;
    const y = T + rowH * (i + 0.5);
    const barW = w - L - R;
    // 卡车 = 一趟运的权重
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = api.palette.line;
    ctx.fillRect(L, y - barH / 2, barW * lp, barH);
    // 货物格子：prefill 画 40 格代表两千个 token，decode 只有一格
    const cells = r.n === 1 ? 1 : 40;
    const cw = (barW * lp) / cells;
    ctx.fillStyle = api.palette[r.tone];
    for (let k = 0; k < cells; k++) {
      ctx.globalAlpha = r.n === 1 ? 0.95 : 0.75;
      ctx.fillRect(L + k * cw + 1.5, y - barH / 2 + 4, Math.max(1, cw - 3), barH - 8);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = api.palette.ink;
    ctx.font = font(15, r.name, 600);
    ctx.fillText(r.name, 6, y - 8);
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = api.palette.muted;
    ctx.font = font(11, r.sub);
    ctx.fillText(r.sub, 6, y + 9);
    ctx.globalAlpha = 1;
    if (lp > 0.85) {
      ctx.globalAlpha = (lp - 0.85) / 0.15;
      ctx.fillStyle = api.palette[r.tone];
      ctx.font = font(17, '0/');
      ctx.fillText(r.share >= 1 ? r.share.toFixed(0) + ' GB / token' : r.share.toFixed(3) + ' GB / token', L + barW + 12, y - 9);
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = api.palette.muted;
      ctx.font = font(11, '独付全程运费');
      ctx.fillText(r.n === 1 ? '独付全程运费' : '摊掉 ' + D.prefill + ' 分之一', L + barW + 12, y + 11);
      ctx.globalAlpha = 1;
    }
  });
  ctx.restore();
}

// ---------------------------------------------------------------- 画布：batching
/** 权重是公共财产（两栏一样大），KV 才是私有（格子随 batch 增加）。 */
function drawBatch(ctx, t, el, api) {
  const { w, h } = api;
  const D = api.data;
  const p = api.state.p;
  const cols = D.batches;
  const padX = 10, gap = 16;
  const cw = (w - padX * 2 - gap * (cols.length - 1)) / cols.length;
  const barTop = 24, barH = 36;
  const gTop = 76, gBot = h - 76;

  ctx.save();
  cols.forEach((b, ci) => {
    const x0 = padX + ci * (cw + gap);
    const lp = Math.max(0, Math.min(1, (p * cols.length - ci) / 0.8));
    if (lp <= 0.002) return;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // 权重：两栏一模一样 —— 这就是"公共财产"
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = api.palette.accent;
    ctx.fillRect(x0, barTop, cw, barH);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#07090d';
    ctx.font = font(13, '权重', 600);
    ctx.fillText('权重 ' + D.weightGB + ' GB', x0 + cw / 2, barTop + barH / 2);
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = api.palette.muted;
    ctx.font = font(11, '全批共享');
    ctx.fillText('全批共享 · 每步都读一遍', x0 + cw / 2, barTop + barH + 15);
    ctx.globalAlpha = 1;
    // KV 格子：正方形排布，铺满中部
    const cols2 = Math.max(1, Math.round(Math.sqrt(b)));
    const rows2 = Math.ceil(b / cols2);
    const gx = 6, gy = 6;
    const bw = (cw - (cols2 - 1) * gx) / cols2;
    const bh = Math.min(120, (gBot - gTop - (rows2 - 1) * gy) / rows2);
    for (let k = 0; k < b; k++) {
      ctx.globalAlpha = 0.25 + 0.75 * Math.min(1, (lp * b - k) / 0.4);
      ctx.fillStyle = api.palette.good;
      ctx.fillRect(x0 + (k % cols2) * (bw + gx), gTop + Math.floor(k / cols2) * (bh + gy), bw, bh);
    }
    // 每栏脚注
    ctx.globalAlpha = 1;
    ctx.fillStyle = api.palette.ink;
    ctx.font = font(15, '批', 600);
    ctx.fillText('batch = ' + b, x0 + cw / 2, 11);
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = api.palette.good;
    ctx.font = font(12, '份私有');
    ctx.fillText(b + ' 份私有 KV', x0 + cw / 2, h - 48);
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = api.palette.muted;
    ctx.font = font(11, '产出');
    ctx.fillText('产出 ' + b + ' 个 token', x0 + cw / 2, h - 30);
    ctx.globalAlpha = 0.5;
    ctx.fillText('卡车跑的还是同一趟', x0 + cw / 2, h - 13);
    ctx.globalAlpha = 1;
  });
  ctx.restore();
}

// ---------------------------------------------------------------- 画布：代价曲线
/** 横轴 batch，两条线：每 token 延迟（涨 2.2×）和吞吐（涨 15×）。 */
function drawCurve(ctx, t, el, api) {
  const { w, h } = api;
  const D = api.data;
  const p = api.state.p;
  const L = 54, R = 58, T = 24, B = 30;
  const xs = D.curve.map((d) => d.b);
  const X = (b) => L + (b / D.maxBatch) * (w - L - R);
  const msMax = Math.max(...D.curve.map((d) => d.ms)) * 1.25;
  const tpMax = Math.max(...D.curve.map((d) => d.tps)) * 1.25;
  const Y1 = (v) => h - B - (v / msMax) * (h - T - B);
  const Y2 = (v) => h - B - (v / tpMax) * (h - T - B);

  ctx.save();
  // 坐标轴
  ctx.globalAlpha = 0.35; ctx.strokeStyle = api.palette.line; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(L, h - B); ctx.lineTo(w - R + 10, h - B); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.font = font(11, '标签'); ctx.textBaseline = 'top';
  ctx.fillStyle = api.palette.muted;
  for (const b of xs) { ctx.textAlign = 'center'; ctx.fillText(String(b), X(b), h - B + 6); }
  ctx.textAlign = 'left';
  ctx.fillText('batch →', L, h - B + 18);
  ctx.fillStyle = api.palette.bad; ctx.fillText('每 token 延迟 ms', L, 3);
  ctx.fillStyle = api.palette.good; ctx.textAlign = 'right'; ctx.fillText('吞吐 token/s', w - R + 10, 3);

  // 显存墙
  const wallX = X(D.maxBatch);
  ctx.globalAlpha = 0.7; ctx.strokeStyle = api.palette['accent-2']; ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.moveTo(wallX, T); ctx.lineTo(wallX, h - B); ctx.stroke(); ctx.setLineDash([]);
  ctx.globalAlpha = 0.85; ctx.fillStyle = api.palette['accent-2'];
  ctx.font = font(11, '显存墙'); ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  ctx.fillText('显存墙 ' + D.maxBatch + ' 条', wallX - 6, T + 4);

  // 两条线，按 p 从左往右长出来
  const upto = L + (w - L - R) * p;
  const seg = (Y, color, dot) => {
    ctx.strokeStyle = color; ctx.lineWidth = 2.4; ctx.globalAlpha = 0.95;
    ctx.beginPath(); let started = false, last = null;
    for (const d of D.curve) {
      const x = X(d.b); if (x > upto + 0.5) break;
      const y = Y(dot(d));
      started ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), started = true);
      last = [x, y];
    }
    ctx.stroke();
    if (last) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(last[0], last[1], 3.4, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
  };
  seg(Y1, api.palette.bad, (d) => d.ms);
  seg(Y2, api.palette.good, (d) => d.tps);

  // 端点读数
  const lastP = D.curve[D.curve.length - 1];
  if (p > 0.94) {
    ctx.globalAlpha = (p - 0.94) / 0.06;
    ctx.font = font(12, '0/', 600); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = api.palette.bad; ctx.fillText(lastP.ms.toFixed(1) + ' ms', X(lastP.b) - 52, Y1(lastP.ms) - 12);
    ctx.fillStyle = api.palette.good; ctx.fillText(lastP.tps.toFixed(0) + ' /s', X(lastP.b) - 52, Y2(lastP.tps) + 13);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ---------------------------------------------------------------- 画布：KV Cache
/** 左边是"重算"和"缓存"的每步工作量，右边是 KV 仓库逐行长出来。 */
function drawKV(ctx, t, el, api) {
  const { w, h } = api;
  const D = api.data;
  const p = api.state.p;
  const T = D.tokens;
  const done = p * T;
  const L = 12;
  const splitX = Math.round(w * 0.42);
  const barTop = 32;
  const rowH = (h - barTop - 14) / 2;
  const h1 = rowH - 16;
  const bw = (splitX - L - 26) / T;

  ctx.save();
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';

  // 上排：没有缓存 —— 第 i 步重算前 i 个，总工作量 ∝ T²
  ctx.fillStyle = api.palette.bad;
  ctx.font = font(13, '没有缓存', 600);
  ctx.fillText('没有缓存', L, 12);
  ctx.globalAlpha = 0.62; ctx.fillStyle = api.palette.muted;
  ctx.font = font(11, '重算');
  ctx.fillText('前 i 个的 K、V 全部重算 —— 与 T² 成正比', L + 64, 12);
  for (let i = 0; i < T; i++) {
    const a = Math.max(0, Math.min(1, done - i));
    if (a <= 0.001) continue;
    const bh = (h1 * (i + 1)) / T;
    ctx.globalAlpha = 0.28 + 0.72 * a;
    ctx.fillStyle = api.palette.bad;
    ctx.fillRect(L + i * bw, barTop + h1 - bh, bw - 2, bh);
  }
  ctx.globalAlpha = 1;

  // 下排：有缓存 —— 每步只算自己，高度恒定，总工作量 ∝ T
  const y2 = barTop + rowH;
  ctx.fillStyle = api.palette.good;
  ctx.font = font(13, '有缓存', 600);
  ctx.fillText('有缓存', L, y2 + 12);
  ctx.globalAlpha = 0.62; ctx.fillStyle = api.palette.muted;
  ctx.font = font(11, '只算自己');
  ctx.fillText('每步只算自己那一个 —— 与 T 成正比', L + 52, y2 + 12);
  for (let i = 0; i < T; i++) {
    const a = Math.max(0, Math.min(1, done - i));
    if (a <= 0.001) continue;
    ctx.globalAlpha = 0.28 + 0.72 * a;
    ctx.fillStyle = api.palette.good;
    ctx.fillRect(L + i * bw, y2 + 40, bw - 2, h1 * 0.52);
  }
  ctx.globalAlpha = 1;

  // 右边：KV 仓库（每个 token 一行，K / V 两列）
  const sx = splitX + 18;
  ctx.font = font(14, 'KV 仓库', 600);
  ctx.fillStyle = api.palette.ink;
  ctx.fillText('KV 仓库', sx, 12);
  ctx.globalAlpha = 0.62; ctx.fillStyle = api.palette.muted;
  ctx.font = font(11, '维度');
  ctx.fillText(D.layers + ' 层 × ' + D.kvHeads + ' KV头 × ' + D.headDim + ' 维', sx, 30);
  const gTop = 46, gBot = h - 16;
  const cw = 62;
  const rh = Math.max(8, Math.min(15, (gBot - gTop - (T - 1) * 3) / T));
  for (let i = 0; i < T; i++) {
    const a = Math.max(0, Math.min(1, done - i));
    if (a <= 0.001) continue;
    const y = gTop + i * (rh + 3);
    ctx.globalAlpha = 0.35 + 0.65 * a;
    ctx.fillStyle = api.palette.accent;
    ctx.fillRect(sx, y, cw, rh);
    ctx.fillStyle = api.palette['accent-2'];
    ctx.fillRect(sx + cw + 4, y, cw, rh);
  }
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = api.palette.muted; ctx.font = font(10, 'KV');
  ctx.fillText('K', sx + cw / 2 - 4, gTop + T * (rh + 3) + 2);
  ctx.fillText('V', sx + cw + 6 + cw / 2 - 4, gTop + T * (rh + 3) + 2);
  ctx.globalAlpha = 1;

  // 公式：六项都是事实，连乘
  const fx = sx + cw * 2 + 46;
  ctx.fillStyle = api.palette.ink;
  ctx.font = font(13, '公式', 600);
  ctx.fillText('公式里六项，每一项都是一个事实', fx, 12);
  const terms = [
    ['2', 'K 和 V 是两种向量，所以要乘二'],
    [String(D.layers), '每一层注意力都要存自己的一份'],
    [String(D.kvHeads), 'KV 头 —— GQA 把 64 个头压到 8 个'],
    [String(D.headDim), '每个头的维度，决定一个向量多大'],
    [D.bytes + ' B', 'fp16 一个数占两个字节'],
  ];
  terms.forEach(([num, why], i) => {
    const y = 44 + i * 32;
    ctx.globalAlpha = 0.55 + 0.45 * Math.min(1, p * 2);
    ctx.fillStyle = api.palette['accent-2'];
    ctx.font = font(15, num, 600);
    ctx.fillText((i ? '× ' : '') + num, fx, y);
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = api.palette.muted;
    ctx.font = font(12, why);
    ctx.fillText(why, fx + 44, y);
  });
  ctx.globalAlpha = 1;
  if (p > 0.85) {
    ctx.globalAlpha = (p - 0.85) / 0.15;
    ctx.fillStyle = api.palette.good;
    ctx.font = font(16, 'MiB', 600);
    ctx.fillText('= ' + D.perTokenMiB.toFixed(3) + ' MiB / token', fx, 44 + 5 * 32);
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = api.palette.muted;
    ctx.font = font(12, '序列');
    ctx.fillText('一条 4096 token 的序列 = 1.25 GB，是权重的百分之一 —— 但一百条同时跑就反超权重', fx, 44 + 5 * 32 + 26);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

export const deck = {
  meta: {
    title: '带宽与 KV Cache',
    theme: 'ink',
    oneLine: '推理耗时 ≈ 要搬运的字节数 ÷ 带宽 —— 分母是死的，所有优化都在动分子。',
  },
  scenes: [
    // ------------------------------------------------------------- 01 hook
    {
      id: 'hook',
      title: '带宽一根汗毛没动，为什么快了四倍？',
      duration: 21,
      beat: 'hook',
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '带宽与 KV Cache · 1 / 7', x: 6, y: 5, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '带宽一根汗毛没动，<br>为什么快了四倍？', x: 6, y: 10, w: 80, size: 38 },
        { id: 'b', group: 'body', type: 'text', role: 'body', text: '同一个 70B 模型，fp16 权重 140 GB，INT4 权重 35 GB。<br><b>注意</b>：下面这个四倍只对 decode 成立 —— prefill 是算力瓶颈，量化在那里帮不上忙。', x: 6, w: 76, size: 17, below: 't', gap: 3 },
        { id: 'm1', group: 'row', type: 'metric', value: 0, unit: 'ms / token', label: 'fp16 · decode', tone: 'bad', x: 6, y: 50, w: 26, decimals: 1 },
        { id: 'm2', group: 'row', type: 'metric', value: 0, unit: 'ms / token', label: 'INT4 · decode', tone: 'good', x: 36, y: 50, w: 26, decimals: 1 },
        { id: 'q', group: 'concl', type: 'text', role: 'quote', text: '路没变，是货变少了。', x: 6, w: 80, size: 30, below: 'm1', gap: 5 },
      ],
      beats: [
        { at: 0.2, action: 'reveal', target: ['k', 't'], dur: 0.5 },
        { at: 0.4, action: 'spotlight', target: 't', dur: 0.4 },
        { at: 1.0, action: 'reveal', target: 'b', dur: 0.5 },
        { at: 2.0, action: 'reveal', target: 'm1', dur: 0.4 },
        { at: 2.1, action: 'countUp', target: 'm1', from: 0, to: 41.8, dur: 1.2 },
        { at: 2.0, action: 'spotlight', target: 'm1', dur: 0.4 },
        { at: 3.8, action: 'reveal', target: 'm2', dur: 0.4 },
        { at: 3.9, action: 'countUp', target: 'm2', from: 0, to: 10.4, dur: 1.2 },
        { at: 3.8, action: 'spotlight', target: 'm2', dur: 0.4 },
        { at: 3.8, action: 'dim', target: 'm1', dur: 0.4 },
        { at: 0.6, action: 'speak', text: '把模型从 fp16 量化成 INT4，每一步解码快了四倍。' },
        { at: 7.2, action: 'speak', text: '可是路的带宽，一根汗毛都没有动。' },
        // ↓ 先问后讲：题目在幕中间，答案在题目之后
        { at: 11.8, action: 'reveal', target: 'q', dur: 0.6 },
        { at: 11.8, action: 'spotlight', target: 'q', dur: 0.5 },
        { at: 11.8, action: 'dim', target: 't', dur: 0.5 },
        { at: 12.2, action: 'speak', text: '量化动的不是路，是货。' },
        { at: 15.6, action: 'hold', target: 'q', dur: 1.6 },
      ],
      quiz: {
        at: 11.0,
        q: '带宽一点没变，为什么 decode 还是快了四倍？',
        opts: [
          { t: '因为 INT4 的算力更高，每次运算更省时间', ok: false,
            why: 'decode 阶段算力根本不是瓶颈 —— 厨师一直在等菜，不是切得慢。换精度并没有让他切得更快，只是菜到得更早了。' },
          { t: '因为每一步要搬的字节数，变成了四分之一', ok: true,
            why: '对。带宽是分母，量化动的是分子。140 GB 压成 35 GB，4.0× 就是这么来的 —— 分母 3.35 TB/s 自始至终没出现过。' },
          { t: '因为低精度让计算核心的利用率上去了', ok: false,
            why: '利用率正是被带宽拖住的。路没变宽，利用率就上不去 —— 是数据到得更快，厨师才终于忙起来。' },
        ],
      },
    },

    // ------------------------------------------------------------- 02 mechanism
    {
      id: 'roads',
      title: '三段路',
      duration: 24,
      beat: 'mechanism',
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '带宽与 KV Cache · 2 / 7', x: 6, y: 4, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '三段路，最快和最慢差 479 倍', x: 6, y: 9, w: 84, size: 34 },
        { id: 'c', group: 'canvas', type: 'canvas2d', x: 5, y: 21, w: 90, h: 40, monotonic: true,
          draw: drawRoads,
          data: { max: 4000, ticks: [1, 10, 100, 1000],
            roads: [
              { name: '磁盘本身', spec: 'NVMe SSD 顺序读', gbps: 7, tone: 'muted' },
              { name: '磁盘 → 显存', spec: 'PCIe 4.0 ×16 货运', gbps: 32, tone: 'accent-2' },
              { name: '显存 → 计算单元', spec: 'H100 SXM · HBM3', gbps: 3350, tone: 'accent' },
            ] } },
        { id: 'n', group: 'note', type: 'text', role: 'body', text: '瓶颈永远在你被迫走的那段最慢的路上。<b>注意</b>：模型装得下，走公路；装不下被迫走货轮 —— 代价是慢一百倍，没有任何优化能救回来。', x: 5, w: 90, size: 16, below: 'c', gap: 2.2 },
        { id: 'q', group: 'concl', type: 'text', role: 'quote', text: '总耗时 ≈ 要搬运的总字节数 ÷ 带宽', x: 5, w: 90, size: 25, below: 'n', gap: 2.4 },
      ],
      beats: [
        { at: 0.2, action: 'reveal', target: ['k', 't'], dur: 0.5 },
        { at: 0.4, action: 'spotlight', target: 't', dur: 0.4 },
        { at: 1.0, action: 'reveal', target: 'c', dur: 0.4 },
        { at: 1.2, action: 'spotlight', target: 'c', dur: 0.4 },
        // 三段路分两批长出来，中间留 1.8 秒可以重读
        { at: 1.4, action: 'draw', target: 'c', from: 0, to: 0.5, dur: 4.8, ease: 'linear' },
        { at: 6.4, action: 'hold', target: 'c', dur: 1.8 },
        { at: 8.4, action: 'draw', target: 'c', from: 0.5, to: 1, dur: 4.8, ease: 'linear' },
        { at: 13.6, action: 'reveal', target: 'n', dur: 0.5 },
        { at: 13.6, action: 'spotlight', target: 'n', dur: 0.4 },
        { at: 13.6, action: 'dim', target: 'c', dur: 0.4 },
        { at: 15.4, action: 'reveal', target: 'q', dur: 0.6 },
        { at: 15.4, action: 'spotlight', target: 'q', dur: 0.5 },
        { at: 0.6, action: 'speak', text: '三条路。硬盘到显存，是货轮；显存到计算单元，是公路。' },
        { at: 6.6, action: 'speak', text: '公路每秒三点三五 TB，比硬盘快了四百七十九倍。' },
        { at: 13.8, action: 'speak', text: '所以推理耗时永远等于同一个分数：要搬的字节，除以带宽。' },
      ],
    },

    // ------------------------------------------------------------- 03 evidence
    {
      id: 'split',
      title: '一个 token 独付全程运费',
      duration: 22,
      beat: 'evidence',
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '带宽与 KV Cache · 3 / 7', x: 6, y: 4, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '同一趟运费，摊给两千个，还是摊给一个？', x: 6, y: 9, w: 86, size: 32 },
        { id: 'c', group: 'canvas', type: 'canvas2d', x: 5, y: 22, w: 90, h: 38, monotonic: true,
          draw: drawSplit,
          data: { prefill: 2000, weightsGB: 140 } },
        { id: 'n', group: 'note', type: 'text', role: 'body', text: 'prefill 是两千个 token 摊一次运费 —— 厨师终于忙起来了，这是<b>算力瓶颈</b>；decode 是一个 token 独付全程运费 —— 厨师又在空转，这才是<b>带宽瓶颈</b>。<br><b>注意</b>：同样一趟货，摊给两千个是 0.07 GB，不摊就是全额的 140 GB —— 相差两千倍。', x: 5, w: 90, size: 15, below: 'c', gap: 2.4 },
        { id: 'q', group: 'concl', type: 'text', role: 'quote', text: '分子分母都没变 —— 变的是有几个 token 来摊。', x: 5, w: 90, size: 23, below: 'n', gap: 2.4 },
      ],
      beats: [
        { at: 0.2, action: 'reveal', target: ['k', 't'], dur: 0.5 },
        { at: 0.4, action: 'spotlight', target: 't', dur: 0.4 },
        { at: 1.0, action: 'reveal', target: 'c', dur: 0.4 },
        { at: 1.2, action: 'spotlight', target: 'c', dur: 0.4 },
        { at: 1.4, action: 'draw', target: 'c', from: 0, to: 0.5, dur: 4.4, ease: 'linear' },
        { at: 6.2, action: 'hold', target: 'c', dur: 1.8 },
        { at: 8.2, action: 'draw', target: 'c', from: 0.5, to: 1, dur: 4.4, ease: 'linear' },
        { at: 13.0, action: 'reveal', target: 'n', dur: 0.5 },
        { at: 13.0, action: 'spotlight', target: 'n', dur: 0.4 },
        { at: 13.0, action: 'dim', target: 'c', dur: 0.4 },
        { at: 15.2, action: 'reveal', target: 'q', dur: 0.6 },
        { at: 15.2, action: 'spotlight', target: 'q', dur: 0.5 },
        { at: 0.6, action: 'speak', text: '一次对话进来两千个 token，一百四十 GB 权重运一趟。' },
        { at: 7.4, action: 'speak', text: '两千份计算摊这一趟运费，每份只摊到零点零七 GB。' },
        { at: 13.2, action: 'speak', text: '然后开始往外吐字，一次只吐一个。为了这一个，权重还要完整运一趟。' },
      ],
    },

    // ------------------------------------------------------------- 04 mechanism
    {
      id: 'kv',
      title: 'KV Cache：用仓库换卡车不跑',
      duration: 24,
      beat: 'mechanism',
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '带宽与 KV Cache · 4 / 7', x: 6, y: 4, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: 'KV Cache：用仓库，换卡车不跑', x: 6, y: 9, w: 86, size: 34 },
        { id: 'c', group: 'canvas', type: 'canvas2d', x: 5, y: 20, w: 90, h: 44, monotonic: true,
          draw: drawKV,
          data: { tokens: 12, layers: 80, kvHeads: 8, headDim: 128, bytes: 2, perTokenMiB: 0.313 } },
        { id: 'n', group: 'note', type: 'text', role: 'body', text: '注意力要求每个新 token 和之前<b>每一个</b>都做点积。每生成一个字就把历史的 K、V 重算一遍？那卡车要跑 T 遍 —— <b>所以算一次，存进仓库，后面每步直接取。</b><br><b>比一比</b>：0.313 MiB/token，一条 4096 token 的序列只占 1.25 GB，不到权重的百分之一；可一百条同时跑就是 125 GB —— 反超权重。', x: 5, w: 90, size: 15, below: 'c', gap: 2.2 },
        { id: 'q', group: 'concl', type: 'text', role: 'quote', text: '公式里六项都是事实，连乘而已。', x: 5, w: 90, size: 23, below: 'n', gap: 2.2 },
      ],
      beats: [
        { at: 0.2, action: 'reveal', target: ['k', 't'], dur: 0.5 },
        { at: 0.4, action: 'spotlight', target: 't', dur: 0.4 },
        { at: 1.0, action: 'reveal', target: 'c', dur: 0.4 },
        { at: 1.2, action: 'spotlight', target: 'c', dur: 0.4 },
        { at: 1.4, action: 'draw', target: 'c', from: 0, to: 1, dur: 5.4, ease: 'linear' },
        { at: 7.0, action: 'hold', target: 'c', dur: 1.8 },
        { at: 9.0, action: 'reveal', target: 'n', dur: 0.6 },
        { at: 9.0, action: 'spotlight', target: 'n', dur: 0.4 },
        { at: 9.0, action: 'dim', target: 'c', dur: 0.4 },
        { at: 12.4, action: 'reveal', target: 'q', dur: 0.6 },
        { at: 12.4, action: 'spotlight', target: 'q', dur: 0.5 },
        { at: 0.6, action: 'speak', text: '上面这一排，是每生成一个字就把历史重算一遍。' },
        { at: 7.2, action: 'speak', text: '下面这一排是存下来。仓库换来的是卡车不用反复跑。' },
        { at: 12.7, action: 'speak', text: '乘二是因为 K 和 V 是两种向量，乘层数是因为每层都要存自己的。' },
        { at: 20.1, action: 'speak', text: '六个事实连乘，仅此而已。' },
      ],
    },

    // ------------------------------------------------------------- 05 mechanism
    {
      id: 'batch',
      title: '一趟卡车，十六家人',
      duration: 24,
      beat: 'mechanism',
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '带宽与 KV Cache · 5 / 7', x: 6, y: 4, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '一趟卡车，十六家人', x: 6, y: 9, w: 84, size: 36 },
        { id: 'c', group: 'canvas', type: 'canvas2d', x: 5, y: 21, w: 90, h: 42, monotonic: true,
          draw: drawBatch,
          data: { batches: [1, 16], weightGB: 140 } },
        { id: 'n', group: 'note', type: 'text', role: 'body', text: '权重是全体序列的<b>公共财产</b>，KV Cache 才是<b>每家私有</b>的。<br><b>注意</b>：1 条变成 16 条，运费还是那一趟，产出却多了十六倍 —— 但私有 KV 会线性膨胀，并发拉满时它迟早变成大头。', x: 5, w: 90, size: 16, below: 'c', gap: 2.4 },
        { id: 'q', group: 'concl', type: 'text', role: 'quote', text: '大头纹丝不动，只多了十六份小件。', x: 5, w: 90, size: 25, below: 'n', gap: 2.4 },
      ],
      beats: [
        { at: 0.2, action: 'reveal', target: ['k', 't'], dur: 0.5 },
        { at: 0.4, action: 'spotlight', target: 't', dur: 0.4 },
        { at: 1.0, action: 'reveal', target: 'c', dur: 0.4 },
        { at: 1.2, action: 'spotlight', target: 'c', dur: 0.4 },
        { at: 1.4, action: 'draw', target: 'c', from: 0, to: 0.5, dur: 4.2, ease: 'linear' },
        { at: 6.2, action: 'hold', target: 'c', dur: 1.8 },
        { at: 8.2, action: 'draw', target: 'c', from: 0.5, to: 1, dur: 4.2, ease: 'linear' },
        { at: 13.4, action: 'reveal', target: 'n', dur: 0.5 },
        { at: 13.4, action: 'spotlight', target: 'n', dur: 0.4 },
        { at: 13.4, action: 'dim', target: 'c', dur: 0.4 },
        { at: 15.6, action: 'reveal', target: 'q', dur: 0.6 },
        { at: 15.6, action: 'spotlight', target: 'q', dur: 0.5 },
        { at: 0.6, action: 'speak', text: '十六个朋友，每个人都要同一个一百四十 GB 的文件。' },
        { at: 6.5, action: 'speak', text: '下载一次，十六个人同时用。流量没变，每个人拿到的时间也没变。' },
        { at: 13.6, action: 'speak', text: '这就是 batching。因为大头是共享的，只有小头各自私有。' },
      ],
    },

    // ------------------------------------------------------------- 05 boundary
    {
      id: 'walls',
      title: '免费午餐有个上限',
      duration: 24,
      beat: 'boundary',
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '带宽与 KV Cache · 6 / 7', x: 6, y: 4, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '它不是免费的：三堵墙', x: 6, y: 9, w: 84, size: 34 },
        { id: 'c', group: 'canvas', type: 'canvas2d', x: 5, y: 20, w: 56, h: 44,
          draw: drawCurve,
          data: { maxBatch: 33, curve: [
            { b: 1, ms: 10.8, tps: 92 }, { b: 8, ms: 13.7, tps: 586 }, { b: 16, ms: 16.9, tps: 949 },
            { b: 24, ms: 20.1, tps: 1196 }, { b: 33, ms: 23.7, tps: 1394 },
          ] } },
        { id: 'l', group: 'mech', type: 'list', x: 64, y: 20, w: 32,
          items: [
            { badge: '1', text: '<b>显存</b>：KV 每家私有，24 条就吃掉 32 GB' },
            { badge: '2', text: '<b>算力</b>：乘客多了厨师忙起来，接棒成瓶颈' },
            { badge: '3', text: '<b>长短不齐</b>：静态 batching 要等全桌吃完才翻台' },
          ] },
        { id: 'n', group: 'note', type: 'text', role: 'body', tone: 'bad',
          text: '代价：实测 batch 1 → 33（4096 token 时 80 GB 卡的显存上限），每 token 从 10.8 ms 涨到 23.7 ms，是 <b>2.2 倍</b> —— 延迟并不是"不涨"。',
          x: 5, w: 56, size: 15, below: 'c', gap: 2.2 },
      ],
      beats: [
        { at: 0.2, action: 'reveal', target: ['k', 't'], dur: 0.5 },
        { at: 0.4, action: 'spotlight', target: 't', dur: 0.4 },
        { at: 1.0, action: 'reveal', target: 'c', dur: 0.4 },
        { at: 1.2, action: 'spotlight', target: 'c', dur: 0.4 },
        { at: 1.4, action: 'draw', target: 'c', from: 0, to: 1, dur: 5.0, ease: 'linear' },
        { at: 6.6, action: 'hold', target: 'c', dur: 1.8 },
        { at: 8.8, action: 'reveal', target: 'l', dur: 1.0 },
        { at: 8.8, action: 'spotlight', target: 'l', dur: 0.4 },
        { at: 13.4, action: 'reveal', target: 'n', dur: 0.6 },
        { at: 13.4, action: 'spotlight', target: 'n', dur: 0.5 },
        { at: 13.4, action: 'dim', target: 'c', dur: 0.5 },
        { at: 0.6, action: 'speak', text: '红的是每 token 延迟，绿的是吞吐。' },
        { at: 6.8, action: 'speak', text: '吞吐涨了十五倍，延迟却涨了二点二倍 —— 免费午餐其实有价钱。' },
        { at: 14.0, action: 'speak', text: '上限由显存决定，四零九六 token 时最多塞三十三条。' },
      ],
    },

    // ------------------------------------------------------------- 06 payoff
    {
      id: 'payoff',
      title: '所有优化都在折腾货量',
      duration: 19,
      beat: 'payoff',
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '带宽与 KV Cache · 7 / 7', x: 6, y: 4, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '所有优化，都在折腾货量', x: 6, y: 9, w: 84, size: 36 },
        { id: 'l', group: 'mech', type: 'list', x: 5, y: 24, w: 46,
          items: [
            { badge: '量', text: '<b>量化</b> —— 压货：从 140 GB 压到 35 GB' },
            { badge: '少', text: '<b>GQA</b> —— 少带几箱：KV 头从 64 减到 8' },
            { badge: '拼', text: '<b>batching</b> —— 拼车：一趟运费喂饱十六条' },
            { badge: '存', text: '<b>KV Cache</b> —— 用仓库换卡车不跑' },
          ] },
        { id: 'q', group: 'concl', type: 'text', role: 'quote',
          text: '带宽动不了，<br>优化全在折腾货量。', x: 56, y: 26, w: 39, size: 27 },
        { id: 'b', group: 'body', type: 'text', role: 'note',
          text: '面试官不期待你背出 3.35 TB/s。<br>他们在看一件事：<b>你脑子里有没有那辆卡车。</b><br><b>注意</b>：每条优化都有代价 —— 量化掉精度，batching 吃显存。',
          x: 56, w: 39, size: 15, below: 'q', gap: 3.4 },
      ],
      beats: [
        { at: 0.2, action: 'reveal', target: ['k', 't'], dur: 0.5 },
        { at: 0.4, action: 'spotlight', target: 't', dur: 0.4 },
        { at: 1.0, action: 'reveal', target: 'l', dur: 1.0 },
        { at: 1.2, action: 'speak', text: '量化是压货，GQA 是少带几箱，batching 是拼车。' },
        { at: 6.4, action: 'reveal', target: 'q', dur: 0.7 },
        { at: 6.4, action: 'spotlight', target: 'q', dur: 0.5 },
        { at: 6.4, action: 'dim', target: 'l', dur: 0.5 },
        { at: 7.8, action: 'speak', text: '带宽动不了。所有优化，都在折腾货量。' },
        { at: 11.0, action: 'reveal', target: 'b', dur: 0.6 },
        { at: 11.0, action: 'spotlight', target: 'b', dur: 0.4 },
        { at: 12, action: 'speak', text: '被讨厌的从来不是算法。是被要求在没有画面的情况下假装理解。' },
      ],
    },
  ],
};

export const PROVENANCE = [
  { claim: '量化 4.0×：140 GB → 35 GB，41.8 ms → 10.4 ms',
    source: 'node scripts/inference-numbers.mjs ②（140/35 = 4.0，÷3.35 TB/s）' },
  { claim: 'HBM 3.35 TB/s / 2.039 TB/s / 1.008 TB/s，PCIe 32 GB/s，NVMe 7 GB/s',
    source: '公开规格；脚本 ① 列出了每一条的出处，方便对着查' },
  { claim: 'KV Cache 0.313 MiB/token（Llama-2-70B GQA：2×80×8×128×2 B）',
    source: 'node scripts/inference-numbers.mjs ③' },
  { claim: 'batch 1 → 33：每 token 10.8 → 23.7 ms（2.2×），吞吐 92 → 1394 token/s（15×）',
    source: 'node scripts/inference-numbers.mjs ④（INT4 权重 35 GB + KV，H100 80 GB）' },
  { claim: '显存墙 33 条（4096 token 时每条约 1.34 GB）',
    source: 'node scripts/inference-numbers.mjs ④ maxBatch' },
  { claim: '公路比硬盘快 479 倍', source: '3350 ÷ 7 = 478.6' },
];
export default deck;
