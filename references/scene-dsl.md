# 场景 DSL 参考

一份课件 = 一个 `deck` 对象。**全部是数据 + 纯函数，没有副作用、没有时钟。**

```js
export const deck = {
  meta:  { title, subtitle, theme: 'ink' | 'paper' | 'neon' },
  scenes: [ { id, title, duration, elements: [...], beats: [...], quiz? }, ... ],
};
```

---

## 一、坐标系（唯一的坐标系）

设计画布固定 **1280 × 720**。元素用**百分比**定位，`#stage` 整块 `transform: scale()` 适配任意视口。

| 字段 | 含义 | 约束 |
|---|---|---|
| `x` | 左边缘，占画面宽的百分比 | `0 ≤ x`，且 `x + w ≤ 100` |
| `y` | 上边缘，占画面高的百分比 | `0 ≤ y ≤ 100` |
| `w` | 宽度百分比 | 必填 |
| `h` | 高度百分比 | canvas2d / three / shape / annot / chart 必填 |
| `group` | **信息单元**名：同一单元的元素算"一起出现"（G9 按单元计数） | 可选，如 `'head'` / `'A'` / `'L'` |
| `monotonic` | 声明"可见笔画只增不减"，交给 G10 守 | 可选，逐笔画的画布建议标 |

**为什么用百分比而不是 px**：`verify.mjs` 在不同视口下量 `getBoundingClientRect` 做越界断言，百分比让断言与视口无关；导出视频时又能通过 `--size=1920x1080` 拿到任意分辨率。

`w=44` 就是「画面宽的 44%」＝ 563px。一页横向最多放两栏（44 + 44 + 间隙）。

---

## 二、元素类型（10 种）

### `image` —— 真实图片 / 照片

```js
{ id: 'ph', type: 'image',
  src: './assets/brush.jpg',   // ⚠️ 相对 deck.html（不是相对本场景文件）
  fit: 'cover',                // cover 裁切 / contain 完整
  ken: 0.14,                   // 确定性缓慢推近幅度 0~0.6，用 draw 动作把 p 从 0 推到 1
  bleed: true,                 // 出血背景（满幅）—— 显式声明才豁免安全区
  credit: '作者 · 来源 · 许可',  // 必填，标在画面右下角
  alt: '无障碍描述' }
```

- **推近是时间的函数**：`scale = 1 + ken * ease(state.p)`，所以可拖、可断言、出片不闪。
  **不要**用 CSS animation —— 它有自己的时钟，逐帧 seek 取不出进度，G4 会随机变红。
- **`credit` 必填**（校验器 error）：出处标在画面上，不是只写在交付说明里。
- **缺图不开天窗**：加载失败画虚线占位框 + `data-placeholder="1"`，**G13 报红**。
- **路径基准**：`src` 相对 `deck.html`。deck.html 在 `templates/` 下，所以资源放
  `templates/assets/`，写 `./assets/x.jpg`。（放仓库根的 `assets/` 会 404。）

### `below` —— 让引擎排版，不要手填 `y`

**这是本 DSL 里最重要的一条排版纪律。** 手填 `y` 必然出事，因为
**声明的盒 ≠ 画出来的内容**：你写 `h:11%`（79px），metric 实际画了 110px，
而 `overflow` 是 `visible` —— 字就跑到盒外 30px，压住下一排。
没有任何静态检查能预先知道这件事，只有渲染完才知道。

所以：**声明顺序和间距，位置交给引擎。**

```js
{ id: 't', type: 'text', role: 'title', x: 6, w: 84, size: 34, below: 'k', gap: 1.6 },
{ id: 'm', type: 'metric', value: 0, unit: '%', x: 6, w: 19, decimals: 2, below: 't', gap: 3 },
```

- 有 `below` 时 **`y` 可以省略**（两个都给会警告，`y` 被忽略）
- 引擎量的是**锚点渲染出来的实际高度**（含溢出的子节点），再加 `gap`（% 舞台高）
- 同一锚点下的**多个元素会排成一行**（各自 `x` 不同）—— 这是特性，不是 bug
- 锚点必须在**同一幕里、声明顺序更靠前**
- 链式累加是**位置无关**的（量高度、累加 top），所以结果确定，不会因为测量时刻不同而漂移
- 兜底：解析出的 `top` 会被夹在 92% 以内（宁可挤一点，也不出界）
- `lint-scenes.mjs` 对带 `below` 的元素跳过静态安全区检查（静态判不了），交给 `G14` 实测

