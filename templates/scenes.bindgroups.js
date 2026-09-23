/**
 * templates/scenes.bindgroups.js — 第二份参考课件（证明流程可复用）
 * 主题：bind group 重建的开销，以及三种缓存策略。
 * 数字全部来自 ~/Projects/webgpu 的实测（20000 个物体，canonical-full-suite.json）。
 */
export const deck = {
  meta: { title: '每帧重建 bind group 的代价', theme: 'neon' },
  scenes: [
    {
      id: 'hook',
      title: '一次 createBindGroup 值多少钱',
      duration: 18,
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: 'WEBGPU · 绑定与状态', x: 8, y: 12, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '每帧重建 20000 个<br>bind group', x: 8, y: 20, w: 62, size: 44 },
        { id: 'm1', group: 'row', type: 'metric', value: 0, unit: 'ms', label: '每帧重建 · CPU', tone: 'bad', x: 8, y: 56, w: 26, decimals: 2 },
        { id: 'm2', group: 'row', type: 'metric', value: 0, unit: 'ms', label: '缓存后 · CPU', tone: 'good', x: 40, y: 56, w: 26, decimals: 2 },
        { id: 'm3', group: 'row', type: 'metric', value: 0, unit: 'µs', label: '单个 bind group', x: 72, y: 56, w: 22, decimals: 1 },
        { id: 's', type: 'text', role: 'body', text: '实测：一次 createBindGroup ≈ 1.2µs。<br>乘上两万次，就是 24 毫秒 —— 一帧的预算只有 16 毫秒。', x: 8, y: 78, w: 62 },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.5 },
        { at: 0.8, action: 'reveal', target: ['m1', 'm2', 'm3'], dur: 0.5 },
        { at: 1.0, action: 'countUp', target: 'm1', from: 0, to: 24.36, dur: 1.6 },
        { at: 2.8, action: 'countUp', target: 'm2', from: 0, to: 2.04, dur: 1.2, ease: 'out' },
        { at: 4.2, action: 'countUp', target: 'm3', from: 0, to: 1.2, dur: 1.0 },
        { at: 5.6, action: 'reveal', target: 's', dur: 0.6 },
        { at: 6.6, action: 'spotlight', target: 'm1', dur: 0.5 },
        { at: 0.6, action: 'speak', text: '先猜：一帧里创建两万个绑定对象，要花多少时间？' },
        { at: 6.4, action: 'speak', text: '二十四毫秒。而一帧的预算是十六毫秒 —— 光是建绑定对象就超了。' },
        { at: 10.4, action: 'speak', text: '缓存之后是两点零四毫秒。差十二倍。' },
      ],
      quiz: {
        q: '一个 createBindGroup 大约 1.2 微秒。那 20000 个呢？',
        opts: [
          { t: '约 0.024 毫秒（1.2µs × 20000 太少，可忽略）', ok: false, why: '算错了：1.2µs × 20000 = 24000µs = 24ms，不是 0.024ms。' },
          { t: '约 24 毫秒 —— 已经超过一帧预算', ok: true, why: '对。微秒级的单次开销，乘上次数就变成毫秒级问题。' },
          { t: '和 GPU 性能有关，CPU 侧不用管', ok: false, why: 'bind group 创建完全发生在 CPU 侧，GPU 一点没参与。' },
        ],
      },
    },
    {
      id: 'strategies',
      title: '三种缓存策略',
      duration: 18,
      elements: [
        { id: 't', group: 'head', type: 'text', role: 'title', text: '从 24ms 到 2ms 的三步', x: 6, y: 6, w: 60, size: 30 },
        { id: 'ch', group: 'chart', type: 'chart', x: 6, y: 20, w: 42, h: 54,
          data: [
            { v: 24.36, vLabel: '24.4', k: '每帧重建', tone: 'bad' },
            { v: 3.95, vLabel: '3.95', k: '缓存' },
            { v: 3.53, vLabel: '3.53', k: '动态偏移' },
            { v: 2.04, vLabel: '2.04', k: '批量动态', tone: 'good' },
          ] },
        { id: 'l', group: 'steps', type: 'list', x: 54, y: 20, w: 42, items: [
          { badge: '1', text: '缓存：按材质/纹理分桶，绑定对象只建一次' },
          { badge: '2', text: '动态偏移：把变化的偏移塞进 uniform buffer，一个绑定复用到底' },
          { badge: '3', text: '批量动态：一次 writeBuffer 写完所有偏移，只发一次提交' },
        ] },
        { id: 'w', group: 'steps', type: 'text', role: 'body', text: '三者可叠加。第 3 步是"顺带"的 —— 反正都要写偏移，不如一次写完。', x: 54, y: 62, w: 42, size: 17 },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: 't', dur: 0.5 },
        { at: 0.7, action: 'reveal', target: 'ch', dur: 0.5 },
        { at: 0.9, action: 'grow', target: 'ch', from: 0, to: 1, dur: 1.6 },
        { at: 2.8, action: 'reveal', target: 'l', dur: 0.7 },
        { at: 4.6, action: 'reveal', target: 'w', dur: 0.6 },
        { at: 6.0, action: 'spotlight', target: 'l', dur: 0.6 },
        { at: 0.6, action: 'speak', text: '三种策略，三步走。第一步按材质分桶，绑定对象只建一次。' },
        { at: 5.6, action: 'speak', text: '第二步用动态偏移，把变化的偏移塞进 uniform buffer。' },
        { at: 10.0, action: 'speak', text: '第三步顺手把偏移一次写完，只发一次提交。三者可以叠加。' },
        { at: 14.4, action: 'speak', text: '最后落到两点零四毫秒。' },
      ],
    },
    {
      id: 'boundary',
      title: '什么时候不值得',
      duration: 16,
      elements: [
        { id: 't', group: 'head', type: 'text', role: 'title', text: '别为了 0.3ms 重构', x: 8, y: 10, w: 60, size: 32 },
        { id: 'l', group: 'list', type: 'list', x: 8, y: 28, w: 80, items: [
          { badge: '判', text: '先量：cpu/frame 与 gpu/frame 谁更接近预算 —— 24ms 是极端值，多数场景只有几十次绑定' },
          { badge: '判', text: '绑定数 < 200 时，重建开销通常在 0.3ms 以内，缓存带来的复杂度不划算' },
          { badge: '判', text: '缓存会引入"状态失效"这一整类 bug —— 收益小于 1ms 时别换' },
        ] },
        { id: 'q', group: 'list', type: 'text', role: 'quote', text: '微秒级的开销，只有在乘上"每帧 × 每对象"之后才是问题。', x: 8, y: 74, w: 76, size: 20 },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: 't', dur: 0.5 },
        { at: 0.9, action: 'reveal', target: 'l', dur: 0.8 },
        { at: 3.0, action: 'reveal', target: 'q', dur: 0.6 },
        { at: 0.6, action: 'speak', text: '但二十四毫秒是极端值。多数场景每帧只有几十次绑定。' },
        { at: 5.0, action: 'speak', text: '绑定数少于两百时，重建开销通常在零点三毫秒以内。' },
        { at: 8.6, action: 'speak', text: '缓存会引入状态失效这一整类 bug。收益不到一毫秒，别换。' },
      ],
    },
  ],
};

export const PROVENANCE = [
  { claim: '每帧重建 24.36ms / 缓存 3.95ms / 动态 3.53ms / 批量动态 2.04ms', source: 'bench/results/canonical-full-suite.json#02-bindgroups' },
  { claim: '单次 createBindGroup ≈ 1.2µs（24.36ms / 20000）', source: '由上一行数据推算' },
];
export default deck;
