/**
 * templates/scenes.strokes.js —— 「按笔画出来」端到端示例
 *
 * 主题：有些知识，只有一笔一笔画出来才讲得清。
 *
 * 五个 case，每一个都在回答「为什么必须逐笔」：
 *   01 结果 vs 过程   —— 同一组像素，两种给法（本模式的立论）
 *   02 de Casteljau   —— 构造过程本身就是知识（曲线的定义）
 *   03 A* 寻路        —— 顺序就是知识（为什么走这条路）
 *   04 SDF 字形       —— 数学 → 字形（等值线收缩成笔画）
 *   05 边界           —— 什么时候不该逐笔（并列信息一次给完）
 *
 * 贯穿全篇的一个 12 行抽象（见 drawStrokes）：
 *     「一组笔画 + 一个进度 = 一张画」
 * 有了它，「按笔画」就不再是每个场景手搓的细节，而是一个可复用的表达方式。
 *
 * 确定性：本文件不使用 Date.now / Math.random / performance.now。
 * 所有算法（A* 搜索顺序、SDF 距离场）在模块加载时算一次，是纯函数。
 */

// ---------------------------------------------------------------- 核心抽象
const clamp01 = (p) => Math.max(0, Math.min(1, p));

/**
 * 把「一组笔画」按总进度 p 画出来：第 k 笔画完才轮到第 k+1 笔。
 * 只有**正在画的那一笔**会带笔尖（nib）—— 观众因此知道"现在画到哪"。
 *
 * 这是整个模式的最小内核：画面 = f(笔画序列, 进度)。
 */
function drawStrokes(ctx, strokes, p, ink, pal) {
  const total = clamp01(p) * strokes.length;
  strokes.forEach((st, i) => {
    const local = clamp01(total - i);          // 第 i 笔自己的进度
    if (local <= 0) return;
    const o = { color: pal[st.tone] ?? st.tone ?? pal.accent, width: st.width ?? 2.5, glow: st.glow, dash: st.dash, alpha: st.alpha };
    const head = st.cubic ? ink.cubic(ctx, st.cubic, local, o) : ink.path(ctx, st.pts, local, o);
    // 笔尖在收尾 14% 里淡出 —— 直接消失会"啪"一下（这个细节是 G10 的锯齿曲线暴露出来的）
    const fade = clamp01((1 - local) / 0.14);
    if (fade > 0) ink.nib(ctx, head, o.color, (st.nib ?? 4.5) * (0.65 + 0.35 * fade), fade);
  });
}

/** 示例用的一张图：控制多边形 + 由它决定的曲线（两条路径共用，保证"同一张图"） */
function figureStrokes(w, h) {
  const P = [[0.08, 0.86], [0.3, 0.1], [0.7, 0.1], [0.92, 0.86]].map(([a, b]) => [a * w, b * h]);
  return [
    { pts: [P[0], P[1]], tone: 'line', width: 2, dash: [6, 5] },
    { pts: [P[1], P[2]], tone: 'line', width: 2, dash: [6, 5] },
    { pts: [P[2], P[3]], tone: 'line', width: 2, dash: [6, 5] },
    { cubic: P, tone: 'accent', width: 3.5, glow: 12, nib: 5 },
  ];
}

// ---------------------------------------------------------------- 03 A* 搜索（确定性预计算）
/**
 * 15×9 网格 + 一道带缺口的墙。用 A*（f = g + 曼哈顿距离）展开，
 * 平局按入队顺序打破 —— 因此**顺序完全确定**，可重复、可断言。
 */