配套的两条门禁：**`G2b`**（内容装得进自己的盒，全类型）和
**`G14`**（任意两个元素不相交，全帧）。

### `overlapOk` —— 显式声明"这是故意叠放的"

和 `bleed` 同一个哲学：**默认不许，声明才许。**

```js
{ id: 'ca', type: 'canvas2d', overlapOk: true, x: 7, y: 34, w: 56, h: 50, z: 2 }   // 故意画在底图上
```

`G14` 会跳过带 `overlapOk: true` 的元素。校验器会提醒你确认这是真·故意，
而不是为了消红而加的开关。

### `bleed` —— 出血元素

满幅背景图/色块是常规手法，但会撞上安全区（内容 ∈ [3%, 92%]）。
解决方式是**显式声明**，而不是放宽规则：

```js
{ id: 'scrim', type: 'shape', bleed: true, static: true, x: 48, y: 0, w: 6, h: 100 }
```

- `lint-scenes.mjs`：`bleed: true` 跳过安全区检查
- `G2d`：`bleed` 元素不参与"覆盖层压内容"（字幕自带底色，压住背景不算遮挡）
- 引擎：`bleed` 用在 `text/list/code/metric` 上 → 报错（内容出血会被字幕条压住）



| type | 用途 | 关键字段 |
|---|---|---|
| `text` | 标题 / 正文 / 引言 | `role: 'title'\|'body'\|'kicker'\|'quote'`、`text`（支持 `<br>`）、`size` |
| `shape` | 线条 / 矩形 / 箭头（可逐笔画出） | `shape: 'rect'\|'line'\|'arrow'`、`tone` |
| `annot` | 手绘批注：圈 / 下划线 + 标签 | `kind: 'circle'\|'underline'\|'bracket'`、`text` |
| `code` | 代码块（自动高亮关键字/注释/数字） | `code` |
| `metric` | 大数字（`countUp` 的载体） | `value`、`unit`、`label`、`decimals`、`tone` |
| `list` | 条目列表（支持 `stagger`） | `items: [{badge, text}]` |
| `chart` | 柱状图（`grow` 控制长出来） | `data: [{v, vLabel, k, tone}]` |
| `canvas2d` | **任意 2D 动画** | `draw(ctx, t, el, api)` |
| `three` | **任意 3D 动画** | `init(THREE, el, api) → update(t, el, api)`、`camera`、`fallback` |

### canvas2d 签名

```js
{ id: 'grid', type: 'canvas2d', x: 4, y: 16, w: 44, h: 46,
  draw(ctx, t, el, api) { /* t = 场景内秒，唯一的动画输入 */ } }
```

### ink：按笔画工具箱

```js
const head = api.ink.cubic(ctx, [P0, P1, P2, P3], progress, { color, width, glow, dash });
api.ink.nib(ctx, head, color, 4.5, alpha);      // 笔尖：画到哪就在哪点一个发光小圆
```

| 函数 | 说明 |
|---|---|
| `ink.path(ctx, pts, p, o)` | 折线按弧长画出前 `p` 比例，返回笔尖 |
| `ink.cubic / ink.quad(ctx, P, p, o)` | 贝塞尔曲线按笔画出来（内部采样成折线） |
| `ink.line / ink.arrow(ctx, a, b, p, o)` | 线段 / 带箭头的线段（箭头画完才出现） |
| `ink.dot / ink.ring / ink.nib` | 实心点 / 空心圆环 / 发光笔尖 |
| `ink.label(ctx, str, x, y, o)` | 小标签 |
| `ink.lerp / ink.mid / ink.dist` | 构造用的小工具（de Casteljau 之类） |

引擎每帧统计：`deck.state().ink` = `{ calls, growing, peak, len, cum }`
（`growing` = 本帧同时有几笔在生长；`len` = 本帧可见笔画总长度）。G9b / G10 靠它做断言。

详见 `references/stroke-drawing.md`。

`api` 提供：

