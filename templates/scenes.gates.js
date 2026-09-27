/**
 * templates/scenes.gates.js — 演示课件：门禁纪律
 *
 * 这份课件是**新能力的验收样本**，每一幕都刻意用上一条这一轮新加的门禁：
 *
 *   meta.oneLine / beat        叙事结构（第 1 幕就声明 hook，第 4 幕是 boundary）
 *   quiz.at                    第 1 幕把预测题放在幕中间 —— 先问后讲，答案在题之后
 *   draw {from,to} + hold      第 3 幕分三段画 11 个用例，段间留可重读的停顿
 *   spotlight / dim            每条旁白都配一次焦点（G16）
 *   boundary 幕                第 4 幕专门讲"门禁什么时候会误报"
 *
 * 数字全部来自本仓库自身，可复核：
 *   31 项门禁   → grep -oE "add\('([A-Za-z0-9]+)'" scripts/verify.mjs | sort -u | wc -l
 *   11 个负向用例 → grep -c "    name: '" scripts/gate-selftest.mjs
 *   G15d 三次迭代 → references/design-notes.md §5
 */

/** 11 个负向用例：一格一个。用 ink.path 逐格画，所以 G9b/G10 有真实笔画可量。 */
function drawCaseGrid(ctx, t, el, api) {
  const { w, h } = api;
  const D = api.data;                       // ← 必须真的读 data，否则 G11 判它是装饰
  const names = D.cases;
  const COLS = 6;
  const pad = 12, gap = 9;
  const cw = (w - pad * 2 - gap * (COLS - 1)) / COLS;
  const rows = Math.ceil(names.length / COLS);
  const chh = (h - pad * 2 - gap * (rows - 1)) / rows;
  const p = api.state.p;                    // ← 分段 draw 的进度
  const n = names.length;

  ctx.save();
  names.forEach((name, i) => {
    const col = i % COLS, row = Math.floor(i / COLS);
    const x0 = pad + col * (cw + gap);
    const y0 = pad + row * (chh + gap);
    const x1 = x0 + cw, y1 = y0 + chh;
    // 每格只在自己的那一段里生长 —— 同时生长的笔画数 ≤ 2，过得了 G9b
    const lp = Math.max(0, Math.min(1, (p * n - i) / 0.7));
    if (lp <= 0.001) return;
    const done = lp >= 0.999;
    const col1 = done ? api.palette.good : api.palette.line;

    const inset = 3;
    const a = [x0 + inset, y0 + inset], b = [x1 - inset, y0 + inset];
    const c = [x1 - inset, y1 - inset], d = [x0 + inset, y1 - inset];
    // 一个闭合方框 = 4 条边的折线，按弧长"按笔画出来"
    ink_rect(ctx, api, [a, b, c, d, a], lp, done, col1);

    if (done) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = api.palette.good;
      ctx.font = '600 15px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✓', (x0 + x1) / 2, (y0 + y1) / 2);
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = api.palette.muted;
      ctx.font = '10px ui-monospace, monospace';
      ctx.textBaseline = 'top';
      ctx.fillText(String(i + 1).padStart(2, '0'), (x0 + x1) / 2, y1 + 3);
    }
  });
  ctx.restore();
}

function ink_rect(ctx, api, pts, lp, done, color) {
  const ink = api.ink;
  const tint = done ? color : api.palette['accent-2'];
  // ink.path 的返回值就是笔尖 —— 交给 nib 画"正在写的这一笔"
  const head = ink.path(ctx, pts, lp, { color: tint, width: done ? 2.2 : 1.8, alpha: done ? 1 : 0.55 });
  if (lp > 0.002 && lp < 0.998) ink.nib(ctx, head, tint, 3, 1);
}