export const SEARCH = (() => {
  const W = 15, H = 9;
  const blocked = new Set();
  for (let y = 0; y < H; y++) if (y !== 2) blocked.add(`7,${y}`);        // 墙，缺口在 y=2
  for (let y = 3; y < H; y++) blocked.add(`11,${y}`);                    // 第二道墙，缺口在 y=0..2
  const start = [1, 4], goal = [13, 6];
  const key = (x, y) => `${x},${y}`;
  const h = (x, y) => Math.abs(x - goal[0]) + Math.abs(y - goal[1]);

  const g = new Map([[key(...start), 0]]);
  const prev = new Map();
  const order = [];
  const open = [{ x: start[0], y: start[1], f: h(...start), seq: 0 }];
  let seq = 1;
  const closed = new Set();

  while (open.length) {
    // 取 f 最小者；平局取先入队的（稳定 → 确定性）
    let bi = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bi].f || (open[i].f === open[bi].f && open[i].seq < open[bi].seq)) bi = i;
    }
    const cur = open.splice(bi, 1)[0];
    const ck = key(cur.x, cur.y);
    if (closed.has(ck)) continue;
    closed.add(ck);
    order.push([cur.x, cur.y]);
    if (cur.x === goal[0] && cur.y === goal[1]) break;

    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = cur.x + dx, ny = cur.y + dy, nk = key(nx, ny);
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || blocked.has(nk) || closed.has(nk)) continue;
      const ng = (g.get(ck) ?? 0) + 1;
      if (g.has(nk) && g.get(nk) <= ng) continue;
      g.set(nk, ng);
      prev.set(nk, [cur.x, cur.y]);
      open.push({ x: nx, y: ny, f: ng + h(nx, ny), seq: seq++ });
    }
  }

  const path = [];
  for (let cur = goal; cur; cur = prev.get(key(...cur))) path.unshift(cur);

  return { W, H, blocked, start, goal, order, path, key };
})();

// ---------------------------------------------------------------- 04 SDF 距离场（确定性预计算）
/**
 * 字母 A 的骨架（三条线段）的距离场：每个像素记录它到最近笔画的距离。
 * 这是 GPU 文字渲染的核心数据结构 —— 一个 float 就能做描边/发光/抗锯齿/阴影。
 * 在模块加载时算一次，之后每帧只是「按阈值取等值线」。
 */
export const SDF = (() => {
  const W = 180, H = 101;
  const ASPECT = W / H;                          // 距离必须在等比空间里算，否则会被拉歪
  const segs = [
    [[0.62, 0.92], [0.887, 0.10]],               // 左腿
    [[1.154, 0.10], [1.42, 0.92]],               // 右腿
    [[0.74, 0.62], [1.30, 0.62]],                // 横杠
  ];
  const distToSeg = (px, py, a, b) => {
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const wx = px - a[0], wy = py - a[1];
    const L2 = vx * vx + vy * vy;
    const u = L2 > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / L2)) : 0;
    return Math.hypot(wx - vx * u, wy - vy * u);
  };
  const f = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const px = (x + 0.5) / H, py = (y + 0.5) / H;   // 1 单位 = 画布高度 → 各向同性
      let d = Infinity;
      for (const [a, b] of segs) d = Math.min(d, distToSeg(px, py, a, b));
      f[y * W + x] = d;
    }
  }
  return { W, H, ASPECT, segs, f };
})();

const hex2rgb = (hex) => {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [90, 200, 250];
};