| 字段 | 说明 |
|---|---|
| `w`, `h` | 画布的**设备像素**尺寸（已按 devicePixelRatio 放大，直接用即可） |
| `palette` | `{ ink, muted, line, accent, accent-2, good, bad }` —— 从 CSS 变量读出，换主题自动跟着变 |
| `state` | 该元素当前的动作状态 `{ opacity, dx, dy, scale, p, grow, value, spot, dim, flash, text }` |
| `ease(name, p)` | 缓动函数（`out` / `in` / `inout` / `back` / `expo` / `linear`） |
| `DW`, `DH` | 设计尺寸 1280 / 720（要按设计比例换算时用） |

### three 签名

```js
{ id: 'stage3d', type: 'three', x: 22, y: 12, w: 56, h: 62,
  camera: { pos: [8.5, 7, 10], look: [0, 0.4, 0], fov: 40 },
  init(THREE, el, api) {
    // 建场景；把要跨帧用的对象挂在 el 上
    api.scene.add(group);
    return (t, el, api) => { /* 每帧更新，纯函数 */ };
  },
  fallback: { spin: 0.12, scale: 30, boxes: (t) => [{ x, y, z, s, color }] },
}
```

- three 从 CDN 懒加载（默认 `unpkg three@0.180.0`，`window.THREE_URL` 可覆盖）。
- **`fallback` 不是可选项而是纪律**：CDN 挂了 / 没有 WebGL / 离线播放时，引擎自动走 2D 等距投影，并给节点打上 `data-fallback="1"`。`fallback.boxes` 接收 `t`，所以**降级路径同样是动画**，只是表现力弱一点。
- 场景数据里不要 `import * as THREE`（会破坏懒加载与离线降级）。

---

## 三、动作目录（11 个原子动作 + 4 个编排动作）

原子动作都是 `(状态, 进度) => 状态` 的纯函数，注册在 `engine/scene.js` 的 `ACTIONS`。

| action | 效果 | 必填 | 常见误用 |
|---|---|---|---|
| `reveal` | 淡入 + 上浮 26px | `target`, `dur` | 一页 8 个元素全 reveal → 像 PPT 逐条弹，改用 `stagger` |
| `fadeOut` | 淡出 | `target` | 用来"清场"；别和 `dim` 混 |
| `spotlight` | 自身提亮，**其余全部压暗到 22%** | `target` | 一页只能有一个聚光；讲完记得 `reset` |
| `flash` | 闪一下（正弦脉冲） | `target` | 只在"就是这里"时用，一页最多 1 次 |
| `dim` | 灰掉（表示不重要） | `target` | 与 `spotlight` 相反 |
| `moveTo` | 位移/缩放/旋转 | `target`, `dx/dy/scale/rotate` | 位移超过 15% 会让人跟丢 |
| `morph` | 数字过渡，或**打字机**（`charProgress: true` + `fromText`） | `target` | 打字机文本 > 30 字会拖 |
| `countUp` | 数字滚动到 `to` | `target`, `to`, `dur` | `dur` < 0.4s 看不清；> 3s 太磨蹭 |
| `draw` | 逐笔画出（shape / annot 的虚线偏移；canvas2d 的笔画总进度） | `target` | 用 `s.p` 驱动 `drawStrokes`，见 stroke-drawing.md |
| `grow` | 0→1 的布局进度（柱状图长出来） | `target`, `from`, `to` | 图表不给 `grow` 就会瞬间全高 |
| `wait` | 空动作，只占时间点 | `at` | 用来给旁白留呼吸 |
| `pause` | 播到这里停住，显示 `hint`，点击继续。**只有播放中越过这个点才触发** —— seek 过去的不算（旧实现会"拖到 30s 按播放立刻弹 26.5s 的提示"） | `at`, `hint` | 当成"自动分段"卖。研究结论是长视频里自动暂停无益，证据支持**学习者自己控制分段** |
| `hold` | **空动作，什么都不做** —— 它的唯一作用是一条**可被 G15c 验证的声明**："这段时间画面是静的，观众可以回读" | `dur ≥ 1.2` | 以为它能"让画面停住"。它不会 —— 停住是因为你没在里面放别的动作。写了 `hold` 却还在动 = 声明说谎，G15c 会红 |

### `draw` / `grow` / `countUp` 的分段写法

标量动作可以只画一部分区间，用 `{from, to}` 表示：