export const deck = {
  meta: {
    title: '一个不会失败的门禁不是门禁',
    theme: 'ink',
    oneLine: '正向测试全绿只证明门禁没坏 —— 证明不了它抓得住东西。',
  },
  scenes: [
    // ---------------------------------------------------------------- 01 hook
    {
      id: 'hook',
      title: '31 项门禁，全绿',
      duration: 16,
      beat: 'hook',
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '门禁纪律 · 1 / 5', x: 6, y: 5, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '31 项门禁，全绿', x: 6, y: 10, w: 70, size: 42 },
        { id: 'm1', group: 'row', type: 'metric', value: 0, label: '门禁项数', tone: 'accent', x: 6, y: 44, w: 22, decimals: 0 },
        { id: 'm2', group: 'row', type: 'metric', value: 0, label: '课件数', tone: 'good', x: 32, y: 44, w: 22, decimals: 0 },
        { id: 's', group: 'body', type: 'text', role: 'body', text: '7 份课件 × 31 项门禁 —— CI 全绿。', x: 6, w: 68, size: 19, below: 'm1', gap: 4 },
        { id: 'q', group: 'concl', type: 'text', role: 'quote', text: '全绿只说明「没坏」，不说明「抓得住」。', x: 6, w: 78, size: 26, below: 's', gap: 2.4 },
      ],
      beats: [
        { at: 0.2, action: 'reveal', target: 'k', dur: 0.4 },
        { at: 0.5, action: 'reveal', target: 't', dur: 0.6 },
        { at: 1.0, action: 'reveal', target: 'm1', dur: 0.4 },
        { at: 1.1, action: 'countUp', target: 'm1', from: 0, to: 31, dur: 1.2 },
        { at: 1.0, action: 'spotlight', target: 'm1', dur: 0.4 },
        { at: 2.4, action: 'reveal', target: 'm2', dur: 0.4 },
        { at: 2.5, action: 'countUp', target: 'm2', from: 0, to: 7, dur: 1.0 },
        { at: 3.6, action: 'reveal', target: 's', dur: 0.5 },
        { at: 3.6, action: 'spotlight', target: 's', dur: 0.4 },
        { at: 3.6, action: 'dim', target: 'm1', dur: 0.4 },
        { at: 0.4, action: 'speak', text: '三十一项门禁，七份课件，CI 全绿。' },
        { at: 4.2, action: 'speak', text: '这份报告看上去很漂亮。但是它什么都没证明。' },
        // ↓ 先问后讲：答案在题之后
        { at: 8.6, action: 'reveal', target: 'q', dur: 0.6 },
        { at: 8.6, action: 'spotlight', target: 'q', dur: 0.5 },
        { at: 8.6, action: 'dim', target: 's', dur: 0.5 },
        { at: 9.2, action: 'speak', text: '全绿只说明门禁没坏。它证明不了门禁抓得住东西。' },
      ],
      quiz: {
        at: 8.0,
        q: '如果把 G14 的判据改成「永远返回 true」（等于没查），7 份课件还会全绿吗？',
        opts: [
          { t: '不会，肯定有课件会红', ok: false, why: '7 份课件里没有一份是靠 G14 才通过的 —— 它们本来就排得开。判据写空，照样全绿。' },
          { t: '会，全绿 —— 因为正向测试根本没碰到这条判据', ok: true, why: '对。正向测试只能证明「在我这份数据上没报错」，证明不了「判据真的在判断」。' },
          { t: '取决于把判据改成什么', ok: false, why: '不用取决于 —— 「7 份课件全绿」这个事实，对 G14 的判据内容完全不敏感。这正是问题所在。' },
        ],
      },
    },

    // ---------------------------------------------------------------- 02 problem
    {
      id: 'problem',
      title: '判据写空，测试还是绿的',
      duration: 15,
      beat: 'problem',
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '门禁纪律 · 2 / 5', x: 6, y: 5, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '三种「等于没查」的写法', x: 6, y: 10, w: 76, size: 36 },
        { id: 'l', group: 'mech', type: 'list', x: 6, w: 78, below: 't', gap: 3.4, items: [
          { badge: '1', text: "add('G14', true, …) —— 断言直接写死 true，判据函数根本没被调用" },
          { badge: '2', text: 'catch {} —— 异常被吞掉，报错走不到 add() 那一行' },
          { badge: '3', text: '阈值放到 1e9 —— 条件永远不成立，代码看着像在查，其实不会触发' },
        ] },
        { id: 'q', group: 'concl', type: 'text', role: 'quote', text: '三种写法，7 份课件都会全绿。', x: 6, w: 78, size: 22, below: 'l', gap: 3 },
      ],
      beats: [
        { at: 0.2, action: 'reveal', target: 'k', dur: 0.4 },
        { at: 0.5, action: 'reveal', target: 't', dur: 0.6 },
        { at: 0.5, action: 'spotlight', target: 't', dur: 0.4 },
        { at: 1.2, action: 'reveal', target: 'l', dur: 0.8 },
        { at: 1.4, action: 'speak', text: '第一种：断言直接写死真。判据函数根本没被调用。' },
        { at: 4.6, action: 'speak', text: '第二种：异常被吞掉。报错根本走不到断言那一行。' },
        { at: 8.0, action: 'reveal', target: 'q', dur: 0.6 },
        { at: 8.0, action: 'spotlight', target: 'q', dur: 0.5 },
        { at: 8.0, action: 'dim', target: 't', dur: 0.5 },
        { at: 8.4, action: 'speak', text: '三种写法，七份课件都会全绿。门禁就成了摆设。' },
      ],
    },

    // ---------------------------------------------------------------- 03 mechanism
    {
      id: 'mechanism',
      title: '造一份坏课件，要求它必须报红',
      duration: 23,
      beat: 'mechanism',
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '门禁纪律 · 3 / 5', x: 6, y: 4, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '造一份坏课件，要求它必须报红', x: 6, y: 9, w: 84, size: 34 },
        { id: 'c', group: 'canvas', type: 'canvas2d', x: 6, y: 22, w: 88, h: 46, monotonic: true,
          draw: drawCaseGrid, data: { cases: [
            'overlap', 'box-overflow', 'bad-image', 'decorative-canvas', 'discontinuous-scalar', 'nondeterminism',
            'css-transition', 'no-signal', 'orphan-element', 'no-beat', 'quiz-gives-answer',
          ] } },
        { id: 'n', group: 'note', type: 'text', role: 'body',
          text: '11 个用例，每个只坏一处，要求指定的门禁报 ✗。造完即删 —— 所以它们不会被提交，也就不会腐烂。',
          x: 6, w: 88, size: 15, below: 'c', gap: 2 },
      ],
      beats: [
        { at: 0.2, action: 'reveal', target: ['k', 't'], dur: 0.5 },
        { at: 1.0, action: 'reveal', target: 'c', dur: 0.4 },
        // 分三段画 + 段间 hold：一口气画 20 秒，观众没有一帧可以指着说"就这儿"
        { at: 1.4, action: 'draw', target: 'c', from: 0, to: 0.34, dur: 5.0, ease: 'linear' },
        { at: 1.4, action: 'spotlight', target: 'c', dur: 0.4 },
        { at: 7.2, action: 'hold', target: 'c', dur: 1.6 },
        { at: 9.4, action: 'draw', target: 'c', from: 0.34, to: 0.67, dur: 5.0, ease: 'linear' },
        { at: 15.2, action: 'hold', target: 'c', dur: 1.6 },
        { at: 17.4, action: 'draw', target: 'c', from: 0.67, to: 1, dur: 5.0, ease: 'linear' },
        { at: 1.6, action: 'speak', text: '做法是造一份故意写坏的课件，要求指定的门禁必须报红。' },
        { at: 7.4, action: 'speak', text: '比如两个元素叠在一起，第十四条必须报交集。' },
        { at: 10.0, action: 'speak', text: '比如图片路径指向不存在的文件，第十三条必须报没加载成功。' },
        { at: 15.4, action: 'speak', text: '比如画布声明了数据、画法却把坐标写死，第十一条必须认出这是装饰。' },
        { at: 18.0, action: 'speak', text: '十一个用例，全部按预期报红。' },
        { at: 20.6, action: 'reveal', target: 'n', dur: 0.5 },
        { at: 20.6, action: 'spotlight', target: 'n', dur: 0.4 },
        { at: 20.6, action: 'dim', target: 'c', dur: 0.4 },
      ],
    },

    // ---------------------------------------------------------------- 04 boundary
    {
      id: 'boundary',
      title: '门禁也会误报',
      duration: 17,
      beat: 'boundary',
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '门禁纪律 · 4 / 5', x: 6, y: 5, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '但判据太粗，门禁会误报', x: 6, y: 10, w: 78, size: 36 },
        { id: 'l', group: 'mech', type: 'list', x: 6, w: 84, below: 't', gap: 3.2, items: [
          { badge: '①', text: '「分段标量单调不减」→ 误报一处故意的 64 → 1（"两万次调用减到一次"本身就是递减）' },
          { badge: '②', text: '「步长不超过声明速率」→ 误报 ease(out) 的初始斜率（它本来就有线性的三倍）' },
          { badge: '③', text: '「每段的端点接得上」→ 才既不误报、又真的抓得住断开的动画' },
        ] },
        { id: 'q', group: 'concl', type: 'text', role: 'quote', text: '误报最大的代价不是吵 —— 是把作者训练成忽略门禁。', x: 6, w: 80, size: 24, below: 'l', gap: 3 },
      ],
      beats: [
        { at: 0.2, action: 'reveal', target: ['k', 't'], dur: 0.5 },
        { at: 0.4, action: 'spotlight', target: 't', dur: 0.4 },
        { at: 1.0, action: 'reveal', target: 'l', dur: 0.8 },
        { at: 1.2, action: 'speak', text: '第一条判据是「单调不减」，结果误报了一处故意的递减。' },
        { at: 6.4, action: 'speak', text: '第二条改成「步长不超过声明速率」，又误报了缓动函数的初始斜率。' },
        { at: 11.6, action: 'reveal', target: 'q', dur: 0.6 },
        { at: 11.6, action: 'spotlight', target: 'q', dur: 0.5 },
        { at: 11.6, action: 'dim', target: 't', dur: 0.5 },
        { at: 12.0, action: 'speak', text: '第三版看端点接不接得上，才既不误报又抓得住。' },
      ],
    },

    // ---------------------------------------------------------------- 05 payoff
    {
      id: 'payoff',
      title: '三个问题',
      duration: 19,
      beat: 'payoff',
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '门禁纪律 · 5 / 5', x: 6, y: 5, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '三个问题，判断一条门禁有没有用', x: 6, y: 10, w: 84, size: 34 },
        { id: 'l', group: 'mech', type: 'list', x: 6, w: 84, below: 't', gap: 3.2, items: [
          { badge: '问', text: '它能失败吗？—— 造一份坏课件试试。造不出坏课件，说明它没法失败' },
          { badge: '问', text: '它失败时说清了「哪里、差多少」吗？—— 只报「不一致」等于没报' },
          { badge: '问', text: '它够得着真正的路径吗？—— 够不着的路径和没测一样' },
        ] },
        { id: 'q', group: 'concl', type: 'text', role: 'quote', text: '第 6 条门禁全绿了好几个月，而题从来不会自己弹出来。', x: 6, w: 82, size: 21, below: 'l', gap: 3 },
      ],
      beats: [
        { at: 0.2, action: 'reveal', target: ['k', 't'], dur: 0.5 },
        { at: 0.4, action: 'spotlight', target: 't', dur: 0.4 },
        { at: 1.0, action: 'reveal', target: 'l', dur: 0.8 },
        { at: 1.2, action: 'speak', text: '第一问：它能失败吗。造不出坏课件，就说明它没法失败。' },
        { at: 6.2, action: 'speak', text: '第二问：失败时说清了哪里、差多少。只报不一致等于没报。' },
        { at: 11.0, action: 'reveal', target: 'q', dur: 0.6 },
        { at: 11.0, action: 'spotlight', target: 'q', dur: 0.5 },
        { at: 11.0, action: 'dim', target: 't', dur: 0.5 },
        { at: 11.4, action: 'speak', text: '第三问：它够得着真正的路径吗。够不着，就和没测一样。' },
      ],
    },
  ],
};

export const PROVENANCE = [
  { claim: '31 项门禁', source: "grep -oE \"add\\('([A-Za-z0-9]+)'\" scripts/verify.mjs | sort -u | wc -l → 31" },
  { claim: '11 个负向用例', source: "grep -c \"    name: '\" scripts/gate-selftest.mjs → 11" },
  { claim: 'G15d 判据迭代三次（单调不减 → 步长 → 端点）', source: 'references/design-notes.md#5-教学法门禁把-mayer-的六条原则变成断言' },
];
export default deck;