// ================================================================= 课件
export const deck = {
  meta: { title: '按笔画出来的东西', subtitle: '为什么有些知识只能逐笔讲', theme: 'ink' },
  scenes: [
    // ---------------------------------------------------------- 01 立论
    {
      id: 'thesis',
      title: '同一张图，两种给法',
      duration: 16,
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '讲解模式 · 立论', x: 8, y: 8, w: 50 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '同一张图，两种给法', x: 8, y: 13, w: 70, size: 40 },

        { id: 'la', group: 'A', type: 'text', role: 'kicker', text: 'A · 一次给完', x: 6, y: 30, w: 40 },
        { id: 'fa', group: 'A', type: 'canvas2d', x: 6, y: 35, w: 40, h: 42,
          draw: (ctx, t, el, api) => drawStrokes(ctx, figureStrokes(api.w, api.h), api.state.p, api.ink, api.palette) },
        { id: 'lb', group: 'B', type: 'text', role: 'kicker', text: 'B · 一笔一笔画', x: 54, y: 30, w: 40 },
        { id: 'fb', group: 'B', type: 'canvas2d', x: 54, y: 35, w: 40, h: 42, monotonic: true,
          draw: (ctx, t, el, api) => drawStrokes(ctx, figureStrokes(api.w, api.h), api.state.p, api.ink, api.palette) },

        { id: 'note', type: 'text', role: 'body', text: '像素完全一样，图的形状完全一样。<br>唯一的区别：信息什么时候到达观众眼前。', x: 8, y: 82, w: 84, size: 17 },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.5 },
        { at: 0.9, action: 'reveal', target: ['la', 'fa'], dur: 0.4 },
        { at: 1.0, action: 'draw', target: 'fa', dur: 0.02 },     // 瞬间：4 笔一起出现
        { at: 1.4, action: 'reveal', target: ['lb', 'fb'], dur: 0.4 },
        { at: 1.5, action: 'draw', target: 'fb', dur: 8 },        // 逐笔：8 秒画完同样 4 笔
        { at: 9.8, action: 'reveal', target: 'note', dur: 0.6 },
        { at: 0.6, action: 'speak', text: '这是同一张图。左边一次给完，右边一笔一笔画。' },
        { at: 10.2, action: 'speak', text: '像素完全一样，区别只有信息到达的节奏。' },
      ],
      quiz: {
        q: '同一张图，两种给法，真正的差别是什么？',
        opts: [
          { t: '清晰度 —— 逐笔画的更清楚', ok: false, why: '像素完全相同，最终画面一模一样。' },
          { t: '信息释放的节奏 —— 观众注意力被引到哪里', ok: true, why: '对。一次给完时观众自己找顺序；逐笔给出时，顺序由你控制。' },
          { t: '文件大小 —— 逐笔画的更大', ok: false, why: '两者渲染开销在同一量级，和表达方式无关。' },
        ],
      },
    },

    // ---------------------------------------------------------- 02 构造过程就是知识
    {
      id: 'casteljau',
      title: '贝塞尔曲线是怎么被画出来的',
      duration: 26,
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: 'CASE 1 · 构造过程就是知识', x: 4, y: 4, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '曲线不是画出来的，是构造出来的', x: 4, y: 9, w: 62, size: 30 },

        { id: 'c', group: 'canvas', type: 'canvas2d', x: 4, y: 20, w: 60, h: 68, monotonic: true, draw: drawCasteljau },   // y+h ≤ 90：字幕带从 90% 起

        { id: 'l1', group: 'steps', type: 'text', role: 'body', text: '① 控制多边形 —— 三个线段，一笔一笔来', x: 68, y: 22, w: 30, size: 17 },
        { id: 'l2', group: 'steps', type: 'text', role: 'body', text: '② 每条线段上按同一个比例 u 取点，得到第一层 Q', x: 68, y: 38, w: 30, size: 17 },
        { id: 'l3', group: 'steps', type: 'text', role: 'body', text: '③ 同样的规则再来一层：R', x: 68, y: 54, w: 30, size: 17 },
        { id: 'l4', group: 'steps', type: 'text', role: 'body', text: '④ 只剩一个点 S —— 它由全部控制点决定', x: 68, y: 68, w: 30, size: 17 },
        { id: 'l5', group: 'steps', type: 'text', role: 'quote', text: 'u 从 0 走到 1，S 扫过的轨迹就是曲线本身。', x: 68, y: 82, w: 30, size: 18 },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.5 },
        { at: 0.8, action: 'reveal', target: 'c', dur: 0.5 },
        { at: 1.0, action: 'reveal', target: 'l1', dur: 0.5 },
        { at: 4.2, action: 'reveal', target: 'l2', dur: 0.5 },
        { at: 7.8, action: 'reveal', target: 'l3', dur: 0.5 },
        { at: 9.2, action: 'reveal', target: 'l4', dur: 0.5 },
        { at: 11.4, action: 'reveal', target: 'l5', dur: 0.5 },
        { at: 0.8, action: 'speak', text: '先画控制多边形。三个线段，一笔一笔来。' },
        { at: 5.2, action: 'speak', text: '然后在每条线段上按同一个比例取点，得到第一层。' },
        { at: 10.6, action: 'speak', text: '同样的规则再来两层，只剩一个点。' },
        { at: 14.6, action: 'speak', text: '让比例从零走到一，这个点扫过的轨迹，就是贝塞尔曲线本身。' },
        { at: 21.6, action: 'speak', text: '所以曲线不是被画出来的，是被构造出来的。' },
      ],
      quiz: {
        q: '曲线上的点，是怎么算出来的？',
        opts: [
          { t: '用公式直接代入 t 求值', ok: false, why: '公式是对的，但那是"结果"。这里要讲的是它等价于逐层线性插值 —— 这才是可构造、可推广的理解。' },
          { t: '把控制点逐层做线性插值，最后一层的点就在曲线上', ok: true, why: '对，这就是 de Casteljau 算法。任意阶都成立，而且数值稳定。' },
          { t: '把控制点连起来再圆角', ok: false, why: '圆角只是近似外观；贝塞尔曲线有严格的数学定义。' },
        ],
      },
    },

    // ---------------------------------------------------------- 03 顺序就是知识
    {
      id: 'astar',
      title: 'A* 为什么走这条路',
      duration: 20,
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: 'CASE 2 · 顺序就是知识', x: 4, y: 4, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '它是被终点"吸"过去的', x: 4, y: 9, w: 60, size: 30 },

        { id: 'c', group: 'canvas', type: 'canvas2d', x: 4, y: 20, w: 56, h: 68, draw: drawAstar },
        { id: 'cap', group: 'canvas', type: 'text', role: 'body', text: '暗格 = 已访问过；亮格 = 当前正在展开的前沿', x: 4, y: 90, w: 56, size: 14 },

        { id: 'm1', type: 'metric', value: 0, label: '访问过的格子', x: 64, y: 22, w: 32, decimals: 0 },
        { id: 'm2', type: 'metric', value: 0, label: '最短路径长度', x: 64, y: 44, w: 32, decimals: 0 },
        { id: 'l', group: 'list', type: 'list', x: 64, y: 66, w: 32, items: [
          { badge: 'f', text: 'f = 已走步数 g + 到终点的曼哈顿距离 h' },
          { badge: '序', text: '每次展开 f 最小的格子，平局按入队顺序' },
          { badge: '回', text: '到达终点后沿 prev 指针回溯，得到路径' },
        ] },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.5 },
        { at: 0.8, action: 'reveal', target: 'c', dur: 0.5 },
        { at: 1.2, action: 'reveal', target: 'cap', dur: 0.5 },
        { at: 3.0, action: 'reveal', target: 'l', dur: 0.6 },
        { at: 5.0, action: 'reveal', target: 'm1', dur: 0.5 },
        { at: 5.2, action: 'countUp', target: 'm1', from: 0, to: SEARCH.order.length, dur: 6, ease: 'linear' },
        { at: 12.6, action: 'reveal', target: 'm2', dur: 0.5 },
        { at: 13.0, action: 'countUp', target: 'm2', from: 0, to: SEARCH.path.length - 1, dur: 1.6 },
        { at: 0.6, action: 'speak', text: '从起点开始，每次展开代价加启发式最小的格子。' },
        { at: 6.4, action: 'speak', text: '注意顺序：它不是一圈圈均匀扩散，而是被终点吸过去。' },
        { at: 13.4, action: 'speak', text: '找到终点后回溯，路径逐笔画出。' },
        { at: 17.0, action: 'speak', text: '静态图只能给你最后那条线。' },
      ],
    },

    // ---------------------------------------------------------- 04 数学 → 字形
    {
      id: 'sdf',
      title: '一个 float 里的字形',
      duration: 18,
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: 'CASE 3 · 数学 → 字形', x: 6, y: 5, w: 56 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '笔画是从距离场里"浮"出来的', x: 6, y: 10, w: 56, size: 30 },

        { id: 'c', group: 'canvas', type: 'canvas2d', x: 6, y: 22, w: 56, h: 62, draw: drawSdf },

        { id: 'l', group: 'list', type: 'list', x: 66, y: 24, w: 30, items: [
          { badge: '场', text: '每个像素存它到最近笔画的距离（一个 float）' },
          { badge: '线', text: '等值线往里收，笔画自己浮出来' },
          { badge: '用', text: '描边、发光、抗锯齿、阴影都从同一个场算' },
        ] },
        { id: 'note', type: 'text', role: 'body', text: '改一个阈值就换一种效果 —— 这是 GPU 文字渲染的核心。', x: 6, y: 88, w: 56, size: 15 },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.5 },
        { at: 0.8, action: 'reveal', target: 'c', dur: 0.5 },
        { at: 1.0, action: 'grow', target: 'c', from: 0, to: 1, dur: 12, ease: 'linear' },
        { at: 13.6, action: 'reveal', target: 'l', dur: 0.6 },
        { at: 15.0, action: 'reveal', target: 'note', dur: 0.5 },
        { at: 0.6, action: 'speak', text: '这是字母 A 的距离场：每个像素记录它到最近笔画有多远。' },
        { at: 7.2, action: 'speak', text: '把等值线一层层往里收，笔画自己浮出来。' },
        { at: 11.8, action: 'speak', text: '描边、发光、抗锯齿、阴影，全都由同一个场算出来。' },
      ],
    },

    // ---------------------------------------------------------- 05 边界
    {
      id: 'boundary',
      title: '什么时候不该逐笔',
      duration: 18,
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '模式的边界', x: 6, y: 5, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '逐笔不是万能药', x: 6, y: 10, w: 60, size: 30 },

        { id: 'la', group: 'A', type: 'text', role: 'kicker', text: 'A · 有先后关系 → 逐笔', x: 6, y: 22, w: 42 },
        { id: 'ca', group: 'A', type: 'canvas2d', x: 6, y: 27, w: 42, h: 34, monotonic: true, draw: drawPipeline },
        { id: 'lb', group: 'B', type: 'text', role: 'kicker', text: 'B · 只是并列比较 → 一次给完', x: 52, y: 22, w: 42 },
        { id: 'cb', group: 'B', type: 'canvas2d', x: 52, y: 27, w: 42, h: 34, draw: drawBars },

        { id: 'l', group: 'list', type: 'list', x: 6, y: 66, w: 88, items: [
          { badge: '问', text: '信息里有"先后/依赖/构造顺序"吗？有 → 逐笔（观众跟着推理）' },
          { badge: '问', text: '只是并列的数字对比吗？是 → 一次给完（观众要的是同时比较）' },
          { badge: '问', text: '逐笔超过 8 秒还没画完？→ 拆幕，或改成"先给结果再补过程"' },
        ] },
        { id: 'q', group: 'list', type: 'text', role: 'quote', text: '逐笔的价值是"顺序"，不是"动起来"。没有顺序信息时，动画只是慢。', x: 6, y: 87, w: 88, size: 18 },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.5 },
        { at: 0.9, action: 'reveal', target: ['la', 'ca'], dur: 0.4 },
        { at: 1.0, action: 'draw', target: 'ca', dur: 5 },
        { at: 6.6, action: 'reveal', target: ['lb', 'cb'], dur: 0.4 },
        { at: 6.7, action: 'draw', target: 'cb', dur: 0.05 },       // 并列数据：瞬间给完
        { at: 7.6, action: 'reveal', target: 'l', dur: 0.7 },
        { at: 12.4, action: 'reveal', target: 'q', dur: 0.6 },
        { at: 0.6, action: 'speak', text: '反过来看：这四根柱子的关系是并列的，没有先后。' },
        { at: 6.0, action: 'speak', text: '一次给完就够了，逐笔反而浪费观众的时间。' },
        { at: 10.8, action: 'speak', text: '判据很简单：信息里有顺序就逐笔，只是并列就一次给完。' },
      ],
    },
  ],
};

