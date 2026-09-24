/**
 * animated-lesson · engine/scene.js
 *
 * 一个**确定性时间轴**引擎：把「老师的讲解动作」编译成 (元素 × 时间) 的纯函数。
 *
 *   render(t) 是纯函数 —— t 是输入，不是时钟。
 *
 * 由此得到三件静态幻灯片做不到的事：
 *   1. scrub：拖动进度条 = 直接 render(t)，不需要回放
 *   2. 可断言：verify.mjs 能在任意关键帧截图、量布局、做双渲染 diff
 *   3. 可导出：逐帧截图 → ffmpeg → MP4（PPT 无法做到的"动画视频"）
 *
 * 引擎不碰 wall-clock（除了 rAF 里把 dt 累加进 t），所以同一 t 反复渲染必须逐像素相同。
 * 场景数据里若使用 Math.random / Date.now，确定性校验会失败 —— 这是设计约束，不是 bug。
 *
 * 公开接口：
 *   createDeck(spec, opts) -> Deck      // 挂载并返回控制器（opts.expose 时挂 window.DECK）
 *   validate(spec) -> {ok, errors, warnings}   // 与运行时同源的校验器（scripts/lint-scenes.mjs 复用）
 *   EASE, ACTIONS
 */

// ---------------------------------------------------------------- 缓动
const cubicOut = (p) => 1 - Math.pow(1 - p, 3);
const cubicIn = (p) => p * p * p;
export const EASE = {
  linear: (p) => p,
  out: cubicOut,
  in: cubicIn,
  inout: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  back: (p) => 1 + 2.2 * Math.pow(p - 1, 3) + 1.2 * Math.pow(p - 1, 2),
  expo: (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
};
const ease = (name, p) => (EASE[name] ?? EASE.out)(Math.max(0, Math.min(1, p)));
const clamp01 = (p) => Math.max(0, Math.min(1, p));

// ---------------------------------------------------------------- 动作目录
/**
 * 每个动作都是 (元素状态, 进度 p) => 元素状态 的纯函数。
 * 新增动作只需在这里登记 + 在 references/action-catalog.md 写明用途与反例。
 */
export const ACTIONS = {
  // 出现 / 消失
  reveal: (s, p) => { s.opacity = p; s.dy = (1 - p) * 26; },
  fadeOut: (s, p) => { s.opacity = 1 - p; },
  // 强调
  spotlight: (s, p) => { s.spot = p; },        // 自身提亮（其余由 deck 统一压暗）
  flash: (s, p) => { s.flash = Math.sin(p * Math.PI) > 0.5 ? 1 : 0; },
  dim: (s, p) => { s.dim = p; },               // 灰掉（用于"这一条不重要"）
  // 形变 / 运动
  moveTo: (s, p, b) => { s.dx += (b.dx ?? 0) * p; s.dy += (b.dy ?? 0) * p; s.scale *= 1 + ((b.scale ?? 1) - 1) * p; s.rotate += (b.rotate ?? 0) * p; },
  morph: (s, p, b) => {
    if (b.from != null && b.to != null && typeof b.to === 'number') s.value = b.from + (b.to - b.from) * p;
    else if (b.charProgress != null) s.text = b.fromText.slice(0, Math.round(b.fromText.length * p)) + (p < 1 ? '▌' : '');
  },
  // 数据长大
  countUp: (s, p, b) => { s.value = (b.from ?? 0) + ((b.to ?? 0) - (b.from ?? 0)) * p; },
  // 逐笔画出（shape / annot）
  draw: (s, p) => { s.p = p; },
  // 布局推进（柱状图/进度条用）
  grow: (s, p, b) => { s.grow = (b.from ?? 0) + ((b.to ?? 1) - (b.from ?? 0)) * p; },
  // 空动作：只提供时间点（配合 speak 做节奏控制）
  wait: () => {},
};

/** reveal 的 stagger 由 deck 展开成多个 reveal，不单独实现。 */

// ---------------------------------------------------------------- 校验器（与运行时同源）
const KNOWN_TYPES = ['text', 'shape', 'code', 'metric', 'list', 'chart', 'canvas2d', 'three', 'annot', 'image'];
const KNOWN_ACTIONS = Object.keys(ACTIONS).concat(['stagger', 'speak', 'zoomTo', 'reset', 'pause']);
const CHARS_PER_SEC = 4.6;      // 中文讲解语速（字/秒），用于时长预算
const SCENE_CAP = 60;           // 单场景硬上限（秒）
const ELEMENT_CAP = 14;         // 单场景元素上限（超了说明该拆页）

/**
 * 校验场景数据。**浏览器与 lint 脚本共用这一份**，避免"校验器与运行时不一致"这类经典事故。
 * errors 会阻止交付；warnings 需要作者解释。
 */
export function validate(spec) {
  const errors = [];
  const warnings = [];
  const E = (m) => errors.push(m);
  const W = (m) => warnings.push(m);

  if (!spec || typeof spec !== 'object') return { ok: false, errors: ['spec 不是对象'], warnings };
  if (!spec.meta?.title) W('meta.title 缺失（导出/文件名会不好认）');
  if (!Array.isArray(spec.scenes) || !spec.scenes.length) { E('scenes 为空'); return { ok: false, errors, warnings }; }

  const sceneIds = new Set();
  let total = 0;

  spec.scenes.forEach((sc, si) => {
    const at = `scenes[${si}](${sc.id ?? '?'})`;
    if (!sc.id) E(`${at}: 缺 id`);
    else if (sceneIds.has(sc.id)) E(`${at}: id 重复`);
    else sceneIds.add(sc.id);

    const dur = Number(sc.duration);
    if (!(dur > 0)) E(`${at}: duration 必须是正数秒`);
    else if (dur > SCENE_CAP) E(`${at}: duration ${dur}s 超过单场景上限 ${SCENE_CAP}s（拆成两页）`);
    total += dur || 0;

    const els = Array.isArray(sc.elements) ? sc.elements : [];
    if (!els.length) E(`${at}: 没有元素`);
    if (els.length > ELEMENT_CAP) W(`${at}: ${els.length} 个元素 > ${ELEMENT_CAP}，一页讲太多了`);

    const ids = new Set();
    for (const el of els) {
      const e = `${at}.els[${el.id ?? '?'}]`;
      if (!el.id) E(`${e}: 缺 id`);
      else if (ids.has(el.id)) E(`${e}: id 重复`);
      else ids.add(el.id);
      if (!KNOWN_TYPES.includes(el.type)) E(`${e}: 未知 type "${el.type}"`);
      if (typeof el.x !== 'number' || typeof el.y !== 'number') E(`${e}: 需要数字 x/y（百分比）`);
      if (typeof el.w !== 'number') E(`${e}: 需要数字 w（百分比）`);
      if (el.x < 0 || el.y < 0 || el.x + el.w > 100 + 1e-6) E(`${e}: 越界 x=${el.x} w=${el.w}（x+w 必须 ≤ 100）`);
      if (el.y > 100) E(`${e}: y=${el.y} 超出画面`);
      if (el.type === 'text' && !el.text) E(`${e}: text 元素缺 text`);
      if (el.type === 'code' && !el.code) {
        if (el.text) W(`${e}: code 元素建议用 code: 而不是 text:（两者都认，但 code: 才是规范字段）`);
        else E(`${e}: code 元素缺 code`);
      }
      if (el.type === 'canvas2d' && typeof el.draw !== 'function') E(`${e}: canvas2d 需要 draw(ctx, t, el, api) 函数`);
      if (el.type === 'three' && typeof el.init !== 'function') E(`${e}: three 需要 init(THREE, el, api) -> update(t, el, api)`);
      if (el.type === 'metric' && typeof el.value !== 'number') W(`${e}: metric 建议给初始 value（否则从 0 开始）`);
      if (el.bleed && ['text', 'list', 'code', 'metric'].includes(el.type)) {
        E(`${e}: bleed 只用于背景（image/shape）—— 内容元素出血会被字幕条压住`);
      }
      if (el.type === 'image') {
        if (!el.src) E(`${e}: image 需要 src`);
        if (!el.credit) E(`${e}: image 没写 credit —— 图片来源必须标出来（版权/出处），自绘的写 "自绘"`);
        if (el.fit && !['cover', 'contain'].includes(el.fit)) E(`${e}: fit 只能是 cover / contain`);
        if (el.ken != null && (typeof el.ken !== 'number' || el.ken < 0 || el.ken > 0.6)) E(`${e}: ken 是推近幅度，取 0~0.6`);
      }
    }

    const beats = Array.isArray(sc.beats) ? sc.beats : [];
    if (!beats.length) E(`${at}: 没有 beats —— 静态 PPT 不该用这个引擎`);

    const speakChars = [];
    let referenced = new Set();
    beats.forEach((b, bi) => {
      const bAt = `${at}.beats[${bi}]`;
      if (typeof b.at !== 'number' || b.at < 0) E(`${bAt}: 需要非负 at`);
      if (dur && b.at > dur) E(`${bAt}: at=${b.at}s 超过场景时长 ${dur}s（永远播不到）`);
      if (!KNOWN_ACTIONS.includes(b.action)) E(`${bAt}: 未知 action "${b.action}"`);
      if (b.action === 'pause' && !b.hint) W(`${bAt}: pause 没给 hint —— 观众会看到一个没有问题的暂停框`);
      if (b.dur != null && !(b.dur > 0)) E(`${bAt}: dur 必须为正`);
      const targets = b.target == null ? [] : Array.isArray(b.target) ? b.target : [b.target];
      for (const t of targets) {
        if (b.action === 'zoomTo' || b.action === 'reset') continue;
        if (!ids.has(t)) E(`${bAt}: target "${t}" 不存在于本场景元素`);
        referenced.add(t);
      }
      if ((b.action === 'reveal' || b.action === 'draw' || b.action === 'countUp' || b.action === 'morph'
        || b.action === 'moveTo' || b.action === 'fadeOut' || b.action === 'dim' || b.action === 'flash'
        || b.action === 'grow' || b.action === 'spotlight') && !targets.length) {
        E(`${bAt}: action "${b.action}" 需要 target`);
      }
      if (b.action === 'speak') {
        if (!b.text) E(`${bAt}: speak 需要 text`);
        else speakChars.push([b.at, b.text.length]);
      }
      if (b.action === 'morph') {
        if (b.charProgress) { if (!b.fromText) E(`${bAt}: morph.charProgress 需要 fromText`); }
        else if (typeof b.to !== 'number') E(`${bAt}: morph 需要数字 to，或 {charProgress:true, fromText}`);
      }
    });

    // 节奏预算：旁白不能超时（这是"动画讲解"最容易翻车的地方 —— 画面讲完了话还没说完）
    for (const [atS, chars] of speakChars) {
      const need = chars / CHARS_PER_SEC;
      if (atS + need > dur + 0.4) {
        E(`${at}.speak@${atS}s: 旁白 ${chars} 字需要 ${need.toFixed(1)}s，但场景只剩 ${(dur - atS).toFixed(1)}s`
          + ` —— 要么删字、要么加时长（改 duration）`);
      }
    }

    // 覆盖度：声明了却不编排的元素 = 死元素（静态贴图冒充讲解）
    const dead = [...ids].filter((id) => !referenced.has(id));
    const statics = new Set(els.filter((e) => e.static === true).map((e) => e.id));
    const deadNotMarked = dead.filter((id) => !statics.has(id));
    if (deadNotMarked.length) W(`${at}: 元素未被任何 beat 引用（如为背景请标 static:true）: ${deadNotMarked.join(', ')}`);

    // 动画性：t=0 就全可见 = 静态页
    const firstReveal = beats.find((b) => ['reveal', 'draw', 'countUp', 'morph'].includes(b.action));
    if (!firstReveal) W(`${at}: 没有任何"出现/生长"类动作，页面是静态的`);

    // 预测题
    if (sc.quiz) {
      const q = sc.quiz;
      if (!q.q) E(`${at}.quiz: 缺 q`);
      if (!Array.isArray(q.opts) || q.opts.length < 2) E(`${at}.quiz: 至少 2 个选项`);
      else {
        const ok = q.opts.filter((o) => o.ok).length;
        if (ok !== 1) E(`${at}.quiz: 必须恰好一个正确选项（当前 ${ok} 个）`);
        q.opts.forEach((o, i) => { if (!o.why) W(`${at}.quiz.opt[${i}]: 缺 why（答错时才有话可讲）`); });
      }
    }
  });

  if (total > 15 * 60) W(`全场 ${(total / 60).toFixed(1)} 分钟，超过 15 分钟 —— 考虑拆成两讲`);
  return { ok: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------- 元素渲染器
/** 设计坐标系（引擎内部统一用 1280×720） */
const DW = 1280;
const DH = 720;
const px = (pct, total) => (pct / 100) * total;

const hex = (el) => el.color || null;

function renderText(el, node, s) {
  node.className = 'el el-text';
  node.dataset.role = el.role ?? 'body';
  if (s.text != null && node.textContent !== s.text) node.textContent = s.text;
  node.style.fontSize = `${el.size ?? 26}px`;
  if (el.weight) node.style.fontWeight = String(el.weight);
  node.style.color = hex(el) || '';
  if (el.align) node.style.textAlign = el.align;
  if (el.mono) node.style.fontFamily = 'var(--mono)';
}

function renderShape(el, node, s) {
  if (!node.dataset.built) {
    node.className = 'el el-shape';
    node.dataset.tone = el.tone ?? 'line';
    const w = px(el.w, DW);
    const h = px(el.h ?? 20, DH);
    const kind = el.shape ?? 'rect';
    const paths = {
      rect: `M2,2 H${w - 2} V${h - 2} H2 Z`,
      arrow: `M2,${h / 2} H${w - 18} M${w - 18},${h / 2 - 9} L${w - 2},${h / 2} L${w - 18},${h / 2 + 9}`,
      line: `M0,${h / 2} H${w}`,
      circle: `M${w / 2},${h / 2} m${-w / 2},0 a${w / 2},${h / 2} 0 1,0 ${w},0 a${w / 2},${h / 2} 0 1,0 ${-w},0`,
      bracket: `M${w - 3},2 H3 V${h - 2} H${w - 3}`,
      brace: `M${w},0 Q0,0 ${w / 2},${h / 2} Q0,${h} ${w},${h}`,
    };
    node.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      ${el.fill ? `<path class="fill" d="${paths[kind]}"/>` : ''}
      <path class="stroke drawable" d="${paths[kind]}" style="--len:${Math.round(Math.hypot(w, h) * 1.6)}"/>
    </svg>`;
    node.dataset.built = '1';
  }
  const p = node.querySelector('.drawable');
  if (p) p.style.setProperty('--p', String(s.p ?? 1));
}

function renderAnnot(el, node, s) {
  if (!node.dataset.built) {
    node.className = 'el el-annot';
    const w = px(el.w, DW);
    const h = px(el.h ?? 14, DH);
    const kind = el.kind ?? 'circle';
    const d = kind === 'underline'
      ? `M2,${h * 0.6} C${w * 0.25},${h * 0.1} ${w * 0.6},${h * 1.1} ${w - 2},${h * 0.4}`
      : `M${w * 0.06},${h * 0.55} C${w * 0.02},${h * 0.05} ${w * 0.75},${-h * 0.18} ${w * 0.95},${h * 0.35}
         C${w * 1.08},${h * 0.85} ${w * 0.5},${h * 1.12} ${w * 0.2},${h * 0.95}`;
    node.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
        <path class="ink drawable" d="${d}" style="--len:${Math.round(w * 2.2)}"/></svg>
      ${el.text ? `<span class="tag">${el.text}</span>` : ''}`;
    node.dataset.built = '1';
  }
  const p = node.querySelector('.drawable');
  if (p) p.style.setProperty('--p', String(s.p ?? 1));
}

function renderCode(el, node, s) {
  if (!node.dataset.built) {
    node.className = 'el el-code';
    node.innerHTML = (el.code ?? el.text ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/\b(const|let|var|function|return|if|else|for|of|await|async|new|import|export|class)\b/g, '<span class="k">$1</span>')
      .replace(/(\/\/[^\n]*)/g, '<span class="c">$1</span>')
      .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="n">$1</span>');
    node.dataset.built = '1';
  }
}

function renderMetric(el, node, s) {
  if (!node.dataset.built) {
    node.className = 'el el-metric';
    node.dataset.tone = el.tone ?? 'accent';
    node.innerHTML = `<span class="n"></span>${el.unit ? `<span class="u">${el.unit}</span>` : ''}${el.label ? `<span class="l">${el.label}</span>` : ''}`;
    node.dataset.built = '1';
  }
  const v = s.value ?? el.value ?? 0;
  const dec = el.decimals ?? (Number.isInteger(el.value ?? 0) ? 0 : 1);
  node.querySelector('.n').textContent = (el.prefix ?? '') + Number(v).toFixed(dec) + (el.suffix ?? '');
}

function renderList(el, node, s) {
  if (!node.dataset.built) {
    node.className = 'el el-list';
    node.innerHTML = (el.items ?? []).map((it, i) => (typeof it === 'string'
      ? `<div class="li" data-i="${i}"><span class="b">${String(i + 1).padStart(2, '0')}</span><span>${it}</span></div>`
      : `<div class="li" data-i="${i}"><span class="b">${it.badge ?? String(i + 1).padStart(2, '0')}</span><span>${it.text}</span></div>`)).join('');
    node.dataset.built = '1';
  }
}

function renderChart(el, node, s) {
  const max = Math.max(...(el.data ?? [{ v: 1 }]).map((d) => d.v));
  if (!node.dataset.built) {
    node.className = 'el el-chart';
    node.innerHTML = `<div class="bars">${(el.data ?? []).map((d) => `
      <div class="bar" data-tone="${d.tone ?? ''}">
        <div class="v">${d.vLabel ?? d.v}</div>
        <div class="f" style="height:0%"></div>
        <div class="k">${d.k ?? ''}</div>
      </div>`).join('')}</div>`;
    node.dataset.built = '1';
  }
  const g = s.grow ?? 1;
  [...node.querySelectorAll('.bar')].forEach((bar, i) => {
    const d = (el.data ?? [])[i];
    const f = bar.querySelector('.f');
    f.style.height = `${(d.v / max) * 88 * g}%`;
    bar.querySelector('.v').style.opacity = String(g);
  });
}

/**
 * 图片。
 * 三件 PPT 必备但容易漏的事：
 *  ① 缺图不能开天窗 —— 画虚线占位框并标 data-placeholder，交付时一眼能看出哪张没拿到；
 *  ② 版权/出处必须标在画面上（credit），而不是只写在交付说明里；
 *  ③ 缓慢推近（ken）用 state 的 p 驱动 —— 是**时间的函数**，不是 CSS 动画，
 *     所以逐帧导出不会闪、拖到任意时刻都对。
 */
function renderImage(el, node, s) {
  if (!node.dataset.built) {
    node.className = 'el el-image';
    node.dataset.fit = el.fit ?? 'cover';
    const img = document.createElement('img');
    img.alt = el.alt ?? '';
    img.decoding = 'sync';
    img.addEventListener('load', () => { node.dataset.loaded = '1'; });
    img.addEventListener('error', () => {
      node.dataset.loaded = '0';
      node.dataset.placeholder = '1';
      node.innerHTML = `<div class="ph"><span>缺图</span><em>${el.placeholder ?? el.src}</em></div>`;
    });
    img.src = el.src;
    node.append(img);
    if (el.credit) {
      const c = document.createElement('span');
      c.className = 'credit';
      c.textContent = el.credit;
      node.append(c);
    }
    node.dataset.built = '1';
    (node._assets ??= []).push(new Promise((res) => {
      if (img.complete) res(img.naturalWidth > 0);
      else { img.addEventListener('load', () => res(true)); img.addEventListener('error', () => res(false)); }
    }));
  }
  const img = node.querySelector('img');
  if (!img) return;
  // 确定性缓慢推近：p 由 draw 动作推进，1 + ken*p 是 t 的纯函数
  const k = el.ken ? 1 + el.ken * ease(s.p ?? 0) : 1;
  img.style.transform = `scale(${k.toFixed(4)})`;
  const c = node.querySelector('.credit');
  if (c) c.style.opacity = String(s.opacity);
}

// ---------------------------------------------------------------- 「按笔画」工具箱
/**
 * ink —— 让「一笔一笔画出来」成为一等公民。
 *
 * 为什么值得单独做一层：静态图只能给结果，而**构造过程本身就是知识**
 * （贝塞尔的递归插值、A* 的搜索顺序、SDF 的等值线收缩）。
 * 每个函数都接受进度 p ∈ [0,1]，并返回**笔尖位置** —— 拿它在笔尖点一个小圆，
 * 就成了这个模式最直观的视觉签名：观众能看见「现在画到哪」。
 */
function makeInk() {
  const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

  /** 把折线按 step 像素加密，保证「按弧长取前 p 段」在长边上也不会跳段 */
  function densify(pts, step = 2) {
    if (pts.length < 2) return pts.map((p) => [...p]);
    const out = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const n = Math.max(1, Math.ceil(dist(pts[i], pts[i + 1]) / step));
      for (let k = 0; k < n; k++) {
        out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k / n, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k / n]);
      }
    }
    out.push([...pts[pts.length - 1]]);
    return out;
  }

  /** 按累计弧长取前 p 比例的子折线 + 笔尖 */
  function takeLength(pts, p) {
    let total = 0;
    for (let i = 0; i + 1 < pts.length; i++) total += dist(pts[i], pts[i + 1]);
    const head0 = pts[0] ?? [0, 0];
    if (!(total > 0)) return { sub: [head0], head: head0, total: 0, len: 0 };
    const want = total * Math.max(0, Math.min(1, p));
    const sub = [[...head0]];
    let walked = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const d = dist(pts[i], pts[i + 1]);
      if (walked + d <= want + 1e-9) { sub.push([...pts[i + 1]]); walked += d; }
      else {
        const r = d > 0 ? (want - walked) / d : 0;
        const h = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * r, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * r];
        sub.push(h);
        return { sub, head: h, total, len: walked + d * r };
      }
    }
    return { sub, head: pts[pts.length - 1], total, len: total };
  }

  let defaultInk = () => '#5ac8fa';
  const ink = {
    // 进度记录：引擎靠它统计「同时有几笔在生长」—— 笔速可被断言
    // len = 本帧画面上"可见笔画的总长度"；cum = 本幕累计画出的长度。
    // 「按笔画」的定义性质就是 len 只增不减 —— G10 门禁量的正是它（而不是像素）。
    _stats: { calls: 0, growing: 0, last: 0, peak: 0, len: 0, cum: 0 },
    _labels: [],   // 本帧所有 ink.label 的占位盒，G2d 用它断画布内遮挡
    lerp: (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u],
    mid: (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
    dist,

    /** 折线按笔画出来。返回笔尖 [x,y]，可直接交给 nib() */
    path(ctx, pts, p, o = {}) {
      const P = Math.max(0, Math.min(1, p));
      ink._stats.calls++;
      if (P > 0.002 && P < 0.998) ink._stats.growing++;
      if (P <= 0.002 || !pts || pts.length < 2) return pts?.[0] ?? [0, 0];
      const dense = densify(pts, o.step ?? 2);
      const { sub, head, len } = takeLength(dense, P);
      ink._stats.len += len;
      ink._stats.cum += len;
      ctx.save();
      ctx.lineCap = o.cap ?? 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = o.color ?? defaultInk();
      ctx.lineWidth = o.width ?? 2.5;
      ctx.globalAlpha = o.alpha ?? 1;
      if (o.dash) ctx.setLineDash(o.dash);
      if (o.glow) { ctx.shadowColor = o.color ?? defaultInk(); ctx.shadowBlur = o.glow; }
      ctx.beginPath();
      sub.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.restore();
      return head;
    },

    /** 三次贝塞尔：按笔画出来（先采样成折线，再按弧长截取） */
    cubic(ctx, P4, p, o = {}) {
      const [a, b, c, d] = P4;
      const n = o.samples ?? 48;
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const u = i / n, v = 1 - u;
        pts.push([
          v * v * v * a[0] + 3 * v * v * u * b[0] + 3 * v * u * u * c[0] + u * u * u * d[0],
          v * v * v * a[1] + 3 * v * v * u * b[1] + 3 * v * u * u * c[1] + u * u * u * d[1],
        ]);
      }
      return ink.path(ctx, pts, p, { step: 1, ...o });
    },

    /** 二次贝塞尔 */
    quad(ctx, P3, p, o = {}) {
      const [a, b, c] = P3;
      const n = o.samples ?? 32;
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const u = i / n, v = 1 - u;
        pts.push([v * v * a[0] + 2 * v * u * b[0] + u * u * c[0], v * v * a[1] + 2 * v * u * b[1] + u * u * c[1]]);
      }
      return ink.path(ctx, pts, p, { step: 1, ...o });
    },

    /** 直线段（最常用的一笔） */
    line(ctx, a, b, p, o = {}) { return ink.path(ctx, [a, b], p, o); },

    /** 带箭头的线段：箭头只在画完之后出现 */
    arrow(ctx, a, b, p, o = {}) {
      const head = ink.line(ctx, a, b, p, o);
      if (p > 0.985) {
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const s2 = o.head ?? 9;
        ctx.save();
        ctx.strokeStyle = o.color ?? defaultInk();
        ctx.lineWidth = o.width ?? 2.5;
        ctx.lineCap = 'round';
        ctx.globalAlpha = o.alpha ?? 1;
        for (const d of [2.6, -2.6]) {
          ctx.beginPath();
          ctx.moveTo(b[0], b[1]);
          ctx.lineTo(b[0] + Math.cos(ang + d) * s2, b[1] + Math.sin(ang + d) * s2);
          ctx.stroke();
        }
        ctx.restore();
      }
      return head;
    },

    dot(ctx, x, y, r, color, alpha = 1) {
      ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = color ?? defaultInk();
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    },

    /** 空心圆环（标记「这一步算出来的点」） */
    ring(ctx, x, y, r, color, width = 2, alpha = 1) {
      ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color ?? defaultInk(); ctx.lineWidth = width;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    },

    /** 笔尖：画到哪就在哪点一个发光的小圆 —— 这个模式的招牌视觉 */
    nib(ctx, head, color, r = 4.5, alpha = 1) {
      if (!head || alpha <= 0.01) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = color ?? defaultInk(); ctx.shadowBlur = 14;
      ctx.fillStyle = color ?? defaultInk();
      ctx.beginPath(); ctx.arc(head[0], head[1], r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    },

    /** 小标签 */
    label(ctx, str, x, y, o = {}) {
      ctx.save();
      const font = o.font ?? '12px ui-monospace, monospace';
      ctx.fillStyle = o.color ?? defaultInk();
      ctx.font = font;
      ctx.textAlign = o.align ?? 'left';
      ctx.textBaseline = o.baseline ?? 'middle';
      ctx.globalAlpha = o.alpha ?? 1;
      ctx.fillText(str, x, y);
      // 记录标签的真实占位盒（measureText 精确，不是估算）。
      // 画布内最容易被作者漏掉的遮挡就是"两个标签叠在一起"，
      // 以及"标注画到了画布外被裁掉" —— 这两类都能靠这张表断出来（G2d）。
      const tw = ctx.measureText(str).width;
      const fs = parseFloat(font) || 12;
      const ax = ctx.textAlign === 'center' ? x - tw / 2 : ctx.textAlign === 'right' ? x - tw : x;
      const ay = ctx.textBaseline === 'middle' ? y - fs * 0.6 : ctx.textBaseline === 'top' ? y : y - fs;
      ink._labels.push({ text: String(str), x: ax, y: ay, w: tw, h: fs * 1.2, alpha: o.alpha ?? 1,
        cid: ink._cur?.id ?? '?', cw: ink._cur?.w ?? 0, ch: ink._cur?.h ?? 0 });
      ctx.restore();
    },
  };
  ink.setDefault = (fn) => { defaultInk = fn; };
  return ink;
}

