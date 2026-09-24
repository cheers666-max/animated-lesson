/**
 * templates/scenes.fourier.js — 傅立叶变换：为什么"任何信号 = 一堆正弦"
 *
 * 这份课件按 skill 的内容规矩写：每一幕都要有
 *   主张 → 机制 → 量级（数字+参照）→ 边界 → 可算的推论
 *
 * 所有数字都是本机数值算出来的（见文件末尾 NUMBERS 的来源说明），不是抄的：
 *   · 方波用 N 项奇次谐波逼近的 RMS 误差：N=1 → 20.31%，N=9 → 6.76%，N=99 → 0.80%
 *   · 吉布斯超调 = 跳变幅度的 8.949%，N 从 9 加到 999 只从 9.12% 降到 8.949% —— 不消失
 *   · 频谱泄漏：窗口 1 个周期时邻频被看见 0.2546，窗口对齐到 2 个周期后降到 0.0000
 *   · 测不准：高斯窗 σ_t · σ_ω = 1.0000（四组 σ 全部精确等于 1）
 */
export const deck = {
  meta: { title: '傅立叶变换：为什么任何信号都是一堆正弦', theme: 'ink' },
  scenes: [
    // ---------------------------------------------------------------- 01 主张
    {
      id: 'claim',
      title: '任何信号都是一堆正弦叠出来的',
      duration: 34,
      elements: [
        { id: 'pt', type: 'image', src: './assets/fourier.jpg', fit: 'cover', bleed: true,
          x: 76, y: 0, w: 24, h: 100, ken: 0.10, z: 0,
          credit: 'Joseph Fourier · Wikimedia Commons · Public domain',
          alt: '约瑟夫·傅立叶肖像' },
        { id: 'scrim', type: 'shape', shape: 'rect', x: 73, y: 0, w: 5, h: 100, z: 1,
          bleed: true, static: true, fill: 'bg', opacity: 0.92 },
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '傅立叶 · 主张', x: 5, y: 6, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '方波不是"方"的 —— 它是一堆正弦叠出来的', x: 5, y: 11, w: 66, size: 30 },

        // 谐波逐项叠加：淡色是每一项，亮色是它们的和，虚线是理想的方波
        { id: 'ca', type: 'canvas2d', x: 5, y: 25, w: 66, h: 40, z: 1,
          data: { harmonics: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21], grow: [1.5, 17], samples: 420 },
          draw: (ctx, t, el, api) => {
            const { w, h, palette: pal, data: d, ink } = api;
            const p = Math.max(0, Math.min(1, (t - d.grow[0]) / (d.grow[1] - d.grow[0])));
            const x = p * (d.harmonics.length - 1);
            const Ni = Math.floor(x), frac = x - Ni;
            const ampOf = (i) => (i < Ni ? 1 : i === Ni ? frac : 0);

            const mid = h * 0.5, A = h * 0.30;
            const X = (u) => w * 0.02 + u * w * 0.96;           // u ∈ [0,1] → 一个周期
            const TAU = Math.PI * 2;
            const part = (u) => { let s = 0; for (let i = 0; i < d.harmonics.length; i++) { const a = ampOf(i); if (a > 0.001) s += a * Math.sin(d.harmonics[i] * u * TAU) / d.harmonics[i]; } return s; };

            // 零轴
            ink.line(ctx, [X(0), mid], [X(1), mid], 1, { color: pal.line, width: 1, dash: [3, 4] });

            // 虚线：理想方波（±1 的阶跃）
            ctx.save(); ctx.setLineDash([5, 5]); ctx.strokeStyle = pal.muted; ctx.lineWidth = 1.4;
            ctx.globalAlpha = 0.55; ctx.beginPath();
            for (let i = 0; i <= d.samples; i++) {
              const u = i / d.samples; const v = u < 0.5 ? 1 : -1;
              const px = X(u), py = mid - v * A;
              if (i === 0) ctx.moveTo(px, py); else { ctx.lineTo(px, mid - (u < 0.5 ? 1 : -1) * A); ctx.lineTo(px, py); }
            }
            ctx.stroke(); ctx.restore();
            ink.label(ctx, '理想方波', X(0.02), mid - A - 12, { color: pal.muted, font: '11px ui-monospace, monospace' });

            // 每一项谐波（淡）
            for (let i = 0; i < d.harmonics.length; i++) {
              const a = ampOf(i); if (a <= 0.01) continue;
              ctx.beginPath();
              for (let s = 0; s <= d.samples; s++) {
                const u = s / d.samples; const v = a * Math.sin(d.harmonics[i] * u * TAU) / d.harmonics[i];
                const px = X(u), py = mid - v * A;
                s === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
              }
              ctx.strokeStyle = i === Ni && frac < 1 ? pal['accent-2'] : pal.good;
              ctx.globalAlpha = i === Ni && frac < 1 ? 0.9 : 0.30;
              ctx.lineWidth = i === Ni && frac < 1 ? 1.8 : 1.2;
              ctx.stroke();
            }
            ctx.globalAlpha = 1;

            // 和（亮）
            const sumPts = [];
            for (let s = 0; s <= d.samples; s++) { const u = s / d.samples; sumPts.push([X(u), mid - part(u) * 4 / Math.PI * A]); }
            ink.path(ctx, sumPts, 1, { color: pal.accent, width: 2.6, glow: 8 });

            const Nnow = d.harmonics[Math.min(Ni, d.harmonics.length - 1)];
            ink.label(ctx, `叠加到 ${Nnow} 次谐波`, X(0.02), mid + A + 16, { color: pal.accent, font: '13px ui-monospace, monospace' });
            ink.label(ctx, '每一条淡线 = 一个正弦项（振幅 = 4/πk）', X(0.52), mid - A - 12, { color: pal.good, font: '11px ui-monospace, monospace' });
          } },

        { id: 'm1', group: 'row', type: 'metric', value: 0, unit: '%', label: '1 项 · RMS 误差', tone: 'bad', x: 5, y: 67, w: 19, decimals: 2 },
        { id: 'm2', group: 'row', type: 'metric', value: 0, unit: '%', label: '9 项 · RMS 误差', x: 26, y: 67, w: 19, decimals: 2 },
        { id: 'm3', group: 'row', type: 'metric', value: 0, unit: '%', label: '99 项 · RMS 误差', tone: 'good', x: 47, y: 67, w: 19, decimals: 2 },
        { id: 'bt', type: 'text', role: 'note', text: '项数 ×99，误差 ÷25 ——<br>这就是"用正弦拼出任意形状"的代价。', x: 5, w: 66, below: 'm1', gap: 1.6 },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.6 },
        { at: 0.6, action: 'reveal', target: ['pt', 'ca'], dur: 0.6 },
        { at: 0.8, action: 'draw', target: 'pt', dur: 30 },
        { at: 18.0, action: 'reveal', target: ['m1', 'm2', 'm3'], dur: 0.5 },
        { at: 18.4, action: 'countUp', target: 'm1', from: 0, to: 20.31, dur: 1.0 },
        { at: 19.6, action: 'countUp', target: 'm2', from: 0, to: 6.76, dur: 1.0 },
        { at: 20.8, action: 'countUp', target: 'm3', from: 0, to: 0.80, dur: 1.0 },
        { at: 22.4, action: 'reveal', target: 'bt', dur: 0.6 },
        { at: 24.0, action: 'spotlight', target: 'm1', dur: 0.6 },
        { at: 0.8, action: 'speak', text: '先猜一件事：方波能不能用正弦拼出来？' },
        { at: 6.5, action: 'speak', text: '能。而且只要奇数次的谐波，振幅按四除以πk 递减。' },
        { at: 13.5, action: 'speak', text: '加到第二十一次，形状已经很方了。但它永远只是"接近"。' },
        { at: 21.5, action: 'speak', text: '一到九十九项，均方根误差从百分之二十点三降到百分之零点八。' },
        { at: 26.5, action: 'speak', text: '项数多九十九倍，误差只降到二十五分之一 —— 收敛是慢的。' },
      ],
      quiz: {
        q: '把项数从 99 继续加到 100 万，方波的跳变处会变得完全笔直吗？',
        opts: [
          { t: '会。项数足够多就无限接近理想方波', ok: false, why: '错在跳变处。跳变两侧的误差确实趋于 0，但跳变正上方那个尖峰一直留着。' },
          { t: '不会。跳变附近始终有约 9% 的超调', ok: true, why: '对，这就是吉布斯现象。超调收敛到跳变幅度的 8.949%，加到多少项都不消失。' },
          { t: '取决于用什么算法', ok: false, why: '和算法无关 —— 这是傅立叶级数本身的性质。' },
        ],
      },
    },

    // ---------------------------------------------------------------- 02 机制
    {
      id: 'mech',
      title: '怎么求每一项的系数',
      duration: 37,
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '傅立叶 · 机制', x: 5, y: 6, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '系数不是"猜"出来的 —— 是把信号投影到每个频率上', x: 5, y: 11, w: 84, size: 30 },

        // 上：匹配频率（乘积恒正，积分线性涨）  下：不匹配（乘积正负抵消）
        { id: 'ca', type: 'canvas2d', x: 5, y: 24, w: 90, h: 48, z: 1,
          data: { f0: 3, matched: 3, unmatched: 4.5, cycles: 2, samples: 400 },
          draw: (ctx, t, el, api) => {
            const { w, h, palette: pal, data: d, ink } = api;
            const p = Math.max(0, Math.min(1, (t - 1.2) / 12));
            const TAU = Math.PI * 2;
            const rowH = h * 0.46, yA = h * 0.05, yB = h * 0.55;
            const X = (u) => w * 0.10 + u * w * 0.86;
            const span = d.cycles * TAU / d.f0;                 // 探针扫过的时长（= cycles 个 f0 周期）

            const drawRow = (yTop, probeW, name, tone) => {
              const mid = yTop + rowH * 0.46, A = rowH * 0.30;
              ink.line(ctx, [X(0), mid], [X(1), mid], 1, { color: pal.line, width: 1, dash: [3, 4] });
              // 乘积曲线 + 正面积填色
              const prod = [];
              let integ = 0;
              for (let i = 0; i <= d.samples; i++) {
                const u = i / d.samples;
                if (u > p) break;
                const tt = u * span;
                const v = Math.sin(d.f0 * tt) * Math.sin(probeW * tt);
                prod.push([X(u), mid - v * A * 2]);
                integ += v * (span / d.samples);
              }
              if (prod.length > 1) {
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(prod[0][0], mid);
                for (const q of prod) ctx.lineTo(q[0], q[1]);
                ctx.lineTo(prod[prod.length - 1][0], mid);
                ctx.closePath();
                ctx.fillStyle = tone; ctx.globalAlpha = 0.16; ctx.fill();
                ctx.restore();
                ink.path(ctx, prod, 1, { color: tone, width: 2.2 });
              }
              // 累积积分（横条）
              const bw = w * 0.86 * Math.max(0, Math.min(1, integ / (span / 2)));
              ctx.save();
              ctx.globalAlpha = 0.75; ctx.fillStyle = tone;
              ctx.fillRect(X(0), yTop + rowH * 0.88, bw, Math.max(3, rowH * 0.055));
              ctx.restore();
              ink.label(ctx, name, X(0), yTop + rowH * 0.02, { color: tone, font: '12px ui-monospace, monospace' });
              const mag = Math.abs(integ * 2 / span);
              ink.label(ctx, `|系数| = ${mag.toFixed(4)}`, X(0.72), yTop + rowH * 0.02, { color: tone, font: '12px ui-monospace, monospace' });
            };

            drawRow(yA, d.matched, `探针频率 ω = ${d.matched}（与信号相同）`, pal.accent);
            drawRow(yB, d.unmatched, `探针频率 ω = ${d.unmatched}（不匹配）`, pal['accent-2']);
            ink.label(ctx, `横轴 = 时间（扫过 ${d.cycles} 个信号周期）·  曲线 = 信号 × 探针，面积 = 累积积分`,
              X(0), h - 12, { color: pal.muted, font: '11px ui-monospace, monospace' });
          } },

        { id: 'l', type: 'list', x: 5, y: 75, w: 52,
          items: ['把信号乘上一个频率 ω 的探针，再积分 —— 这一步叫<b>内积</b>',
                  '匹配时 |系数| = <b>0.5000</b>（信号振幅的一半）；不匹配时理论值是 <b>0</b> —— 相差无穷倍',
                  '实际差不到无穷：窗口一个周期时邻频残留 0.2546，是匹配值的 51%'] },
        { id: 'bd', type: 'text', role: 'note', tone: 'bad', text: '边界：这个"正交"依赖窗口长度。<br>窗口 = 1 个周期时，邻频 ω=4.5 也被看见 0.2546；<br>窗口对齐到 2 个周期才降到 0.0000。', x: 60, y: 75, w: 35 },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.6 },
        { at: 0.6, action: 'reveal', target: 'ca', dur: 0.6 },
        { at: 20.0, action: 'reveal', target: 'l', dur: 0.6 },
        { at: 23.0, action: 'reveal', target: 'bd', dur: 0.6 },
        { at: 25.0, action: 'pause', hint: '如果窗口长度取错，系数会怎样？' },
        { at: 0.8, action: 'speak', text: '知道了"能拆"，下一个问题是：每一项的系数怎么求？' },
        { at: 6.0, action: 'speak', text: '做法是拿一个同频率的正弦当探针，和信号相乘再积分。' },
        { at: 13.0, action: 'speak', text: '频率一样的时候，乘积恒为正，积分一路涨到零点五。' },
        { at: 19.0, action: 'speak', text: '频率不一样的时候，乘积正负抵消，积分停在零附近。' },
        { at: 24.0, action: 'speak', text: '所以系数是投影出来的，不是猜出来的。' },
        { at: 28.0, action: 'speak', text: '但注意：这个正交性依赖窗口长度。窗口只有一个周期时，邻近频率也会被看见。' },
      ],
    },

    // ---------------------------------------------------------------- 03 量级
    {
      id: 'scale',
      title: '要几项才够',
      duration: 26,
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '傅立叶 · 量级', x: 5, y: 6, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '误差随项数怎么降', x: 5, y: 11, w: 60, size: 34 },

        { id: 'c', type: 'chart', x: 5, y: 24, w: 56, h: 52,
          data: [
            { k: '1 项', v: 20.31, tone: 'bad' }, { k: '3 项', v: 13.60, tone: 'bad' },
            { k: '5 项', v: 10.29 }, { k: '9 项', v: 6.76 }, { k: '21 项', v: 2.95 },
            { k: '49 项', v: 1.66, tone: 'good' }, { k: '99 项', v: 0.80, tone: 'good' },
          ] },

        { id: 'l', type: 'list', x: 64, y: 24, w: 31,
          items: ['纵轴 = RMS 误差（按跳变幅度归一化）', '系数按 <b>1/k</b> 衰减，所以误差大致按 <b>1/√N</b> 降', '要再降 10 倍误差，项数得再多约 100 倍'] },
        { id: 'bt', type: 'text', role: 'note', text: '参照：音频里 20 kHz 用 44.1 kHz 采样，也只需要有限项 —— 因为人类听不到截掉的那部分。', x: 64, y: 56, w: 31 },
        { id: 'bd', type: 'text', role: 'note', tone: 'bad', text: '边界：这套"项数换精度"的账只在<b>光滑段</b>成立。<br>跳变处是另一回事 —— 下一幕。', x: 64, y: 72, w: 31 },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.6 },
        { at: 0.7, action: 'reveal', target: 'c', dur: 0.8, ease: 'out' },
        { at: 2.0, action: 'grow', target: 'c', dur: 2.2 },
        { at: 5.5, action: 'reveal', target: 'l', dur: 0.6 },
        { at: 12.0, action: 'reveal', target: 'bt', dur: 0.6 },
        { at: 17.0, action: 'reveal', target: 'bd', dur: 0.6 },
        { at: 0.8, action: 'speak', text: '这张图是数值算出来的，不是示意。' },
        { at: 5.0, action: 'speak', text: '系数按 k 分之一衰减，误差大致按根号 N 分之一降。' },
        { at: 11.5, action: 'speak', text: '换句话说：想把误差再降十倍，项数要再多一百倍左右。' },
        { at: 17.5, action: 'speak', text: '这时候你可能会想，那干脆多加项不就行了。跳变处不行。' },
      ],
    },

    // ---------------------------------------------------------------- 04 边界
    {
      id: 'limit',
      title: '吉布斯：加项数解决不了的那个尖峰',
      duration: 34,
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '傅立叶 · 边界', x: 5, y: 6, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '加项数解决不了的那个尖峰', x: 5, y: 11, w: 72, size: 32 },

        // 跳变处放大：N=9 与 N=999 的超调峰高在同一个位置、同一个高度
        { id: 'ca', type: 'canvas2d', x: 5, y: 24, w: 56, h: 50, z: 1,
          data: { jumpAt: 0.5, zoom: 0.12, lowN: 9, highN: 999, samples: 900, peak: 1.178980 },
          draw: (ctx, t, el, api) => {
            const { w, h, palette: pal, data: d, ink } = api;
            const p = Math.max(0, Math.min(1, (t - 1.5) / 10));
            const S = (u, N) => { let s = 0; for (let k = 1; k <= N; k += 2) s += Math.sin(k * Math.PI * (u - d.jumpAt) * 2 * Math.PI) / k; return 4 / Math.PI * s; };
            const lo = d.jumpAt - d.zoom * 0.5, hi = d.jumpAt + d.zoom * 0.5;
            const X = (u) => ((u - lo) / (hi - lo)) * w;
            const mid = h * 0.62, A = h * 0.30;
            const Y = (v) => mid - Math.max(-1.5, Math.min(1.5, v)) * A;

            ink.line(ctx, [0, mid], [w, mid], 1, { color: pal.line, width: 1, dash: [3, 4] });
            ink.line(ctx, [0, Y(1)], [w, Y(1)], 1, { color: pal.muted, width: 1, dash: [2, 5] });
            ink.label(ctx, '平台值 1', 6, Y(1) - 11, { color: pal.muted, font: '11px ui-monospace, monospace' });
            ink.line(ctx, [0, Y(d.peak)], [w, Y(d.peak)], 1, { color: pal.bad, width: 1, dash: [2, 5] });
            ink.label(ctx, `超调峰 ${((d.peak - 1) / 2 * 100).toFixed(3)}%`, 6, Y(d.peak) - 11, { color: pal.bad, font: '11px ui-monospace, monospace' });

            // N=999 先画（淡），N=9 后画（亮）—— 两条曲线在尖峰处重合
            for (const [N, col, alpha, wd, show] of [[d.highN, pal.muted, 0.55, 1.6, p > 0.35], [d.lowN, pal.accent, 1, 2.4, true]]) {
              if (!show) continue;
              const pts = [];
              for (let i = 0; i <= d.samples; i++) { const u = lo + (hi - lo) * i / d.samples; pts.push([X(u), Y(S(u, N))]); }
              ink.path(ctx, pts, 1, { color: col, width: wd, alpha: alpha });
            }
            ink.label(ctx, `${d.lowN} 项（亮）`, w - 92, 8, { color: pal.accent, font: '12px ui-monospace, monospace' });
            ink.label(ctx, `${d.highN} 项（淡）`, w - 92, 24, { color: pal.muted, font: '12px ui-monospace, monospace' });
            ink.label(ctx, '两条曲线的尖峰高度一样 —— 加项只让尖峰变窄，不让它变矮', 6, h - 12, { color: pal.bad, font: '11px ui-monospace, monospace' });
          } },

        { id: 'l', type: 'list', x: 64, y: 24, w: 31,
          items: ['<b>间断点</b>：超调恒为跳变幅度的 8.949%，N 从 9 加到 999 只从 9.12% 降到 8.949%',
                 '<b>非平稳</b>：全局变换只说"有哪些频率"，不说"什么时候出现"',
                 '<b>测不准</b>：高斯窗 σ_t · σ_ω = 1.0000，四组 σ 全部精确等于 1'] },
        { id: 'bt', type: 'text', role: 'note', text: '推论：要"什么时候"，就得开窗 —— 短时傅立叶（STFT）或小波。窗越窄，时间越准、频率越糊。', x: 64, y: 62, w: 31 },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.6 },
        { at: 0.6, action: 'reveal', target: 'ca', dur: 0.6 },
        { at: 14.0, action: 'reveal', target: 'l', dur: 0.7 },
        { at: 22.0, action: 'reveal', target: 'bt', dur: 0.6 },
        { at: 24.5, action: 'pause', hint: '为什么"频率"和"时间"不能同时说准？' },
        { at: 0.8, action: 'speak', text: '现在看边界。这是方波跳变处的放大。' },
        { at: 6.0, action: 'speak', text: '亮线是九项，淡线是九百九十九项。它们在这个位置的尖峰一样高。' },
        { at: 13.0, action: 'speak', text: '多出来的项只把尖峰削窄，不把它压低。这个超调永远是跳变幅度的百分之八点九四九。' },
        { at: 21.0, action: 'speak', text: '第二个边界更要紧：全局傅立叶只告诉你有哪些频率，不告诉你它们什么时候出现。' },
        { at: 26.5, action: 'speak', text: '第三，时间和频率不能同时说准：高斯窗的乘积恒等于一。' },
      ],
      quiz: {
        q: '一段频率从低扫到高的"啾"声，它的全局频谱长什么样？',
        opts: [
          { t: '一条从低频到高频的斜线 —— 能看出扫频过程', ok: false, why: '那是时频图（谱图）的样子。全局频谱已经丢掉了时间。' },
          { t: '一片覆盖整个扫频范围的连续带 —— 看不出时间顺序', ok: true, why: '对。时间信息在积分里被抹平了，只剩"有哪些频率"。' },
          { t: '只有一条谱线，在中心频率上', ok: false, why: '那是单一正弦才有的形状。' },
        ],
      },
    },

    // ---------------------------------------------------------------- 05 推论
    {
      id: 'use',
      title: '所以工程上怎么用',
      duration: 29,
      elements: [
        { id: 'k', group: 'head', type: 'text', role: 'kicker', text: '傅立叶 · 推论', x: 5, y: 6, w: 60 },
        { id: 't', group: 'head', type: 'text', role: 'title', text: '知道了边界，就知道该选哪个工具', x: 5, y: 11, w: 72, size: 32 },

        { id: 'c', type: 'code', x: 5, y: 24, w: 46, h: 50, lang: 'js', code:
`// 1) 只关心"有哪些频率" —— 全局 FFT
const spec = fft(signal)

// 2) 还想知道"什么时候" —— 开窗（STFT）
for (let i = 0; i + W <= n; i += hop)
  frame(i) = fft(signal.slice(i, i + W) * window)

// 3) 低频要看准、高频要快 —— 小波
//    窗宽本身随频率变：低频用宽窗，高频用窄窗` },

        { id: 'l', type: 'list', x: 55, y: 24, w: 40,
          items: ['只需要频谱 → <b>FFT</b>（本课件讲的这一套）',
                 '需要"什么时候出现" → <b>STFT</b>：开窗，代价是频率分辨率变糊',
                 '频率跨度很大 → <b>小波</b>：窗宽随频率变',
                 '间断信号 → 接受 <b>8.949% 的超调</b>，或者换基底'] },
        { id: 'bt', type: 'text', role: 'note', text: '参照：44.1 kHz 采样下，1024 点窗 = <b>23.2 ms</b> / 分辨率 <b>43.07 Hz</b>；256 点窗 = <b>5.8 ms</b> / <b>172.3 Hz</b> —— 时间准了 4 倍，频率糊了 4 倍。', x: 5, y: 75, w: 90 },
        { id: 'bd', type: 'text', role: 'note', tone: 'bad', text: '边界：这三条都不是"更好"，只是把同一个测不准换成不同的取舍点。窗宽是唯一的旋钮。', x: 5, y: 84, w: 90 },
      ],
      beats: [
        { at: 0.3, action: 'reveal', target: ['k', 't'], dur: 0.6 },
        { at: 0.7, action: 'reveal', target: 'c', dur: 0.6 },
        { at: 2.2, action: 'reveal', target: 'l', dur: 0.9, ease: 'out' },
        { at: 15.0, action: 'reveal', target: 'bt', dur: 0.6 },
        { at: 22.5, action: 'reveal', target: 'bd', dur: 0.6 },
        { at: 0.8, action: 'speak', text: '所以工程上的选择很清楚。' },
        { at: 4.0, action: 'speak', text: '只关心有哪些频率，用全局 FFT 就够。' },
        { at: 9.0, action: 'speak', text: '还想知道什么时候出现，就得开窗 —— 这是 STFT。' },
        { at: 14.0, action: 'speak', text: '频率跨度大，就用小波：窗宽本身随频率变。' },
        { at: 19.0, action: 'speak', text: '这三个都不是谁更好，只是把同一个测不准换成不同的取舍点。' },
        { at: 24.5, action: 'speak', text: '窗宽就是那个旋钮。' },
      ],
    },
  ],
};