// ================================================================= 各 case 的画法

/** CASE 1：de Casteljau 逐层构造 —— 粗结构用 beats，细节奏用 t */
function drawCasteljau(ctx, t, el, api) {
  const { w, h, ink, palette: pal } = api;
  const P = [[0.07, 0.88], [0.29, 0.08], [0.71, 0.08], [0.93, 0.88]].map(([a, b]) => [a * w, b * h]);
  const ease = (p) => 1 - Math.pow(1 - clamp01(p), 3);

  // ---- 阶段划分（秒）
  const T = { poly: [0.6, 2.6], dots: [2.6, 3.8], q: [3.8, 7.6], r: [7.6, 9.8], s: [9.8, 11.2], sweep: [11.2, 22.0] };
  const seg = (a, b) => clamp01((t - a) / (b - a));
  const inRange = (a, b) => t >= a && t <= b;

  // ---- ① 控制多边形：三笔，逐笔
  if (t >= T.poly[0]) {
    const spans = [[0, 1], [1, 2], [2, 3]];
    const total = seg(...T.poly) * 3;
    spans.forEach(([i, j], k) => {
      const local = clamp01(total - k);
      if (local <= 0) return;
      const head = ink.line(ctx, P[i], P[j], local, { color: pal.line, width: 2, dash: [6, 5] });
      if (local < 1) ink.nib(ctx, head, pal['accent-2'], 4);
    });
  }

  // ---- ② 控制点
  if (t >= T.dots[0]) {
    const a = seg(...T.dots);
    P.forEach((p, i) => {
      const local = clamp01(a * 4 - i);
      if (local <= 0) return;
      ink.dot(ctx, p[0], p[1], 5 * local, pal['accent-2']);
      ink.label(ctx, `P${i}`, p[0], p[1] - 16, { color: pal['accent-2'], align: 'center', alpha: local });
    });
  }

  // ---- ③④⑤ 逐层插值：u 固定 = 0.42，看一次完整构造
  const U0 = 0.42;
  const showLevel = (from, to, u, labelPrefix) => {
    const a = seg(from, to);
    const pts = [];
    for (let i = 0; i < 3; i++) pts.push(ink.lerp(P[i], P[i + 1], u));
    if (t < from) return null;
    pts.forEach((p, i) => {
      const local = clamp01(a * 3 - i);
      if (local <= 0) return;
      const src = P[i];
      const head = ink.line(ctx, src, p, local, { color: pal.accent, width: 2, alpha: 0.9 });
      if (local < 1) ink.nib(ctx, head, pal.accent, 3.5);
      else { ink.ring(ctx, p[0], p[1], 5, pal.accent, 2); ink.label(ctx, `${labelPrefix}${i}`, p[0] + 9, p[1] - 9, { color: pal.accent }); }
    });
    return pts;
  };
  const Q = showLevel(...T.q, U0, 'Q');
  const R = (t >= T.r[0] && Q) ? (() => {
    const a = seg(...T.r);
    const pts = [ink.lerp(Q[0], Q[1], U0), ink.lerp(Q[1], Q[2], U0)];
    pts.forEach((p, i) => {
      const local = clamp01(a * 2 - i);
      if (local <= 0) return;
      const head = ink.line(ctx, Q[i], p, local, { color: pal.good, width: 2.4 });
      if (local < 1) ink.nib(ctx, head, pal.good, 3.5);
      else { ink.ring(ctx, p[0], p[1], 5.5, pal.good, 2); ink.label(ctx, `R${i}`, p[0] + 9, p[1] + 12, { color: pal.good }); }
    });
    return pts;
  })() : null;
  if (t >= T.s[0] && R) {
    const a = seg(...T.s);
    const S = ink.lerp(R[0], R[1], U0);
    const head = ink.line(ctx, R[0], S, a, { color: pal.ink, width: 3 });
    if (a < 1) ink.nib(ctx, head, pal.ink, 4);
    else { ink.ring(ctx, S[0], S[1], 7, pal.ink, 2.5); ink.label(ctx, 'S', S[0] + 11, S[1] - 11, { color: pal.ink }); }
  }

  // ---- ⑥ u 从 0 扫到 1：曲线自己长出来（S 的轨迹 == 曲线）
  if (t >= T.sweep[0]) {
    const u = ease(seg(...T.sweep));
    // 正在生长的曲线 —— 这一帧唯一"在画"的一笔
    const head = ink.cubic(ctx, P, u, { color: pal.accent, width: 4, glow: 16, step: 1 });
    ink.nib(ctx, head, pal.accent, 5.5, clamp01((1 - u) / 0.08));   // 扫到终点前淡出
    // 当前 u 的构造过程（细线 + 空心点，p=1 因此不算"在生长"，只是背景）
    const q = [0, 1, 2].map((i) => ink.lerp(P[i], P[i + 1], u));
    const r = [0, 1].map((i) => ink.lerp(q[i], q[i + 1], u));
    const s = ink.lerp(r[0], r[1], u);
    q.forEach((p, i) => { ink.line(ctx, P[i], p, 1, { color: pal.accent, width: 1.4, alpha: 0.45 }); ink.dot(ctx, p[0], p[1], 3.5, pal.accent, 0.9); });
    r.forEach((p, i) => { ink.line(ctx, q[i], p, 1, { color: pal.good, width: 1.4, alpha: 0.5 }); ink.dot(ctx, p[0], p[1], 3.5, pal.good, 0.9); });
    ink.line(ctx, r[0], s, 1, { color: pal.ink, width: 1.4, alpha: 0.5 });
    ink.dot(ctx, s[0], s[1], 6, pal.ink);
    ink.label(ctx, `u = ${u.toFixed(2)}`, 12, 16, { color: pal.accent, font: '14px ui-monospace, monospace' });
  } else if (t >= T.q[0]) {
    ink.label(ctx, `u = ${U0.toFixed(2)}`, 12, 16, { color: pal.muted, font: '14px ui-monospace, monospace' });
  }
}