```js
{ at: 1.0, action: 'draw', target: 'ca', from: 0,    to: 0.33, dur: 6 },   // 第一段
{ at: 7.0, action: 'hold', target: 'ca', dur: 2.0 },                       // 停下来读
{ at: 9.0, action: 'draw', target: 'ca', from: 0.33, to: 0.66, dur: 6 },   // 第二段
```

为什么必须分段：**一口气画 30 秒，观众没有一帧可以指着说"就这儿"**。
G15 抓连续变化段长度，G15b 抓"每 12s 至少一个 ≥1.2s 的静态窗口"。

**端点必须接得上**（G15d）：每段开始前的值要等于上一段的 `to`，结束后等于 `to`。
中间断开 = 画面跳回去。

编排动作（不是纯函数，由 deck 层处理）：

| action | 效果 |
|---|---|
| `speak` | 旁白：显示字幕，可选 TTS（`?narrate=1`）。**`text.length / 4.6` 必须 ≤ 剩余时长**，否则校验器报错 |
| `stagger` | 把一个 `list` 的条目按 `step` 秒依次 reveal |
| `zoomTo` | 相机推近某个元素（`scale`），`target: null` 复位 |
| `reset` | 清掉 spotlight/dim/flash |

---

## 四、叙事结构（`oneLine` / `beat`）

```js
meta: { title: '...', oneLine: '动画讲解课把「讲清楚」变成了可执行的门禁。' },
scenes: [
  { id: 'bg',        beat: 'hook',      duration: 30, ... },
  { id: 'problem',   beat: 'problem',   duration: 32, ... },
  { id: 'determin',  beat: 'mechanism', duration: 22, ... },
  { id: 'scenes',    beat: 'boundary',  duration: 26, ... },
  { id: 'who',       beat: 'payoff',    duration: 35, ... },
]
```

`oneLine` **必填**：用一句话说出看完该记住的那件事。说不清就该砍范围，而不是缩小字号。

`beat` 是这一幕在论证里担任的**职责**，六选一：

| beat | 职责 |
|---|---|
| `hook` | 一个反直觉的数字 / 现象，把人留下来 |
| `problem` | 听众现在的痛 |
| `mechanism` | 为什么，怎么发生 |
| `evidence` | 量级与参照（多大、和什么比） |
| `boundary` | **什么时候不成立、不该这么做** |
| `payoff` | 收尾 + 一个能带走的动作 |

校验器强制（`validate()`，lint 与浏览器共用）：

- 每幕必须有 `beat`，且必须在上面六个里
- 至少一幕是 `boundary` —— **只有支持证据的讲解是宣传，不是教学**
- 每个节拍的**时长占比 ∈ [8%, 50%]**（低于 8% = 装饰性收尾，高于 50% = 头重脚轻）
- 第一幕建议 `hook`/`problem`、最后一幕建议 `payoff`（warning）

阈值是先量后定的：现有 7 份课件的实际分布是 8%–23%，
所以 [8%, 50%] 不误伤任何人，但拦得住"边界幕只有 3 秒"。
上线即抓到 `about` 的 payoff 只占 **7.96%** —— 判得对，那是装饰性收尾。

---

## 五、预测题（quiz）

```js
quiz: {
  q: '两万个物体，瓶颈最可能在哪儿？',
  opts: [
    { t: 'GPU 顶点处理不过来', ok: false, why: '实测 GPU 只用了 1.85ms。' },
    { t: 'CPU 每帧命令太多',   ok: true,  why: '对。两万次 writeBuffer + drawIndexed。' },
  ],
}
```

校验器强制：**恰好一个 `ok: true`**、≥ 2 个选项、每个选项都要有 `why`。

`why` 是这套东西的核心。答错时不给解释，学习就没发生 —— 只是被扣了分。

### `at` —— 把题放到幕中间，先问后讲

```js
quiz: {
  at: 8.0,          // 播到 8 秒时停下来问，回答完继续
  q: '一个 createBindGroup 大约 1.2 微秒。那 20000 个呢？',
  ...
}
```

不写 `at` 时题挂在**幕尾** —— 那时答案已经讲完了，它测的是**记忆**（recall），不是**预测**。
写了 `at` 才是预测：答案必须在题**之后**才出现。

这不是靠自觉。**G19** 会拿正确选项的关键短语（6 字重合）去比对"被问之前"的画面文字，
重合就报红。上线当天它抓到两处真泄漏：

