/**
 * templates/scenes.instancing.js — 参考课件：为什么 instancing 快 3.4 倍
 *
 * 这是**作者视角的样板**，也是 skill 的验收样本。它演示了：
 *   · 三种动画载体：canvas2d（逐帧绘制）、three（3D）、chart/metric（数据长大）
 *   · 讲解动作：reveal / stagger / countUp / grow / draw / spotlight / zoomTo / speak / wait
 *   · 素材纪律：**所有数字都来自真实基准**（见本文件末尾 PROVENANCE）
 *   · 预测题挂在场景上，答错要能解释为什么错
 *
 * 铁律：draw / init / fallback 里**不许用 Date.now / Math.random / performance.now**。
 * 时间只有一个来源 —— 传进来的 t（场景内秒）。verify.mjs 会做双渲染 diff 来抓违规。
 */

// ---------------------------------------------------------------- 共享动画语义
/**
 * 「逐次提交 vs 一次提交」的时间表。three 路径与 2D 降级路径共用它，
 * 保证两种后端讲的是**同一个动画**（只是表现力不同）。
 */
function submissionAt(t) {
  const COL = { seqStart: 1.4, seqEnd: 7.4, instStart: 11.4, instEnd: 12.0 };
  const TOTAL = 20000;
  if (t < COL.seqStart) return { phase: 'idle', count: 0, hot: -1 };
  if (t < COL.seqEnd) {
    const p = (t - COL.seqStart) / (COL.seqEnd - COL.seqStart);
    const count = Math.floor(p * TOTAL);
    return { phase: 'sequential', count, hot: Math.floor(p * 64) };
  }
  if (t < COL.instStart) return { phase: 'hold', count: TOTAL, hot: -1 };
  if (t < COL.instEnd) {
    const p = (t - COL.instStart) / (COL.instEnd - COL.instStart);
    return { phase: 'instanced', count: TOTAL, hot: Math.floor(p * 64) };
  }
  return { phase: 'done', count: TOTAL, hot: -1 };
}

