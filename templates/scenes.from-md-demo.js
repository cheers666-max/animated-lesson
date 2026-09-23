/**
 * scenes.from-md-demo.js —— 由 scripts/from-md.mjs 从 ../../Projects/webgpu/docs/optimization-checklist.md 生成
 *
 * 这是**骨架**，不是成品。所有文字都是原文逐字搬运；需要你做的：
 *   1. 把每幕的 `c`（通用柱状图）换成真正解释这件事的画法
 *   2. 把 `speak` 的草稿改写成本人口吻
 *   3. 补上 from-md 报出来的缺项（量级 / 参照 / 边界）
 *
 * 重新生成：node scripts/from-md.mjs ../../Projects/webgpu/docs/optimization-checklist.md --out=templates/scenes.from-md-demo.js
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
  meta: { title: "optimization-checklist", subtitle: '从 ../../Projects/webgpu/docs/optimization-checklist.md 生成的骨架', theme: "ink" },
  scenes: [
    {
      id: '前言',
      title: '(前言)',
      duration: 20,
      elements: [
        {
          id: "k",
          group: "head",
          type: "text",
          role: "kicker",
          text: "§1 · 来源 ../../Projects/webgpu/docs/optimization-checklist.md:2",
          x: 6,
          y: 5,
          w: 70,
        },
        {
          id: "t",
          group: "head",
          type: "text",
          role: "title",
          text: "(前言)",
          x: 6,
          y: 10,
          w: 74,
          size: 34,
        },
        {
          id: "claim",
          group: "claim",
          type: "text",
          role: "body",
          text: "按\"先做、收益大、风险低\"排序。每条都标注了本机实测收益和怎么验证。",
          x: 6,
          y: 20,
          w: 88,
          size: 17,
        },
        {
          id: "num",
          group: "num",
          type: "text",
          role: "quote",
          text: "量级（原文抽出）：5 · 153 · 4",
          x: 6,
          y: 62,
          w: 88,
          size: 16,
        },
        {
          id: "c",
          group: "canvas",
          type: "canvas2d",
          x: 62,
          y: 20,
          w: 32,
          h: 40,
          monotonic: true,
          data: {
                      bars: [
                        { k: "5", v: 5, tone: "accent" },
                        { k: "153", v: 153, tone: "accent-2" },
                        { k: "4", v: 4, tone: "good" },
                      ],
                      unit: "",
                    },
          draw: drawAutoBars,
        },
      ],
      beats: [
        { at: 0.3, action: "reveal", target: ["k", "t"], dur: 0.5 },
        { at: 0.9, action: "reveal", target: "claim", dur: 0.5 },
        { at: 1.2, action: "speak", text: "按\"先做、收益大、风险低\"排序。每条都标注了本机实测收益和怎么验证。" },
        { at: 4.5, action: "reveal", target: "num", dur: 0.6 },
        { at: 5.7, action: "reveal", target: "c", dur: 0.4 },
        { at: 5.8, action: "draw", target: "c", dur: 4 }
      ],
    },
    {
      id: 'a-先修测量-不做这步-后面全是猜',
      title: 'A. 先修测量（不做这步，后面全是猜）',
      duration: 24,
      elements: [
        {
          id: "k",
          group: "head",
          type: "text",
          role: "kicker",
          text: "§2 · 来源 ../../Projects/webgpu/docs/optimization-checklist.md:8",
          x: 6,
          y: 5,
          w: 70,
        },
        {
          id: "t",
          group: "head",
          type: "text",
          role: "title",
          text: "A. 先修测量（不做这步，后面全是猜）",
          x: 6,
          y: 10,
          w: 74,
          size: 34,
        },
        {
          id: "claim",
          group: "claim",
          type: "text",
          role: "body",
          text: "实测：16 个 compute pass 让 GPU 时间从 1.5ms 涨到 12.3ms，",
          x: 6,
          y: 20,
          w: 88,
          size: 17,
        },
        {
          id: "l",
          group: "mech",
          type: "list",
          x: 6,
          y: 34,
          w: 88,
          items: [
                      { badge: "1", text: "[ ] 别用 performance.now() 判断 GPU 性能。" },
                      { badge: "2", text: "[ ] 别假设 queue.timestampPeriod 存在。 本机是 null。" },
                      { badge: "3", text: "[ ] 把相邻 pass 的时间差 clamp(0, ∞)。 本机实测出现过 -8µs 的负间隔。" },
                      { badge: "4", text: "[ ] 微基准的工作量必须压进帧预算内。" },
                      { badge: "5", text: "[ ] 别信单帧最小值。 本机 min-of-frames 波动可达 5×（0.62 / 1.63 / 2.83 / 3.42ms" },
                    ],
        },
        {
          id: "num",
          group: "num",
          type: "text",
          role: "quote",
          text: "量级（原文抽出）：16个 · 1.5ms · 12.3ms · 0.070ms · 0.073ms · 1.01",
          x: 6,
          y: 62,
          w: 88,
          size: 16,
        },
        {
          id: "c",
          group: "canvas",
          type: "canvas2d",
          x: 62,
          y: 20,
          w: 32,
          h: 40,
          monotonic: true,
          data: {
                      bars: [
                        { k: "16个", v: 16, tone: "accent" },
                        { k: "1.5ms", v: 1.5, tone: "accent-2" },
                        { k: "12.3ms", v: 12.3, tone: "good" },
                        { k: "0.070ms", v: 0.07, tone: "accent" },
                        { k: "0.073ms", v: 0.073, tone: "accent-2" },
                        { k: "1.01", v: 1.01, tone: "good" },
                      ],
                      unit: "",
                    },
          draw: drawAutoBars,
        },
        {
          id: "b",
          group: "boundary",
          type: "text",
          role: "body",
          text: "边界：[ ] 别用 performance.now() 判断 GPU 性能。",
          x: 6,
          y: 86,
          w: 88,
          size: 14,
        },
      ],
      beats: [
        { at: 0.3, action: "reveal", target: ["k", "t"], dur: 0.5 },
        { at: 0.9, action: "reveal", target: "claim", dur: 0.5 },
        { at: 1.2, action: "speak", text: "实测：16 个 compute pass 让 GPU 时间从 1.5ms 涨到 12" },
        { at: 4.2, action: "reveal", target: "l", dur: 0.7 },
        { at: 6, action: "reveal", target: "num", dur: 0.6 },
        { at: 7.2, action: "reveal", target: "c", dur: 0.4 },
        { at: 7.3, action: "draw", target: "c", dur: 4 },
        { at: 11.8, action: "reveal", target: "b", dur: 0.5 }
      ],
    },
    {
      id: 'b-每帧的-cpu-侧-最容易拿到大倍数的地',
      title: 'B. 每帧的 CPU 侧（最容易拿到大倍数的地方）',
      duration: 24,
      elements: [
        {
          id: "k",
          group: "head",
          type: "text",
          role: "kicker",
          text: "§3 · 来源 ../../Projects/webgpu/docs/optimization-checklist.md:35",
          x: 6,
          y: 5,
          w: 70,
        },
        {
          id: "t",
          group: "head",
          type: "text",
          role: "title",
          text: "B. 每帧的 CPU 侧（最容易拿到大倍数的地方）",
          x: 6,
          y: 10,
          w: 74,
          size: 34,
        },
        {
          id: "claim",
          group: "claim",
          type: "text",
          role: "body",
          text: "实测 20000 个/帧 = 24.4ms（1.2µs 一个）→ 缓存后 3.9ms（6.2×）。",
          x: 6,
          y: 20,
          w: 88,
          size: 17,
        },
        {
          id: "l",
          group: "mech",
          type: "list",
          x: 6,
          y: 34,
          w: 88,
          items: [
                      { badge: "1", text: "[ ] 缓存 bind group，绝不每帧 createBindGroup。" },
                      { badge: "2", text: "[ ] 用 dynamic offset + 环形缓冲复用 bind group。" },
                      { badge: "3", text: "[ ] 减少 writeBuffer 的调用次数，而不是字节数。" },
                      { badge: "4", text: "[ ] 大静态绘制列表（>2000 draw）用 RenderBundle。" },
                      { badge: "5", text: "[ ] RenderBundle 只在状态稳定时缓存，别每帧重录。" },
                    ],
        },
        {
          id: "num",
          group: "num",
          type: "text",
          role: "quote",
          text: "量级（原文抽出）：20000个 · 24.4ms · 1.2µs · 3.9ms · 6.2 · 20000",
          x: 6,
          y: 62,
          w: 88,
          size: 16,
        },
        {
          id: "c",
          group: "canvas",
          type: "canvas2d",
          x: 62,
          y: 20,
          w: 32,
          h: 40,
          monotonic: true,
          data: {
                      bars: [
                        { k: "20000个", v: 20000, tone: "accent" },
                        { k: "24.4ms", v: 24.4, tone: "accent-2" },
                        { k: "1.2µs", v: 1.2, tone: "good" },
                        { k: "3.9ms", v: 3.9, tone: "accent" },
                        { k: "6.2", v: 6.2, tone: "accent-2" },
                        { k: "20000", v: 20000, tone: "good" },
                      ],
                      unit: "",
                    },
          draw: drawAutoBars,
        },
        {
          id: "b",
          group: "boundary",
          type: "text",
          role: "body",
          text: "边界：注意 minUniformBufferOffsetAlignment = 256（本机），要 padding。",
          x: 6,
          y: 86,
          w: 88,
          size: 14,
        },
      ],
      beats: [
        { at: 0.3, action: "reveal", target: ["k", "t"], dur: 0.5 },
        { at: 0.9, action: "reveal", target: "claim", dur: 0.5 },
        { at: 1.2, action: "speak", text: "实测 20000 个/帧 = 24.4ms（1.2µs 一个）→ 缓存后 3.9ms" },
        { at: 4.2, action: "reveal", target: "l", dur: 0.7 },
        { at: 6, action: "reveal", target: "num", dur: 0.6 },
        { at: 7.2, action: "reveal", target: "c", dur: 0.4 },
        { at: 7.3, action: "draw", target: "c", dur: 4 },
        { at: 11.8, action: "reveal", target: "b", dur: 0.5 }
      ],
    },
    {
      id: 'c-gpu-侧-带宽',
      title: 'C. GPU 侧 / 带宽',
      duration: 24,
      elements: [
        {
          id: "k",
          group: "head",
          type: "text",
          role: "kicker",
          text: "§4 · 来源 ../../Projects/webgpu/docs/optimization-checklist.md:73",
          x: 6,
          y: 5,
          w: 70,
        },
        {
          id: "t",
          group: "head",
          type: "text",
          role: "title",
          text: "C. GPU 侧 / 带宽",
          x: 6,
          y: 10,
          w: 74,
          size: 34,
        },
        {
          id: "claim",
          group: "claim",
          type: "text",
          role: "body",
          text: "实测 8 个全屏 pass 链：load+store 比 clear+discard 多 20~35% GPU 时间。",
          x: 6,
          y: 20,
          w: 88,
          size: 17,
        },
        {
          id: "l",
          group: "mech",
          type: "list",
          x: 6,
          y: 34,
          w: 88,
          items: [
                      { badge: "1", text: "[ ] 能 storeOp:'discard' 就 discard（深度缓冲、临时 G-buffer、被覆盖的中间结果）。" },
                      { badge: "2", text: "[ ] 能 loadOp:'clear' 就别 load。" },
                      { badge: "3", text: "[ ] MSAA 不要凭直觉拒绝。 本机 TBDR 上 4× + resolve 几乎免费" },
                      { badge: "4", text: "[ ] 先量再优化：同一份 shader 在 1024² 是带宽相关、在 2048²/16pass 变成队列相关，" },
                    ],
        },
        {
          id: "num",
          group: "num",
          type: "text",
          role: "quote",
          text: "量级（原文抽出）：8个 · 20 · 35% · 4.73 · 4.78 · 4.02",
          x: 6,
          y: 62,
          w: 88,
          size: 16,
        },
        {
          id: "c",
          group: "canvas",
          type: "canvas2d",
          x: 62,
          y: 20,
          w: 32,
          h: 40,
          monotonic: true,
          data: {
                      bars: [
                        { k: "8个", v: 8, tone: "accent" },
                        { k: "20", v: 20, tone: "accent-2" },
                        { k: "35%", v: 35, tone: "good" },
                        { k: "4.73", v: 4.73, tone: "accent" },
                        { k: "4.78", v: 4.78, tone: "accent-2" },
                        { k: "4.02", v: 4.02, tone: "good" },
                      ],
                      unit: "",
                    },
          draw: drawAutoBars,
        },
        {
          id: "b",
          group: "boundary",
          type: "text",
          role: "body",
          text: "边界：[ ] MSAA 不要凭直觉拒绝。 本机 TBDR 上 4× + resolve 几乎免费",
          x: 6,
          y: 86,
          w: 88,
          size: 14,
        },
      ],
      beats: [
        { at: 0.3, action: "reveal", target: ["k", "t"], dur: 0.5 },
        { at: 0.9, action: "reveal", target: "claim", dur: 0.5 },
        { at: 1.2, action: "speak", text: "实测 8 个全屏 pass 链：load+store 比 clear+discard" },
        { at: 4.2, action: "reveal", target: "l", dur: 0.7 },
        { at: 6, action: "reveal", target: "num", dur: 0.6 },
        { at: 7.2, action: "reveal", target: "c", dur: 0.4 },
        { at: 7.3, action: "draw", target: "c", dur: 4 },
        { at: 11.8, action: "reveal", target: "b", dur: 0.5 }
      ],
    },
  ],
};

/** 溯源：每条 claim 指向原文行号 —— 生成器顺手做掉的事，手工写十有八九会漏 */
export const PROVENANCE = [
  { claim: "(前言)", source: '../../Projects/webgpu/docs/optimization-checklist.md:2' },
  { claim: "A. 先修测量（不做这步，后面全是猜）", source: '../../Projects/webgpu/docs/optimization-checklist.md:8' },
  { claim: "B. 每帧的 CPU 侧（最容易拿到大倍数的地方）", source: '../../Projects/webgpu/docs/optimization-checklist.md:35' },
  { claim: "C. GPU 侧 / 带宽", source: '../../Projects/webgpu/docs/optimization-checklist.md:73' },
];

export default deck;