function renderCanvas2d(el, node, s, api) {
  if (!node.dataset.built) {
    node.className = 'el el-canvas';
    const c = document.createElement('canvas');
    const w = px(el.w, DW), h = px(el.h ?? 30, DH);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    c.style.width = '100%'; c.style.height = '100%';
    node.append(c);
    node._ctx = c.getContext('2d');
    node._scale = dpr;
    node.dataset.built = '1';
  }
  const ctx = node._ctx;
  const w = px(el.w, DW), h = px(el.h ?? 30, DH);
  ctx.setTransform(node._scale, 0, 0, node._scale, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (api.ink) api.ink._cur = { id: el.id, w, h };   // 让 ink.label 记下"标签属于哪块画布、画布多大"
  // 把 t（场景内秒）、元素状态、以及**元素自带的数据**一起交给作者。
  // api.data 是"画面必须承载信息"的抓手：G11 会扰动它，断言画面必须跟着变 ——
  // 装饰性画面（坐标硬编码的比例）扰动数据后纹丝不动，会被抓住。
  el.draw(ctx, s.t, el, { ...api, w, h, state: s, data: el.data });
}

function renderThree(el, node, s, api) {
  if (!node.dataset.built) {
    node.className = 'el el-three';
    node.dataset.built = '1';
    api.three.mount(el, node, api);      // three-adapter 负责建 canvas / 降级
  }
  api.three.update(el, node, s.t, { ...api, state: s });
}

const RENDERERS = {
  text: renderText, shape: renderShape, annot: renderAnnot, code: renderCode,
  metric: renderMetric, list: renderList, chart: renderChart,
  canvas2d: renderCanvas2d, three: renderThree, image: renderImage,
};

// ---------------------------------------------------------------- 场景编译
/**
 * 把 beats 编译成「每个元素的动作序列」。之后 stateAt 只是对序列求值 —— 纯函数、零分配。
 * 同一属性后写覆盖先写（与作者书写顺序一致，可预测）。
 */
function compileScene(sc) {
  const beats = [...(sc.beats ?? [])].sort((a, b) => a.at - b.at);
  const perEl = new Map();
  const zoomBeats = [];
  const speaks = [];
  const pauses = [];
  for (const b of beats) {
    if (b.action === 'speak') { speaks.push({ at: b.at, text: b.text, dur: b.dur ?? Math.max(1.6, b.text.length / CHARS_PER_SEC) }); continue; }
    if (b.action === 'zoomTo') { zoomBeats.push(b); continue; }
    if (b.action === 'pause') { pauses.push(b); continue; }   // 交互式暂停：只在播放时触发
    if (b.action === 'stagger') {
      const targets = Array.isArray(b.target) ? b.target : [b.target];
      targets.forEach((t, i) => {
        const list = perEl.get(t) ?? [];
        list.push({ ...b, action: 'reveal', at: b.at + i * (b.step ?? 0.28), target: t });
        perEl.set(t, list);
      });
      continue;
    }
    const targets = b.target == null ? [] : Array.isArray(b.target) ? b.target : [b.target];
    for (const t of targets) {
      const list = perEl.get(t) ?? [];
      list.push({ ...b, target: t });
      perEl.set(t, list);
    }
  }
  return { beats, perEl, zoomBeats, speaks, pauses, duration: sc.duration };
}

/** 元素在场景时刻 t 的状态 —— 引擎的唯一真值来源（纯函数） */
function stateAt(compiled, el, t) {
  const s = {
    opacity: 1, dx: 0, dy: 0, scale: 1, rotate: 0, p: 1, grow: 1,
    value: el.value ?? 0, text: el.text, spot: 0, dim: 0, flash: 0, t,
  };
  for (const b of compiled.perEl.get(el.id) ?? []) {
    const dur = b.dur ?? (b.action === 'reveal' ? 0.5 : 0.6);
    const p = clamp01((t - b.at) / dur);
    if (t < b.at && (b.action === 'reveal' || b.action === 'draw' || b.action === 'countUp' || b.action === 'morph')) {
      // 还没到时间：这些动作"未发生"意味着完全不可见 / 未画出
      if (b.action === 'reveal') s.opacity = 0;
      if (b.action === 'draw') s.p = 0;
      if (b.action === 'countUp') s.value = b.from ?? 0;
      if (b.action === 'morph') s.text = el.text;
      continue;
    }
    const fn = ACTIONS[b.action];
    if (fn) fn(s, ease(b.ease ?? 'out', p), b, t);
    if (b.action === 'reveal' && t < b.at) s.opacity = 0;
  }
  return s;
}

/** 相机（zoomTo）在时刻 t 的状态 */
function cameraAt(compiled, t) {
  let cam = { k: 1, x: DW / 2, y: DH / 2 };
  for (const b of compiled.zoomBeats) {
    const dur = b.dur ?? 0.9;
    const p = clamp01((t - b.at) / dur);
    const k = 1 + ((b.scale ?? 1.6) - 1) * ease(b.ease ?? 'inout', p);
    let tx = DW / 2, ty = DH / 2;
    const targetEl = b.target ? compiled.elsById?.get(b.target) : null;
    if (targetEl) { tx = px(targetEl.x + targetEl.w / 2, DW); ty = px(targetEl.y + (targetEl.h ?? 20) / 2, DH); }
    cam = { k, x: cam.x + (tx - cam.x) * p, y: cam.y + (ty - cam.y) * p };
  }
  return cam;
}

// ---------------------------------------------------------------- Deck
export function createDeck(spec, opts = {}) {
  const report = validate(spec);
  const mountSel = opts.mount ?? '#stage';
  const root = typeof mountSel === 'string' ? document.querySelector(mountSel) : mountSel;
  if (!root) throw new Error(`mount 目标不存在: ${mountSel}`);
  if (!report.ok) console.warn('[animated-lesson] 校验未通过:\n' + report.errors.join('\n'));
  if (report.warnings.length) console.info('[animated-lesson] 提示:\n' + report.warnings.join('\n'));

  const capture = opts.capture
    ?? new URLSearchParams(location.search).get('capture') === '1';
  if (capture) (root.closest('#deck-app') ?? document.documentElement).dataset.capture = '1';

  const stage = document.createElement('div');
  stage.id = 'stage';
  // 主题挂在 app 根上，不是 #stage —— 控制条与字幕条在 #stage 外面，
  // 只挂 #stage 会出现"浅色舞台 + 深色控制条"这种半截主题。
  const themeRoot = root.closest('#deck-app') ?? document.documentElement;
  themeRoot.dataset.theme = spec.meta?.theme ?? 'ink';
  root.append(stage);

  const boot = performance.now();
  /**
   * 资源预加载 —— 这是确定性的一部分，不是优化。
   * 图片是异步加载的：如果第一帧截图时图还没到、第二帧到了，
   * G4（同一 t 双渲染逐字节相同）就会随机变红，而且这是**假回归**，
   * 会训练作者忽略这条门禁。所以：开播前把全部图片解码完，再 resolve assetsReady。
   * 缺图也算 resolve（值是 false），由 G13 去报错 —— 不能让一张图卡住整个课件。
   */
  const imageUrls = [...new Set((spec.scenes ?? []).flatMap((sc) =>
    (sc.elements ?? []).filter((e) => e.type === 'image' && e.src).map((e) => e.src)))];
  const assetsReady = Promise.all(imageUrls.map((src) => new Promise((res) => {
    const im = new Image();
    im.onload = () => res({ src, ok: im.naturalWidth > 0, w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => res({ src, ok: false, w: 0, h: 0 });
    im.src = src;
  })));

  const deck = {
    spec, report, stage, root,
    assetsReady,
    assets: [],
    index: 0, t: 0, playing: false, tGlobal: 0, frames: 0,
    scenes: [],
    // 确定性：t 只能通过 seek / tick 改变，渲染永远读 t
    seek(tInScene) { this.t = Math.max(0, Math.min(this.scene.duration, tInScene)); this.render(); },
    goScene(i, { at = 0, play = null, force = false } = {}) {
      const next = Math.max(0, Math.min(spec.scenes.length - 1, i));
      // 同一幕内跳转不重建 DOM —— 拖动进度条时每帧重建 canvas 是纯浪费
      if (force || next !== this.index || !this.compiled) this.buildScene(next);
      this.index = next;
      this.t = at;
      this.render();
      if (play != null) this.playing = play;
      this.hideQuiz();
      this.updateBar();
      spec.hooks?.onScene?.(this.index, this.scene);
    },
    play() {
      this.playing = true; this.last = performance.now();
      const n = document.getElementById('deck-pause'); if (n) n.dataset.on = '0';
      this.pauseOpen = false;
      this.updateBar();
    },
    pause() { this.playing = false; this.updateBar(); },
    toggle() { this.playing ? this.pause() : this.play(); },
    next() { this.goScene(this.index + 1, { play: this.playing }); },
    prev() { this.goScene(this.index - 1, { play: this.playing }); },
    get scene() { return spec.scenes[this.index]; },
    /** 全局时间（用于进度条 / 帧导出命名）：前面场景时长之和 + 当前 t */
    globalAt() { let g = 0; for (let i = 0; i < this.index; i++) g += spec.scenes[i].duration; return g + this.t; },
    totalDuration() { return spec.scenes.reduce((a, s) => a + s.duration, 0); },
    buildScene, render, tick, updateBar, destroy, showQuiz, hideQuiz,
    /**
     * 纯函数探针：不碰 DOM，直接算第 i 幕在 t 时刻每个元素的状态。
     * 门禁 G9（信息释放节流）靠它一次扫完一幕，不必真的渲染几百次。
     */
    probe(i, t) {
      const sc = spec.scenes[i];
      if (!probeCache.has(i)) {
        const c = compileScene(sc);
        c.elsById = new Map((sc.elements ?? []).map((e) => [e.id, e]));
        probeCache.set(i, c);
      }
      const c = probeCache.get(i);
      const out = {};
      for (const el of sc.elements ?? []) {
        const s = stateAt(c, el, t);
        out[el.id] = { opacity: +s.opacity.toFixed(4), value: +Number(s.value).toFixed(4), p: +s.p.toFixed(4), grow: +s.grow.toFixed(4), spot: s.spot, dim: s.dim };
      }
      return out;
    },
    quizAnswers: {}, quizOpen: false,
    /** 只给门禁/调试用：改掉某个 canvas2d/three 元素的数据并立刻重渲染（G11 的数据扰动测试） */
    setData(id, data) {
      const el = (deck.scene.elements ?? []).find((e) => e.id === id);
      if (!el) throw new Error(`setData: 当前幕没有元素 ${id}`);
      el.data = data;
      render();
      return true;
    },
    state: () => ({
      index: deck.index, sceneId: deck.scene.id, t: +deck.t.toFixed(3),
      global: +deck.globalAt().toFixed(3), playing: deck.playing, frames: deck.frames,
      total: deck.totalDuration(), errors: report.errors, warnings: report.warnings,
      quizOpen: !!deck.quizOpen,
      quizAnswers: { ...deck.quizAnswers },
      ink: { calls: ink._stats.calls ?? 0, growing: ink._stats.last ?? 0, peak: ink._stats.peak ?? 0, len: ink._stats.len ?? 0, cum: Math.round(ink._stats.cum ?? 0) },
      // 画布内标签盒 + 该画布的设计尺寸：让门禁能算"标签是否互相遮挡 / 是否被画布裁掉"
      labels: ink._labels.map((l) => ({ ...l, x: +l.x.toFixed(1), y: +l.y.toFixed(1), w: +l.w.toFixed(1), h: +l.h.toFixed(1) })),
    }),
  };

  // 主题调色（canvas2d / three 需要知道颜色）
  const ink = makeInk();
  const probeCache = new Map();
  const palette = {};
  function readPalette() {
    const cs = getComputedStyle(stage);
    for (const k of ['--ink', '--muted', '--line', '--accent', '--accent-2', '--good', '--bad', '--bg']) {
      palette[k.replace('--', '')] = cs.getPropertyValue(k).trim();
    }
    ink.setDefault(() => palette.accent);
  }

  // three 适配器（懒加载；不可达时自动降级为 2D，见 three-adapter.js）
  let threeApi = null;
  const api = {
    get palette() { return palette; },
    get three() { return threeApi; },
    ink,
    ease, px, DW, DH,
    spec,
  };

  // ------------------------------------------------------------ 场景 DOM
  function buildScene(i) {
    const sc = spec.scenes[i];
    const compiled = compileScene(sc);
    compiled.elsById = new Map((sc.elements ?? []).map((e) => [e.id, e]));
    ink._stats.peak = 0;
    ink._stats.cum = 0;
    compiled.nodes = new Map();
    stage.innerHTML = '';
    for (const el of sc.elements ?? []) {
      const node = document.createElement('div');
      node.dataset.el = el.id;
      node.style.left = `${el.x}%`;
      node.style.top = `${el.y}%`;
      node.style.width = `${el.w}%`;
      if (el.h != null) node.style.height = `${el.h}%`;
      if (el.z != null) node.style.zIndex = String(el.z);
      if (el.hidden) node.style.display = 'none';
      stage.append(node);
      RENDERERS[el.type]?.(el, node, { t: 0, opacity: 1, value: el.value ?? 0, p: 0, grow: 1, text: el.text }, api);
      compiled.nodes.set(el.id, node);
    }
    deck.compiled = compiled;
    deck.index = i;      // scene 是由 index 派生的 getter，不要赋值
  }

  // ------------------------------------------------------------ 渲染
  function render() {
    const sc = deck.scene;
    const compiled = deck.compiled;
    const t = deck.t;
    ink._stats.calls = 0;
    ink._stats.growing = 0;
    ink._stats.len = 0;
    ink._labels.length = 0;

    // 谁被 spotlight：本帧所有 spot>0 的元素；未被点到的压暗
    const spotSet = new Set();
    for (const el of sc.elements ?? []) {
      const s = stateAt(compiled, el, t);
      if (s.spot > 0.5) spotSet.add(el.id);
    }
    const spotting = spotSet.size > 0;

    for (const el of sc.elements ?? []) {
      const node = compiled.nodes.get(el.id);
      const s = stateAt(compiled, el, t);
      // 位置：设计坐标 → 百分比 + 动作产生的位移/缩放
      const base = `translate(${s.dx}px, ${s.dy}px) scale(${s.scale}) rotate(${s.rotate}deg)`;
      node.style.transform = base;
      node.style.opacity = String(s.opacity);
      node.dataset.dim = (spotting && !spotSet.has(el.id)) || s.dim > 0.5 ? '1' : '0';
      node.dataset.flash = s.flash > 0.5 ? '1' : '0';
      RENDERERS[el.type]?.(el, node, s, api);
    }

    // 相机
    const cam = cameraAt(compiled, t);
    const fit = fitScale();
    const dx = cam.k * (DW / 2 - cam.x);
    const dy = cam.k * (DH / 2 - cam.y);
    stage.style.transform = `scale(${fit}) translate(${dx}px, ${dy}px) scale(${cam.k})`;

    // 字幕（speak）
    const line = compiled.speaks.filter((sp) => t >= sp.at && t <= sp.at + sp.dur).pop();
    const cap = document.getElementById('deck-caption');
    if (cap) {
      cap.textContent = line?.text ?? '';
      cap.dataset.on = line ? '1' : '0';
    }
    // 场景标题
    const tag = document.getElementById('deck-tag');
    if (tag) tag.innerHTML = `<b>${String(deck.index + 1).padStart(2, '0')}</b> / ${String(spec.scenes.length).padStart(2, '0')} · ${sc.title ?? ''}`;

    // 笔速统计：本帧同时有几笔在生长（“按笔画”要被量化，才能被门禁管住）
    ink._stats.last = ink._stats.growing;
    ink._stats.peak = Math.max(ink._stats.peak ?? 0, ink._stats.last);
    ink._stats.len = Math.round(ink._stats.len);
  }

  function fitScale() {
    const vp = root.getBoundingClientRect();
    return Math.max(0.05, Math.min(vp.width / DW, vp.height / DH));
  }

  // ------------------------------------------------------------ 主循环
  function tick(now) {
    if (deck.playing) {
      const dt = Math.min(0.05, (now - (deck.last ?? now)) / 1000);
      deck.last = now;
      deck.t += dt;
      if (deck.t >= deck.scene.duration) {
        if (deck.index < spec.scenes.length - 1) deck.goScene(deck.index + 1, { play: true });
        else { deck.t = deck.scene.duration; deck.playing = false; this.showQuiz?.(); }
      }
      maybePause();
      maybeSpeak();
      render();
      updateBar();
    }
    deck.frames++;
    requestAnimationFrame(tick);
  }

  assetsReady.then((r) => { deck.assets = r; });

  /**
   * 交互式暂停：讲到关键处停下来，让观众先想。
   * 只在**播放**时触发 —— seek / 逐帧导出时 deck.playing 为 false，
   * 所以确定性渲染（G4）与出片链路完全不受影响。
   */
  const firedPauses = new Set();
  function maybePause() {
    const list = deck.compiled.pauses ?? [];
    for (const b of list) {
      const key = `${deck.index}:${b.at}`;
      if (firedPauses.has(key)) continue;
      if (deck.t < b.at) continue;
      firedPauses.add(key);
      deck.pause();
      deck.pausedAt = b.at;
      showPauseHint(b.hint ?? '想一想，再继续');
      return;
    }
  }
  function showPauseHint(text) {
    const n = document.getElementById('deck-pause');
    if (!n) return;
    n.textContent = `⏸ ${text}　（点击继续）`;
    n.dataset.on = '1';
    deck.pauseOpen = true;
  }

  // 旁白（可选）：只在播放时触发，seek 不触发 —— 保证确定性渲染不被 TTS 干扰
  let spoken = new Set();
  function maybeSpeak() {
    if (!opts.narrate || !('speechSynthesis' in window)) return;
    const key = `${deck.index}`;
    const line = deck.compiled.speaks.filter((sp) => deck.t >= sp.at && deck.t <= sp.at + 0.05).pop();
    if (line && !spoken.has(key + '@' + line.at)) {
      spoken.add(key + '@' + line.at);
      const u = new SpeechSynthesisUtterance(line.text);
      u.lang = opts.lang ?? 'zh-CN';
      u.rate = opts.rate ?? 1.05;
      speechSynthesis.speak(u);
    }
  }

  // ------------------------------------------------------------ 控制条
  function updateBar() {
    const bar = document.getElementById('deck-bar');
    if (!bar) return;
    const g = deck.globalAt(), total = deck.totalDuration();
    bar.querySelector('#deck-scrub > i').style.width = `${(g / total) * 100}%`;
    bar.querySelector('.now').textContent = `${fmt(g)} / ${fmt(total)}`;
    bar.querySelector('#deck-play').textContent = deck.playing ? '⏸ 暂停' : '▶ 播放';
    const qb = bar.querySelector('#deck-quiz');
    if (qb) qb.style.display = deck.scene.quiz ? '' : 'none';
    [...bar.querySelectorAll('.chapters button')].forEach((b, i) => b.setAttribute('aria-current', String(i === deck.index)));
  }

  // ------------------------------------------------------------ 预测题
  /**
   * 讲解课的核心手法：先让学习者下注，再揭晓。
   * 答错必须有 why —— 校验器会强制这一点，否则学习不会发生。
   */
  function showQuiz() {
    const sc = deck.scene;
    deck.pause();
    const box = document.getElementById('quiz');
    if (!box || !sc.quiz) return;
    deck.quizOpen = true;
    const answered = deck.quizAnswers[sc.id];
    box.innerHTML = '';
    box.dataset.on = '1';
    const card = document.createElement('div');
    card.className = 'card';
    card.append(Object.assign(document.createElement('div'), { className: 'q', textContent: '🤔 ' + sc.quiz.q }));
    const opts = document.createElement('div'); opts.className = 'opts';
    const why = document.createElement('div'); why.className = 'why';
    sc.quiz.opts.forEach((o, oi) => {
      const b = document.createElement('button');
      b.textContent = 'ABCD'[oi] + ' · ' + o.t;
      const reveal = () => {
        [...opts.children].forEach((x, xi) => {
          x.disabled = true;
          if (sc.quiz.opts[xi].ok) x.classList.add('right');
          else if (xi === oi) x.classList.add('wrong');
        });
        why.dataset.on = '1';
        why.textContent = (o.ok ? '✓ 猜对了。' : '✗ 和实测不符。') + o.why;
      };
      b.onclick = () => { deck.quizAnswers[sc.id] = { chosen: oi, ok: !!o.ok }; reveal(); };
      if (answered) { b.disabled = true; if (o.ok) b.classList.add('right'); }
      opts.append(b);
    });
    if (answered) { why.dataset.on = '1'; why.textContent = sc.quiz.opts[answered.chosen].why; }
    const close = document.createElement('button');
    close.textContent = '继续 →';
    close.style.marginTop = '12px';
    close.onclick = () => { hideQuiz(); if (deck.index < spec.scenes.length - 1) deck.next(); };
    card.append(opts, why, close);
    box.append(card);
    spec.hooks?.onQuiz?.(sc.id);
  }

  function hideQuiz() {
    const box = document.getElementById('quiz');
    deck.quizOpen = false;
    if (box) { box.dataset.on = '0'; box.innerHTML = ''; }
  }
  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  function destroy() {
    deck.playing = false;
    stage.remove();
    threeApi?.dispose?.();
  }

  // ------------------------------------------------------------ 启动
  (async () => {
    readPalette();
    const mod = await import('./three-adapter.js').catch(() => null);
    if (mod) threeApi = mod.createThreeAdapter({ root, palette: () => palette });
    buildScene(0);
    render();
    if (opts.ui !== false) buildUI();
    deck.playing = opts.autoplay ?? false;
    deck.last = performance.now();
    if (opts.expose !== false) window.DECK = deck;
    requestAnimationFrame(tick);
    spec.hooks?.onReady?.(deck);
  })();

  function buildUI() {
    const app = root.closest('#deck-app') ?? document.body;
    // 字幕 / 场景标签
    const cap = document.createElement('div'); cap.id = 'deck-caption'; root.append(cap);
    const tag = document.createElement('div'); tag.id = 'deck-tag'; root.append(tag);

    const bar = document.createElement('div');
    bar.id = 'deck-bar';
    bar.innerHTML = `
      <button id="deck-play">▶ 播放</button>
      <button id="deck-prev">◀ 上一幕</button>
      <button id="deck-next">下一幕 ▶</button>
      <button id="deck-quiz" style="display:none">🤔 预测</button>
      <div id="deck-scrub"><i></i></div>
      <span class="now"></span>
      <div class="chapters">${spec.scenes.map((s, i) => `<button data-i="${i}" title="${s.title ?? ''}">${String(i + 1).padStart(2, '0')}</button>`).join('')}</div>`;
    app.append(bar);

    // 暂停提示：**启动时**就建好（不要懒创建 —— 那会让"启动时 DOM 是否完整"这类检查失效，
    // G0 死选择器门禁就是靠启动时快照工作的）
    const pauseNode = document.createElement('div');
    pauseNode.id = 'deck-pause';
    pauseNode.dataset.on = '0';
    pauseNode.addEventListener('click', () => { pauseNode.dataset.on = '0'; deck.pauseOpen = false; deck.play(); });
    root.append(pauseNode);

    const bar2 = document.createElement('div');
    bar2.id = 'quiz';
    app.querySelector('#deck-viewport')?.append(bar2);
    bar.querySelector('#deck-quiz').onclick = () => showQuiz();
    bar.querySelector('#deck-play').onclick = () => deck.toggle();
    bar.querySelector('#deck-prev').onclick = () => deck.prev();
    bar.querySelector('#deck-next').onclick = () => deck.next();
    bar.querySelectorAll('.chapters button').forEach((b) => { b.onclick = () => deck.goScene(Number(b.dataset.i)); });
    const scrub = bar.querySelector('#deck-scrub');
    const seekFromEvent = (ev) => {
      const r = scrub.getBoundingClientRect();
      const frac = clamp01(((ev.touches?.[0]?.clientX ?? ev.clientX) - r.left) / r.width);
      // 全局时间 → 场景 + 场景内时间
      let g = frac * deck.totalDuration();
      for (let i = 0; i < spec.scenes.length; i++) {
        if (g <= spec.scenes[i].duration || i === spec.scenes.length - 1) { deck.goScene(i, { at: Math.max(0, g) }); break; }
        g -= spec.scenes[i].duration;
      }
    };
    scrub.addEventListener('pointerdown', (e) => { deck.pause(); seekFromEvent(e); scrub.setPointerCapture(e.pointerId); });
    scrub.addEventListener('pointermove', (e) => { if (e.buttons) seekFromEvent(e); });

    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === ' ') { e.preventDefault(); deck.toggle(); }
      else if (k === 'arrowright') deck.seek(deck.t + 1);
      else if (k === 'arrowleft') deck.seek(deck.t - 1);
      else if (k === 'j' || k === 'pagedown') deck.next();
      else if (k === 'k' || k === 'pageup') deck.prev();
      else if (k === '0') deck.goScene(0);
      else if (k === 'q') deck.showQuiz();
      else if (k === 'escape') deck.hideQuiz();
      else if (/^[1-9]$/.test(k)) deck.goScene(Number(k) - 1);
    });
    updateBar();
  }

  return deck;
}

export default { createDeck, validate, EASE, ACTIONS };