- `instancing/hook` 画面写着"变的只有 **CPU 每帧**发出的命令" —— 正是正确选项
- `bindgroups/hook` 画面写着"乘上两万次，就是 **24 毫秒**" —— 正是正确选项

两处的修法都不是删题，而是**把答案移到题之后**（`quiz.at`）。

### `kind` —— 显式声明这是哪种题

| `kind` | 含义 | G19 |
|---|---|---|
| `'predict'`（默认） | 先问后讲，答案不许在画面上 | 严格 |
| `'recall'` | 讲完再考记忆，答案本来就在画面上 | 豁免 |

默认 `predict`：预测比重认有价值得多，想宽松必须显式写出来。

**G6b** 另外验证 `at` 不是装饰性声明：那一刻之前 `quizShown=false`、之后 `true`，
且题后必须真的有揭示（问了要答）。

---

## 六、确定性铁律

场景文件里**禁止**：`Date.now()` / `Math.random()` / `performance.now()` / `new Date()`。

- `lint-scenes.mjs` 做源码级扫描（可以写 `// determinism-ok` 显式豁免）。
- `verify.mjs` 做行为级验证：同一 `t` 两次渲染（间隔 400ms 真实时间）截图必须**逐字节相同**。

违反的代价：不能 scrub、不能跳帧、不能截图断言、导出视频会闪、每次评审看到的都不一样。

需要"随机"时用确定性伪随机：

```js
const rnd = (i) => (Math.sin(i * 127.1) * 43758.5453) % 1;   // 输入相同 → 输出相同
```

---

## 七、`validate()` 的全部规则

静态校验（`lint-scenes.mjs` 与浏览器运行时**共用同一份实现**，防止校验器与运行时漂移）：

**错误**
- `scenes` 为空 / 场景缺 `id` / `id` 重复
- `duration` 非正数，或 > 60s（单场景硬上限）
- 场景没有元素 / 没有 `beats`（**静态 PPT 不该用这个引擎**）
- 元素缺 `id`、`id` 重复、未知 `type`、缺 `x/y/w`
- `x + w > 100` 或 `y > 100`（越界）
- `text` 缺 `text`；`canvas2d` 缺 `draw`；`three` 缺 `init`
- beat 的 `at` 为负或超过场景时长（**永远播不到**）
- 未知 `action`；需要 `target` 的动作没给 target；target 不存在于本场景
- `speak` 缺 `text`；**旁白字数 / 4.6 > 剩余秒数**
- `quiz` 缺 `q`、选项 < 2、正确选项 ≠ 1 个

**警告**
- `meta.title` 缺失
- 元素数 > 14（一页讲太多了）
- 元素未被任何 beat 引用（死元素）—— 背景请标 `static: true`
- 没有任何"出现/生长"类动作（页面是静态的）
- `metric` 没有初始 `value`
- `quiz` 选项缺 `why`
- 全场 > 15 分钟（考虑拆两讲）

---

## 八、运行时 API

```js
const deck = createDeck(spec, { mount: '#deck-viewport', autoplay, narrate, capture, expose });
```

| 方法 / 属性 | 说明 |
|---|---|
| `deck.play()` / `pause()` / `toggle()` | 播放控制 |
| `deck.seek(t)` | 幕内跳转（秒） |
| `deck.goScene(i, { at, play })` | 跳到第 i 幕（0 基） |
| `deck.next()` / `prev()` | 上一幕 / 下一幕 |
| `deck.globalAt()` / `totalDuration()` | 全场时间 / 总时长 |
| `deck.showQuiz()` / `hideQuiz()` | 预测题 |
| `deck.state()` | `{ index, sceneId, t, global, playing, frames, errors, warnings, quizOpen, quizAnswers, ink }` |
| `deck.probe(i, t)` | **纯函数探针**：算第 i 幕在 t 时刻每个元素的状态（不碰 DOM，门禁用它扫幕） |
| `window.DECK_INFO` | 静态清单（幕数、元素数、动作数、是否有题、溯源） |

键盘：`空格` 播放/暂停 · `←/→` 上一幕/下一幕 · `J/K` ±5s · `1-9` 跳幕 · `Q` 出题 · `Esc` 关题。

查询参数：`?autoplay=1` 自动播 · `?narrate=1` 开 TTS · `?capture=1` 隐藏控制条（录制用）· `?three=off` 强制走 2D 降级 · `?verify=1` 验证模式。