/** CASE 2：A* —— 前沿扩散（顺序）→ 回溯路径（逐笔） */
function drawAstar(ctx, t, el, api) {
  const { w, h, ink, palette: pal } = api;
  const { W, H, blocked, start, goal, order, path, key } = SEARCH;
  const pad = 6;
  const cw = (w - pad * 2) / W, ch = (h - pad * 2) / H;
  const cx = (x) => pad + (x + 0.5) * cw;
  const cy = (y) => pad + (y + 0.5) * ch;

  const T = { grow: [0.6, 11.0], path: [12.6, 17.6] };
  const seg = (a, b) => clamp01((t - a) / (b - a));

  // 网格底
  ctx.save();
  ctx.strokeStyle = pal.line; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
  for (let x = 0; x <= W; x++) { ctx.beginPath(); ctx.moveTo(pad + x * cw, pad); ctx.lineTo(pad + x * cw, pad + H * ch); ctx.stroke(); }
  for (let y = 0; y <= H; y++) { ctx.beginPath(); ctx.moveTo(pad, pad + y * ch); ctx.lineTo(pad + W * cw, pad + y * ch); ctx.stroke(); }
  ctx.restore();

  // 障碍
  for (const k of blocked) {
    const [x, y] = k.split(',').map(Number);
    ctx.fillStyle = pal.line;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(pad + x * cw + 1, pad + y * ch + 1, cw - 2, ch - 2);
  }
  ctx.globalAlpha = 1;

  // 已访问：按顺序填暗格；最后 6 个是"当前前沿"，更亮
  const n = Math.floor(seg(...T.grow) * order.length);
  order.slice(0, n).forEach(([x, y], i) => {
    const fresh = i >= n - 6;
    ctx.fillStyle = fresh ? pal['accent-2'] : pal.accent;
    ctx.globalAlpha = fresh ? 0.5 : 0.13;
    ctx.fillRect(pad + x * cw + 1, pad + y * ch + 1, cw - 2, ch - 2);
  });
  ctx.globalAlpha = 1;

  // 起点 / 终点
  const mark = (x, y, color, label) => {
    ink.ring(ctx, cx(x), cy(y), Math.min(cw, ch) * 0.34, color, 2.5);
    ink.label(ctx, label, cx(x), cy(y), { color, align: 'center', font: 'bold 11px ui-monospace, monospace' });
  };
  mark(start[0], start[1], pal.good, 'S');
  mark(goal[0], goal[1], pal.bad, 'G');

  // 路径：逐笔画出（一个 ink.path 沿格子中心）
  if (t >= T.path[0]) {
    const pts = path.map(([x, y]) => [cx(x), cy(y)]);
    const p = seg(...T.path);
    const head = ink.path(ctx, pts, p, { color: pal.ink, width: 3.5, glow: 14, step: 1 });
    ink.nib(ctx, head, pal.ink, 5.5);
    ink.label(ctx, `${order.length} 格已访问 · 路径 ${path.length - 1} 步`, 10, h - 12, { color: pal.muted });
  }
}