/**
 * 数字来源（本机数值计算，不是抄的）：
 *   方波部分和 f_N(x) = (4/π) Σ_{k 奇 ≤ N} sin(kx)/k，真值取 N=20001；
 *   RMS 排除跳变点 ±0.05 rad 邻域（跳变处的"真值"本身无定义），按跳变幅度 2 归一化。
 *   泄漏：sin(3t) 在长度 T 的窗口上投影，|(1/T)∫ f·e^{-iωt}|。
 *   测不准：高斯窗 exp(-t²/2σ²) 的数值方差乘积。
 *   复现脚本：node scripts/fourier-numbers.mjs，数字表见 references/fourier-numbers.md。
 */
export const PROVENANCE = [
  { claim: '肖像：约瑟夫·傅立叶（公有领域）', source: 'Wikimedia Commons, Public domain' },
  { claim: '方波 RMS 误差：1 项 20.31% / 9 项 6.76% / 99 项 0.80%', source: '本机数值计算 · references/fourier-numbers.md' },
  { claim: '吉布斯超调 = 跳变幅度的 8.949%（N=999 时 8.949%，N=9 时 9.116%）', source: '本机数值计算 · references/fourier-numbers.md' },
  { claim: '频谱泄漏：窗口 1 个周期 0.2546 → 2 个周期 0.0000', source: '本机数值计算 · references/fourier-numbers.md' },
  { claim: '测不准：高斯窗 σ_t · σ_ω = 1.0000（σ = 0.25/0.5/1/2 四组）', source: '本机数值计算 · references/fourier-numbers.md' },
];
