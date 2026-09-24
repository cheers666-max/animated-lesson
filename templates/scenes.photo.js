/**
 * templates/scenes.photo.js — 图片 / 真实照片的用法示例
 *
 * 这份课件专门回答一个问题：**PPT 的图片能力，动画课件怎么给？**
 *
 *  ① cover 裁切 + 确定性缓慢推近（ken）—— 用 state 的 p 驱动，是 t 的纯函数，
 *     所以逐帧导出不闪、拖到任意时刻都对（CSS animation 做不到这一点）
 *  ② 图片与 canvas2d 叠加：图上画笔画，讲"这张图的哪一笔"
 *  ③ credit 标在画面上，缺图有虚线占位而不是开天窗（G13 会验）
 *
 * 图片全部来自 Wikimedia Commons，许可写在 credit 里。
 *
 * ⚠️ 路径基准：image 的 src 是相对 **deck.html** 的，不是相对本文件。
 *    deck.html 在 templates/ 下，所以 './assets/x.jpg' = templates/assets/x.jpg。
 *    （踩过：资源放在仓库根的 assets/ 时，两张图全部 404，G13 直接报红。）
 */
export const deck = {
  meta: { title: '图片与照片：把静态素材讲成过程', theme: 'ink' },
  scenes: [
    {
      id: 'cover',
      title: '一张照片能讲什么',
      duration: 23,
      elements: [
        // 满幅照片 + 缓慢推近：ken 是"推近幅度"，由 draw 动作把 p 从 0 推到 1
        { id: 'ph', type: 'image', src: './assets/brush.jpg', fit: 'cover', bleed: true,
          x: 52, y: 0, w: 48, h: 100, ken: 0.14, z: 0,
          credit: 'Elstner Hilton, 1911 · Wikimedia Commons · CC BY 2.0',
          alt: '执笔写字的手' },
        { id: 'scrim', type: 'shape', shape: 'rect', x: 48, y: 0, w: 5, h: 100, z: 1,
          bleed: true, static: true, fill: 'bg', opacity: 0.92 },
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '图片 · 与动画结合', x: 6, y: 12, w: 40 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '一张静态照片<br>只能看，不能讲', x: 6, w: 40, size: 40, below: 'k', gap: 1.4 },
        { id: 's', type: 'text', role: 'body', text: '推近、跟随、局部放大 —— 这些让照片开始承担讲解任务。<br>关键是它们必须是<b>时间的函数</b>，而不是 CSS 动画。', x: 6, w: 40, below: 't', gap: 3 },
        { id: 'm', type: 'metric', value: 0, unit: 's', label: '推近时长（确定性）', tone: 'good', x: 6, w: 26, decimals: 0, below: 's', gap: 2.6 },
        { id: 'b1', type: 'text', role: 'note', text: '静态图 0 秒 vs 推近 16 秒 ——<br>同一张照片，可讲解时间多了 16 倍。', x: 6, w: 40, below: 'm', gap: 1.6 },
        { id: 'bd', type: 'text', role: 'note', tone: 'bad', text: '边界：纯色 logo 推近 16 秒就是浪费。', x: 6, w: 40, below: 'b1', gap: 1.6 },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.6 },
        { at: 0.6, action: 'reveal', target: 'ph', dur: 0.8 },
        { at: 0.9, action: 'draw', target: 'ph', dur: 16 },        // 16 秒缓慢推近
        { at: 1.4, action: 'reveal', target: 's', dur: 0.6 },
        { at: 2.6, action: 'reveal', target: 'm', dur: 0.4 },
        { at: 2.8, action: 'countUp', target: 'm', from: 0, to: 16, dur: 1.2 },
        { at: 5.0, action: 'reveal', target: 'b1', dur: 0.6 },
        { at: 14.0, action: 'reveal', target: 'bd', dur: 0.6 },
        { at: 0.5, action: 'speak', text: '静态图片有个问题：它把所有信息同时摊开，观众不知道该看哪里。' },
        { at: 7.0, action: 'speak', text: '推近改变这件事。画面在动，眼睛就跟着动。' },
        { at: 11.0, action: 'speak', text: '但推近必须是时间的函数，否则导出的视频会闪 —— 这是门禁 G4 在管的事。' },
        { at: 15.5, action: 'speak', text: '边界：图里得有细节可看，纯色 logo 推十六秒就是浪费。' },
      ],
    },
    {
      id: 'overlay',
      title: '图上画笔画',
      duration: 24,
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '叠加 · 图片 + 画布', x: 7, y: 8, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '在一张图上，<br>把要讲的那一笔画出来', x: 7, y: 14, w: 52, size: 34 },
        { id: 'bg', type: 'image', src: './assets/bezier.png', fit: 'contain',
          x: 7, y: 34, w: 56, h: 50, z: 0,
          credit: 'Wikimedia Commons · Public domain',
          alt: '三次贝塞尔曲线' },
        // 画布与图片同位置 —— 图上标注"看这一笔"
        { id: 'ca', type: 'canvas2d', x: 7, y: 34, w: 56, h: 50, z: 2, overlapOk: true,   // 故意画在底图上
          data: { p0: [0.08, 0.82], c1: [0.30, 0.10], c2: [0.70, 0.10], p1: [0.92, 0.82], samples: 24 },
          draw: (ctx, t, el, api) => {
            const { ink, w, h, palette: pal } = api;
            const d = el.data;
            const P = (p) => [p[0] * w, p[1] * h];
            // 三条控制多边形（细虚线）
            ctx.save();
            ctx.setLineDash([3, 4]);
            ctx.strokeStyle = pal.muted;
            ctx.lineWidth = 1;
            const [A, B, C, D] = [P(d.p0), P(d.c1), P(d.c2), P(d.p1)];
            ctx.beginPath();
            ctx.moveTo(...A); ctx.lineTo(...B); ctx.lineTo(...C); ctx.lineTo(...D);
            ctx.stroke();
            ctx.restore();
            // 控制点（ink 的第一个参数永远是 ctx）
            for (const q of [B, C]) ink.dot(ctx, q[0], q[1], 0.012 * w, pal['accent-2']);
            for (const q of [A, D]) ink.dot(ctx, q[0], q[1], 0.014 * w, pal.accent);
            // 曲线逐笔画出：进度直接来自 t（纯函数，可拖可断言可出片）
            const p = api.ease(Math.min(1, Math.max(0, (t - 1.5) / 14)));
            const n = d.samples;
            const pts = [];
            for (let i = 0; i <= n; i++) {
              const u = i / n, v = 1 - u;
              pts.push([
                v * v * v * A[0] + 3 * v * v * u * B[0] + 3 * v * u * u * C[0] + u * u * u * D[0],
                v * v * v * A[1] + 3 * v * v * u * B[1] + 3 * v * u * u * C[1] + u * u * u * D[1],
              ]);
            }
            const head = ink.path(ctx, pts, p, { color: pal.accent, width: Math.max(2, w * 0.006), glow: 10 });
            if (p > 0.02) ink.nib(ctx, head, pal.accent, Math.max(2, w * 0.007));
            ink.label(ctx, '这一笔 = 3 个控制点', w * 0.06, h * 0.06, { color: pal.muted, font: '11px ui-monospace, monospace' });
          } },
        { id: 'note', type: 'text', role: 'body', text: '底图是静态的，<br>上面那一笔是画出来的 ——<br>两者共用同一条时间轴。', x: 68, y: 36, w: 26 },
        { id: 'bd', type: 'text', role: 'note', tone: 'bad', text: '边界：底图有信息密度上限 ——<br>一张图里塞超过 3 个要讲的地方，<br>逐笔反而比静态更慢。', x: 68, w: 26, below: 'note', gap: 3 },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.6 },
        { at: 0.7, action: 'reveal', target: 'bg', dur: 0.7 },
        { at: 1.2, action: 'reveal', target: 'ca', dur: 0.5 },
        { at: 2.0, action: 'reveal', target: 'note', dur: 0.6 },
        { at: 17.0, action: 'reveal', target: 'bd', dur: 0.6 },
        { at: 0.6, action: 'speak', text: '贝塞尔曲线谁都见过。但静态图上，你看不出控制点是怎么拽动曲线的。' },
        { at: 8.0, action: 'speak', text: '让曲线自己长出来，控制点和曲线的关系就变成可见的了。' },
        { at: 16.5, action: 'speak', text: '边界也在这儿：一张图里要讲超过三个地方，逐笔就不划算了。' },
      ],
      quiz: {
        q: '为什么推近效果要用「时间的函数」而不是 CSS animation？',
        opts: [
          { t: 'CSS animation 性能更差', ok: false, why: '性能不是关键 —— 关键是一致性。CSS animation 有自己的时钟，和 render(t) 不同步。' },
          { t: '因为导出视频要逐帧 seek，CSS 动画的进度取不出来', ok: true, why: '对。逐帧导出时你要能在任意 t 直接渲染出正确画面，CSS 动画做不到；而且截图断言会随机变红。' },
          { t: '只是代码风格偏好', ok: false, why: '不是风格问题 —— 它决定 G4（确定性）能不能过。' },
        ],
      },
    },
    {
      id: 'howto',
      title: '怎么用',
      duration: 18,
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '用法 · 三条', x: 8, y: 12, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '图片元素怎么写', x: 8, y: 19, w: 60, size: 40 },
        { id: 'c', type: 'code', x: 8, y: 34, w: 54, h: 46, lang: 'js', code:
`{ id: 'ph', type: 'image',
  src: './assets/brush.jpg',
  fit: 'cover',        // cover 裁切 / contain 完整
  ken: 0.14,           // 缓慢推近幅度 0~0.6
  credit: '作者 · 来源 · 许可' }

// 让它动起来：draw 把 p 从 0 推到 1
{ at: 0.9, action: 'draw', target: 'ph', dur: 16 }` },
        { id: 'l', type: 'list', x: 66, y: 34, w: 27,
          items: [
            '图片必须先解码完再截图 —— 引擎用 <b>assetsReady</b> 卡住，否则 G4 会假红',
            '<b>credit 必填</b>：版权/出处标在画面上，不是只写在交付说明里',
            '缺图不开天窗：画虚线占位框，<b>G13 直接报红</b>',
            '边界：一张图里超过 3 个要讲的地方，就该拆页，而不是靠推近硬塞',
          ] },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.6 },
        { at: 0.8, action: 'reveal', target: 'c', dur: 0.6 },
        { at: 2.0, action: 'reveal', target: 'l', dur: 0.6 },
        { at: 0.6, action: 'speak', text: '写法就这样。三个字段值得记住：fit、ken、credit。' },
        { at: 7.0, action: 'speak', text: '最容易忽略的是 credit —— 来源必须标在画面上。' },
        { at: 12.0, action: 'speak', text: '还有一条：图片没解码完不能截图，否则确定性门禁会随机变红。' },
      ],
    },
  ],
};

export const PROVENANCE = [
  { claim: '照片：执笔写字（1911）', source: 'Wikimedia Commons, Elstner Hilton, CC BY 2.0' },
  { claim: '贝塞尔曲线示意图', source: 'Wikimedia Commons, Public domain' },
  { claim: 'ken 推近用 state 的 p 驱动、不用 CSS animation', source: 'references/scene-dsl.md · G4 确定性门禁' },
];