/** CASE 3：SDF —— 等值线一层层收进字形 */
function drawSdf(ctx, t, el, api) {
  const { w, h, ink, palette: pal } = api;
  const { W, H, ASPECT, segs, f } = SDF;
  const p = clamp01(api.state.grow);

  if (!el.__img) el.__img = ctx.createImageData(W, H);
  const img = el.__img;
  const d = img.data;
  const [ar, ag, ab] = hex2rgb(pal.accent);
  const base = 0.92 - p * 0.90;                 // 主等值线：从 0.92 收到 0.02
  const RINGS = 5, GAP = 0.075;

  for (let i = 0; i < W * H; i++) {
    const dist = f[i];
    let band = -1;
    for (let k = 0; k < RINGS; k++) {
      if (Math.abs(dist - (base + k * GAP)) < 0.008) { band = k; break; }
    }
    const o = i * 4;
    if (band >= 0) {
      const a = 255 - band * 42;                 // 越外圈越淡
      d[o] = ar; d[o + 1] = ag; d[o + 2] = ab; d[o + 3] = a;
    } else if (dist < base) {
      const a = Math.round(26 + 46 * (1 - dist / Math.max(0.02, base)));
      d[o] = ar; d[o + 1] = ag; d[o + 2] = ab; d[o + 3] = a;
    } else { d[o + 3] = 0; }
  }

  // 用一张离屏画布放大绘制（比逐格 fillRect 快两个数量级）
  if (!el.__cv) { el.__cv = document.createElement('canvas'); el.__cv.width = W; el.__cv.height = H; }
  el.__cv.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(el.__cv, 0, 0, W, H, 0, 0, w, h);

  // 收得足够紧之后，把骨架本身画成笔画（收尾的"揭示"）
  if (p > 0.86) {
    const a = clamp01((p - 0.86) / 0.14);
    const X = (u) => (u / ASPECT) * w, Y = (v) => v * h;
    segs.forEach(([s1, s2], i) => {
      const local = clamp01(a * 3 - i);
      if (local <= 0) return;
      const head = ink.line(ctx, [X(s1[0]), Y(s1[1])], [X(s2[0]), Y(s2[1])], local, { color: pal.ink, width: 4, glow: 10 });
      if (local < 1) ink.nib(ctx, head, pal.ink, 4.5);
    });
    ink.label(ctx, '距离场 = 每个像素到最近笔画的最近距离', 12, 18, { color: pal.muted });
  } else {
    ink.label(ctx, `等值线 level = ${base.toFixed(2)}`, 12, 18, { color: pal.muted });
  }
}