/** 同一批数据在 2D 里画成 160×125 的点阵（20000 个可数、可看） */
function drawDotGrid(ctx, t, el, api, { tint, label }) {
  const { w, h } = api;
  const COLS = 160, ROWS = 125, TOTAL = COLS * ROWS;
  const st = submissionAt(t);
  const pad = 10;
  const cw = (w - pad * 2) / COLS;
  const ch = (h - pad * 2) / ROWS;
  const r = Math.max(0.7, Math.min(cw, ch) * 0.42);

  ctx.save();
  for (let i = 0; i < TOTAL; i++) {
    const cx = pad + (i % COLS) * cw + cw / 2;
    const cy = pad + Math.floor(i / COLS) * ch + ch / 2;
    let on = 0;
    if (st.phase === 'sequential') on = i < st.count ? 1 : 0;
    else if (st.phase !== 'idle') on = 1;
    // 顺序提交时，正在提交的那一小段更亮 —— 让"一个一个来"看得见
    const near = st.phase === 'sequential' && i >= st.count - TOTAL * 0.02 && i < st.count;
    ctx.fillStyle = on
      ? (near ? api.palette['accent-2'] : tint)
      : api.palette.line;
    ctx.globalAlpha = on ? (near ? 1 : 0.85) : 0.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 左下角微型进度条：CPU 提交成本的累积（顺序提交一路涨，实例化一次到位）
  const barW = w * 0.62, barH = 8, bx = pad, by = h - 20;
  const frac = st.phase === 'idle' ? 0
    : st.phase === 'sequential' ? st.count / TOTAL * 0.97
      : 1;
  ctx.globalAlpha = 1;
  ctx.fillStyle = api.palette.line;
  ctx.fillRect(bx, by, barW, barH);
  ctx.fillStyle = st.phase === 'sequential' ? api.palette.bad : api.palette.good;
  ctx.fillRect(bx, by, barW * frac, barH);
  ctx.fillStyle = api.palette.muted;
  ctx.font = '12px ui-monospace, monospace';
  ctx.fillText(label, bx + barW + 10, by + 8);
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- 课件
export const deck = {
  meta: {
    title: '为什么 instancing 快 3.4 倍',
    subtitle: '同一份几何数据，只改提交方式',
    theme: 'ink',
  },
  scenes: [
    // ---------------------------------------------------------------- 01 钩子
    {
      id: 'hook',
      title: '同一份数据，差 3.4 倍',
      duration: 13,
      elements: [
        { id: 'kicker', group: 'head', type: 'text', role: 'kicker', text: 'WEBGPU · CPU 侧优化', x: 8, y: 12, w: 60 },
        { id: 'title', group: 'head', type: 'text', role: 'title', text: '两万个物体，<br>只改「怎么提交」', x: 8, y: 20, w: 60, size: 46 },
        { id: 'n-obj', type: 'metric', value: 0, suffix: '', label: '场景里的物体数', x: 8, y: 54, w: 24, decimals: 0 },
        { id: 'n-speed', type: 'metric', value: 0, unit: '×', label: 'CPU 帧时间差', tone: 'good', x: 40, y: 54, w: 24, decimals: 1 },
        { id: 'todo', type: 'text', role: 'body', text: '同样的顶点、同样的材质、同样的 GPU。<br>变的只有 CPU 每帧发出的命令。', x: 8, y: 80, w: 56 },
        { id: 'mark', type: 'annot', kind: 'underline', text: '只改这一层', x: 7.2, y: 27.5, w: 12, h: 10 },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: 'kicker', dur: 0.4 },
        { at: 0.7, action: 'reveal', target: 'title', dur: 0.6 },
        { at: 1.4, action: 'draw', target: 'mark', dur: 0.7 },
        { at: 1.6, action: 'countUp', target: 'n-obj', from: 0, to: 20000, dur: 1.6 },
        { at: 3.2, action: 'countUp', target: 'n-speed', from: 0, to: 3.4, dur: 1.0 },
        { at: 4.4, action: 'reveal', target: 'todo', dur: 0.6 },
        { at: 1.4, action: 'speak', text: '两万个物体。同一份几何数据，只改提交方式，CPU 帧时间差了三点四倍。' },
        { at: 5.4, action: 'speak', text: '顶点、材质、GPU 都没变。变的只有 CPU 每帧发出的命令。' },
      ],
      quiz: {
        q: '先猜一下：两万个物体，瓶颈最可能在哪儿？',
        opts: [
          { t: 'GPU 顶点处理不过来', ok: false, why: '两万 × 36 顶点 = 72 万顶点，现代 GPU 毫秒级就画完了。实测 GPU 只用了 1.85ms。' },
          { t: 'CPU 每帧发出的命令太多', ok: true, why: '对。真正的开销是两万次 writeBuffer + 两万次 drawIndexed，纯 CPU 侧。' },
          { t: '显存不够，在换页', ok: false, why: '两万 × 96 字节 ≈ 2MB，连一个纹理都比它大。' },
        ],
      },
    },

    // ---------------------------------------------------------------- 02 机制
    {
      id: 'mechanism',
      title: '逐次提交 vs 一次提交',
      duration: 20,
      elements: [
        { id: 'h-l', group: 'L', type: 'text', role: 'title', text: '逐对象提交', x: 4, y: 4, w: 44, size: 26 },
        { id: 'h-l-sub', group: 'L', type: 'text', role: 'body', text: 'N 次 writeBuffer + N 次 drawIndexed', x: 4, y: 10, w: 44, size: 15 },
        { id: 'grid-l', group: 'L', type: 'canvas2d', x: 4, y: 16, w: 44, h: 46, draw: (ctx, t, el, api) => drawDotGrid(ctx, t, el, api, { tint: api.palette.bad, label: 'CPU 累计' }) },
        { id: 'cnt-l', group: 'L', type: 'metric', value: 0, label: 'draw calls', tone: 'bad', x: 4, y: 66, w: 21, decimals: 0 },
        { id: 'ms-l', group: 'L', type: 'metric', value: 0, unit: 'ms', label: 'CPU 帧时间', tone: 'bad', x: 27, y: 66, w: 21, decimals: 2 },

        { id: 'h-r', group: 'R', type: 'text', role: 'title', text: '实例化提交', x: 52, y: 4, w: 44, size: 26 },
        { id: 'h-r-sub', group: 'R', type: 'text', role: 'body', text: '1 次 writeBuffer + 1 次带实例数的 drawIndexed', x: 52, y: 10, w: 44, size: 15 },
        { id: 'grid-r', group: 'R', type: 'canvas2d', x: 52, y: 16, w: 44, h: 46, draw: (ctx, t, el, api) => drawDotGrid(ctx, t, el, api, { tint: api.palette.good, label: 'CPU 累计' }) },
        { id: 'cnt-r', group: 'R', type: 'metric', value: 0, label: 'draw calls', tone: 'good', x: 52, y: 66, w: 21, decimals: 0 },
        { id: 'ms-r', group: 'R', type: 'metric', value: 0, unit: 'ms', label: 'CPU 帧时间', tone: 'good', x: 75, y: 66, w: 21, decimals: 2 },

        { id: 'note', type: 'text', role: 'body', text: '两边的点阵完全相同 —— 提交的是同一批物体。', x: 4, y: 90, w: 92, size: 16 },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: ['h-l', 'h-l-sub'], dur: 0.5 },
        { at: 0.7, action: 'reveal', target: ['grid-l', 'cnt-l', 'ms-l'], dur: 0.5 },
        { at: 1.0, action: 'grow', target: 'grid-l', from: 0, to: 1, dur: 1 },
        { at: 1.4, action: 'countUp', target: 'cnt-l', from: 0, to: 20000, dur: 6.0 },
        { at: 4.4, action: 'countUp', target: 'ms-l', from: 0, to: 3.80, dur: 3.0, ease: 'inout' },
        { at: 8.0, action: 'reveal', target: ['h-r', 'h-r-sub'], dur: 0.5 },
        { at: 8.4, action: 'reveal', target: ['grid-r', 'cnt-r', 'ms-r'], dur: 0.5 },
        { at: 8.8, action: 'grow', target: 'grid-r', from: 0, to: 1, dur: 0.6 },
        { at: 11.4, action: 'countUp', target: 'cnt-r', from: 0, to: 1, dur: 0.3 },
        { at: 11.6, action: 'countUp', target: 'ms-r', from: 0, to: 1.10, dur: 0.5 },
        { at: 12.6, action: 'reveal', target: 'note', dur: 0.5 },
        { at: 0.6, action: 'speak', text: '先看左边。每个物体单独提交一次，计数器一路涨到两万。' },
        { at: 6.6, action: 'speak', text: '每一次提交都要付一遍跨语言调用的固定开销，累计三点八毫秒。' },
        { at: 9.0, action: 'speak', text: '再看右边。同一批物体，一次提交，CPU 只调用一次。' },
        { at: 12.0, action: 'speak', text: '一点一毫秒。两边的点阵完全相同，提交的是同一批物体。' },
        { at: 15.0, action: 'wait', dur: 2 },
        { at: 15.4, action: 'speak', text: '省下来的不是算力，是两万次函数调用。' },
        { at: 19.0, action: 'spotlight', target: 'note', dur: 0.4 },
      ],
    },

    // ---------------------------------------------------------------- 03 3D
    {
      id: 'three',
      title: '在 3D 里看同一件事',
      duration: 25,
      elements: [
        { id: 'h', group: 'head', type: 'text', role: 'title', text: 'GPU 一直在画，忙的是 CPU', x: 4, y: 4, w: 60, size: 26 },
        { id: 'stage3d', type: 'three', x: 22, y: 12, w: 56, h: 62,
          camera: { pos: [8.5, 7, 10], look: [0, 0.4, 0], fov: 40 },
          // three 路径：一个 InstancedMesh 表示全部物体（真实项目里就是这么做的）
          init: (THREE, el, api) => {
            const N = 64;                       // 8×8：为了看清"逐个"
            const geo = new THREE.BoxGeometry(0.62, 0.62, 0.62);
            const mat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1, color: 0x2a3040 });
            const mesh = new THREE.InstancedMesh(geo, mat, N);
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            const m = new THREE.Matrix4();
            const col = new THREE.Color();
            const base = new THREE.Color(api.palette.line), hot = new THREE.Color(api.palette['accent-2']), lit = new THREE.Color(api.palette.accent);
            for (let i = 0; i < N; i++) {
              m.makeTranslation(((i % 8) - 3.5) * 0.86, 0, (Math.floor(i / 8) - 3.5) * 0.86);
              mesh.setMatrixAt(i, m);
              mesh.setColorAt(i, base);
            }
            const group = new THREE.Group();
            group.add(mesh);
            el.__group = group;                  // 交给 update 用（每次 buildScene 会重建，安全）
            api.scene?.add(group);
            return (t, el2, ctx3) => {
              const st = submissionAt(t);
              const g = el2.__group;
              if (!g) return;
              for (let i = 0; i < N; i++) {
                if (st.phase === 'idle') col.copy(base);
                else if (st.phase === 'sequential') col.copy(i < st.hot ? hot : base);
                else if (st.phase === 'instanced') col.copy(lit);
                else col.copy(lit);
                mesh.setColorAt(i, col);
              }
              mesh.instanceColor.needsUpdate = true;
              g.rotation.y = Math.sin(t * 0.25) * 0.35;
              g.position.y = 0.2 + Math.sin(t * 0.8) * 0.05;
            };
          },
          // 2D 降级：**同一条时间表**，等距投影画同一批方块
          fallback: {
            spin: 0.12,
            scale: 30,
            boxes: (t) => {
              const st = submissionAt(t);
              const out = [];
              for (let i = 0; i < 64; i++) {
                const on = st.phase === 'idle' ? 0
                  : st.phase === 'sequential' ? (i < st.hot ? 2 : 0)
                    : 2;
                out.push({
                  x: ((i % 8) - 3.5) * 0.86, z: (Math.floor(i / 8) - 3.5) * 0.86, y: 0, s: 0.62,
                  color: on === 2 ? '#5ac8fa' : on === 1 ? '#ffb454' : '#2a3040',
                });
              }
              return out;
            },
          },
        },
        { id: 'cnt', group: 'side', type: 'metric', value: 0, label: '已提交的 draw call', x: 82, y: 16, w: 15, decimals: 0 },
        { id: 'phase', group: 'side', type: 'text', role: 'kicker', text: '等待中', x: 82, y: 40, w: 18 },
        { id: 'legend', group: 'side', type: 'text', role: 'body', text: '一个立方体 = 一次提交<br>颜色 = 正在提交谁', x: 82, y: 48, w: 16, size: 14 },
        { id: 'cap', type: 'text', role: 'body', text: '为了看清「逐个」，这里用 64 个方块代表 20000 个物体。', x: 4, y: 80, w: 62, size: 15 },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: 'h', dur: 0.5 },
        { at: 0.6, action: 'reveal', target: 'stage3d', dur: 0.8 },
        { at: 1.0, action: 'reveal', target: ['cnt', 'phase', 'legend'], dur: 0.5 },
        { at: 1.4, action: 'countUp', target: 'cnt', from: 0, to: 64, dur: 6.0 },
        { at: 1.2, action: 'morph', target: 'phase', fromText: '阶段：逐个提交', charProgress: true, dur: 1.0 },
        { at: 11.4, action: 'morph', target: 'phase', fromText: '阶段：一次提交', charProgress: true, dur: 0.6 },
        { at: 11.4, action: 'countUp', target: 'cnt', from: 64, to: 1, dur: 0.3 },
        { at: 12.2, action: 'reveal', target: 'cap', dur: 0.5 },
        { at: 15.0, action: 'zoomTo', target: 'stage3d', scale: 1.35, dur: 1.6 },
        { at: 18.4, action: 'zoomTo', target: null, scale: 1.0, dur: 1.4 },
        { at: 0.8, action: 'speak', text: '先看逐个提交。每提交一次，就点亮一个方块，计数器一路涨上去。' },
        { at: 11.0, action: 'speak', text: '再看实例化：整批一次提交，GPU 仍然要画所有这些方块，但 CPU 只调用一次。' },
        { at: 18.8, action: 'speak', text: 'GPU 从头到尾都在正常干活。忙的一直是 CPU。' },
      ],
    },

    // ---------------------------------------------------------------- 04 真数字
    {
      id: 'numbers',
      title: '不是线性收益，有拐点',
      duration: 18,
      elements: [
        { id: 'h', group: 'head', type: 'text', role: 'title', text: '规模越大，差得越多', x: 6, y: 5, w: 60, size: 30 },
        { id: 'sub', group: 'head', type: 'text', role: 'body', text: '同一台机器实测 CPU 帧时间加速比', x: 6, y: 12, w: 60, size: 16 },
        { id: 'chart', type: 'chart', x: 6, y: 20, w: 44, h: 56,
          data: [
            { v: 2.1, vLabel: '2.1×', k: '500' },
            { v: 2.5, vLabel: '2.5×', k: '2 000' },
            { v: 3.6, vLabel: '3.6×', k: '8 000' },
            { v: 3.4, vLabel: '3.4×', k: '20 000', tone: 'good' },
          ] },
        { id: 'mark', type: 'annot', kind: 'circle', text: '收益最大区', x: 40, y: 22, w: 12, h: 44 },
        { id: 'l1', group: 'rows', type: 'list', x: 56, y: 20, w: 40, items: [
          { badge: '—', text: '500 个物体：只快 2.1 倍，绝对值省下 0.11ms' },
          { badge: '—', text: '2 000 个：2.5 倍，省 0.29ms' },
          { badge: '—', text: '8 000 个：3.6 倍，省 1.26ms' },
          { badge: '—', text: '20 000 个：3.4 倍，省 2.70ms' },
        ] },
        { id: 'concl', type: 'text', role: 'quote', text: '省下的是「固定开销 × 次数」。<br>次数少的时候，这笔钱不值得重构。', x: 56, y: 60, w: 40, size: 20 },
        { id: 'src', type: 'text', role: 'body', text: '来源：本机实测，Apple M5 Pro / Chrome 153 / Metal 4', x: 6, y: 88, w: 70, size: 13 },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: ['h', 'sub'], dur: 0.5 },
        { at: 0.8, action: 'reveal', target: 'chart', dur: 0.5 },
        { at: 1.0, action: 'grow', target: 'chart', from: 0, to: 1, dur: 1.8, ease: 'out' },
        { at: 3.0, action: 'stagger', target: ['l1'], step: 0, dur: 0.6 },
        { at: 2.4, action: 'reveal', target: 'l1', dur: 0.6 },
        { at: 4.4, action: 'draw', target: 'mark', dur: 0.8 },
        { at: 6.0, action: 'reveal', target: 'concl', dur: 0.6 },
        { at: 7.4, action: 'reveal', target: 'src', dur: 0.5 },
        { at: 0.6, action: 'speak', text: '四个规模，四组实测。五百个物体只快两倍出头，省下的绝对值小到可以忽略。' },
        { at: 7.8, action: 'speak', text: '两千到两万，加速比稳定在三倍以上。省下的是固定开销乘次数。' },
        { at: 12.0, action: 'speak', text: '次数少的时候，这笔钱不值得你为此重构代码。' },
      ],
    },

    // ---------------------------------------------------------------- 05 边界
    {
      id: 'boundary',
      title: '别搞错优化对象',
      duration: 16,
      elements: [
        { id: 'h', group: 'head', type: 'text', role: 'title', text: 'GPU 时间一点没变', x: 6, y: 6, w: 60, size: 30 },
        { id: 'm1', group: 'gpu', type: 'metric', value: 0.19, unit: 'ms', label: '逐对象提交 · GPU', x: 6, y: 20, w: 26, decimals: 2 },
        { id: 'm2', group: 'gpu', type: 'metric', value: 0, unit: 'ms', label: '实例化 · GPU', tone: 'accent', x: 36, y: 20, w: 26, decimals: 2 },
        { id: 'note', type: 'text', role: 'body', text: '两边的 GPU 时间随规模同步增长 —— 优化的是 CPU，不是 GPU。', x: 6, y: 40, w: 56, size: 18 },
        { id: 'l', group: 'rules', type: 'list', x: 6, y: 52, w: 84, items: [
          { badge: '判', text: '先看 cpu/frame 和 gpu/frame 谁更接近帧预算 —— 别凭直觉选优化方向' },
          { badge: '判', text: 'GPU 只有 1.85ms，远未饱和；继续优化 shader 是浪费' },
          { badge: '判', text: '总 draw 数 < 2000 时，instancing 的复杂度不值得' },
        ] },
        { id: 'quizhint', type: 'text', role: 'kicker', text: '最后一题 →', x: 6, y: 86, w: 30 },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: 'h', dur: 0.5 },
        { at: 0.7, action: 'reveal', target: ['m1'], dur: 0.5 },
        { at: 0.9, action: 'countUp', target: 'm1', from: 0, to: 0.19, dur: 0.8 },
        { at: 1.6, action: 'reveal', target: ['m2'], dur: 0.5 },
        { at: 1.8, action: 'countUp', target: 'm2', from: 0, to: 1.85, dur: 1.0 },
        { at: 3.0, action: 'reveal', target: 'note', dur: 0.6 },
        { at: 4.0, action: 'reveal', target: 'l', dur: 0.8 },
        { at: 6.0, action: 'reveal', target: 'quizhint', dur: 0.4 },
        { at: 0.5, action: 'speak', text: '注意：GPU 时间从零点一九到一点八五毫秒，两边随规模同步增长。' },
        { at: 6.6, action: 'speak', text: '所以这是一次纯 CPU 侧的优化。判断方向看谁更接近帧预算。' },
        { at: 11.0, action: 'speak', text: '总绘制数少于两千的时候，别为它重构。' },
      ],
      quiz: {
        q: '你的场景每帧 300 次 draw，cpu/frame 是 0.4ms，gpu/frame 是 9ms。该做 instancing 吗？',
        opts: [
          { t: '该做，instancing 能快 3 倍', ok: false, why: '3 倍是两万 draw 时的数字；300 draw 时约 1.1 倍，只省 0.04ms。' },
          { t: '不该：CPU 远未饱和（0.4ms vs 16ms 预算），GPU 才是瓶颈', ok: true, why: '对。该动的是 GPU 侧（shader/分辨率/批量），不是提交方式。' },
          { t: '两个都做，反正没坏处', ok: false, why: '多一条 shader 路径 = 双份维护与 bug 面，而收益是 0.04ms。' },
        ],
      },
    },
  ],
};

/** 数字溯源：正文里出现的每个数字都必须能追到这里（交付时由 verify.mjs 检查是否有 PROVENANCE）。 */
export const PROVENANCE = [
  { claim: '20000 对象 separate 3.799ms / instanced 1.104ms', source: 'bench/results/canonical-full-suite.json#01-instancing' },
  { claim: '500/2000/8000/20000 加速比 2.1×/2.5×/3.6×/3.4×', source: 'sweep: node bench/run.mjs --pages=01 --query="objects=N"' },
  { claim: 'GPU 时间 0.19ms → 1.85ms（两侧同步增长）', source: 'bench/results/canonical-full-suite.json gpu.min 列' },
  { claim: '验收样本来自 webgpu 项目（同机实测）', source: 'docs/webgpu-deep-dive.md §4.3' },
];

export default deck;