/** CASE 4-A：有先后关系 → 逐笔（4 步构造） */
function drawPipeline(ctx, t, el, api) {
  const { w, h, ink, palette: pal } = api;
  const p = api.state.p;
  const box = (cx, cy, bw, bh, color, label, local) => {
    if (local <= 0) return;
    ctx.save(); ctx.globalAlpha = local; ctx.strokeStyle = color; ctx.lineWidth = 2.2;
    ctx.strokeRect(cx - bw / 2, cy - bh / 2, bw, bh);
    ink.label(ctx, label, cx, cy, { color, align: 'center', font: 'bold 12px ui-monospace, monospace' });
    ctx.restore();
  };
  const y = h * 0.5, bh = h * 0.42, bw = w * 0.19;
  const xs = [0.14, 0.38, 0.62, 0.86].map((v) => v * w);
  // 4 笔：每个方框是一笔（逐笔出现 → 依赖链看得见）
  const total = clamp01(p) * 4;
  xs.forEach((x, i) => {
    const local = clamp01(total - i);
    if (local <= 0) return;
    box(x, y, bw, bh, i === 3 ? pal.good : pal.accent, ['顶点', '光栅', '片元', '像素'][i], local);
    if (i > 0) ink.arrow(ctx, [xs[i - 1] + bw / 2, y], [x - bw / 2, y], clamp01(total - i + 0.999) > 0 ? local : 0, { color: pal.line, width: 2 });
  });
  ink.label(ctx, '有先后 → 逐笔', 10, h - 10, { color: pal.muted });
}

/** CASE 4-B：只是并列 → 一次给完 */
function drawBars(ctx, t, el, api) {
  const { w, h, ink, palette: pal } = api;
  const p = clamp01(api.state.p);
  const vals = [0.72, 0.45, 0.9, 0.3];
  const bw = w * 0.14, gap = w * 0.06, y0 = h * 0.86, maxH = h * 0.66;
  vals.forEach((v, i) => {
    const x = w * 0.1 + i * (bw + gap);
    const bh = maxH * v * p;                     // 全部同时长出来
    ctx.fillStyle = i === 2 ? pal.good : pal.line;
    ctx.fillRect(x, y0 - bh, bw, bh);
    ink.label(ctx, `${Math.round(v * 100)}`, x + bw / 2, y0 - bh - 10, { color: pal.muted, align: 'center', alpha: p });
  });
  ink.label(ctx, '只是并列 → 一次给完', 10, h - 10, { color: pal.muted });
}

/** 数字溯源：本课件的 claim 是算法结论，来源是教材/规范，而不是本机基准 */
export const PROVENANCE = [
  { claim: '曲线上的点 = 控制点逐层线性插值的结果', source: 'de Casteljau 算法；Farin, Curves and Surfaces for CAGD' },
  { claim: 'A* 每次展开 f = g + h 最小的节点，最优性与启发式可采纳性有关', source: 'Hart, Nilsson & Raphael (1968), A Formal Basis for the Heuristic Determination of Minimum Cost Paths' },
  { claim: '距离场可用单一标量表示字形，并从同一份数据导出描边/阴影/抗锯齿', source: 'Green, Improved Alpha-Tested Magnification for Vector Textures and Special Effects (SIGGRAPH 2007)' },
  { claim: '本机渲染数据（instancing / bind group 开销）', source: 'webgpu/bench/results/canonical-full-suite.json（同机实测）' },
];

export default deck;
