---
name: animated-lesson
description: 制作「动画讲解课」——把技术概念、算法机制、性能数据讲成一段可播放/可拖动/可导视频的教学动画，而不是静态 PPT。核心是确定性时间轴：render(t) 是纯函数，因此可 scrub、可截图断言、可导出视频帧。含场景 DSL、11 个讲解动作（spotlight/draw/countUp/morph/打字机）、canvas2d 任意 2D 动画、three.js 3D（带离线 2D 降级）、预测题、旁白字幕，以及 12 项浏览器门禁（含确定性双渲染 diff、静态页冒充检测）。触发词：动画讲解 / 教学动画 / 讲解课件 / 动画课件 / 让这个概念动起来 / 交互式讲解 / 可拖动的时间轴 / 导出讲解视频 / animated lesson / 类似 OpenMAIC 的教学场景 / three.js 讲解 / 可视化讲解。
---

# 动画讲解课（animated-lesson）

## 这个 skill 解决什么

大多数"讲解"产出是**静态的**：PPT 一页页翻，图是截的，数字是抄的，机制靠读者脑补。
这个 skill 产出的是**会动的讲解**：机制在眼前逐步发生，数字从 0 滚到实测值，相机推近到关键处，学习者先下注再看揭晓。

一句话区分：

> **PPT 描述现象；动画讲解课让现象在眼前发生。**

## 唯一的中心思想：确定性时间轴

```js
draw(ctx, t, el, api)   // t = 场景内秒数。它是输入，不是时钟。
```

`render(t)` 是**纯函数**。这一个约束换来四件事：

| 能力 | 因为确定性才成立 |
|---|---|
| 拖动进度条 / 跳帧 | 任意 `t` 都能直接渲染，不依赖"已经播了多久" |
| 截图断言 | 同一 `t` 两次渲染必须逐字节相同 → 可自动化验证 |
| 导出视频 | 逐帧 seek 出图，帧与帧之间不会闪 |
| 评审可复现 | 每个人看到的关键帧完全一样，讨论的是同一件事 |

所以场景文件里**禁止** `Date.now()` / `Math.random()` / `performance.now()`。这是铁律，不是建议。

---

## 双轨 SOP

### A 轨：业务 SOP（决定讲什么、讲给谁）

| 步 | 动作 | 产出 | 通过标准 |
|---|---|---|---|
| A1 | **定听众与时长**。默认 5 幕 / 90 秒。听众人数 > 1 时先写一句话：听众现在以为 X，听完要知道 Y | 一句话目标 | 能说出"听完他会改变哪个判断" |
| A2 | **找钩子**（第 1 幕）。一个反直觉的数字或对比 | 钩子幕 | 有个"咦？"的瞬间；有预测题 |
| A3 | **拆机制**（第 2 幕）。把过程拆成看得见的步骤 | 机制幕 | 每一步都能用动作表达（不是用文字描述） |
| A4 | **给证据**。数字必须来自真实测量/权威来源 | 数据幕 | 页面上标了来源；导出 `PROVENANCE` |
| A5 | **讲边界**（倒数第 2 幕）。什么时候**不**该这么做 | 边界幕 | 有拐点、有反例；不是广告 |
| A6 | **收尾 + 预测题** | 结尾幕 | 一题能把"记住"变成"会用" |
| A7 | **节奏预算**：中文旁白 4.6 字/秒，单幕 ≤ 60s，全场 ≤ 15 分钟 | 时长表 | `lint-scenes.mjs` 零错误 |

### B 轨：技术 SOP（怎么把它做出来）

| 步 | 动作 | 命令 / 文件 | 通过标准 |
|---|---|---|---|
| B1 | **起骨架**：有材料就 `from-md.mjs`（自动搭论证结构 + 列缺项）；没有就复制 `scenes.instancing.js` | `scripts/from-md.mjs` | 生成物能过全部门禁，且缺项清单已打印 |
| B2 | **写元素**：只用百分比定位，两栏用 `4/44` + `52/44`；内容按 主张/机制/量级/边界 组织 | `references/scene-dsl.md` · `references/skill-roadmap.md` | `validate()` 无越界错误 |
| B3 | **写动作**：每个元素至少要有一个动作（否则是死元素） | 动作目录 | 无"死元素"警告 |
| B4 | **做动画载体**：canvas2d 画过程，three 画空间，metric 画数字 | `draw(ctx,t,...)` / `init(THREE,...)` | 静态 lint 全绿 |
| B5 | **上浏览器验**：`node scripts/verify.mjs` | 22 项门禁 | 全绿（含 G4 确定性 / G2d 遮挡 / G11 数据敏感） |
| B6 | **写 3D 的降级路径**：`fallback.boxes` 与 3D 共用同一条时间表 | `submissionAt(t)` 模式 | G8 通过（`?three=off` 仍在动） |
| B7 | **加旁白与预测题** | `speak` / `quiz` | G5、G6 通过 |
| B8 | **出片** | `--mp4=out/x.mp4 --size=1920x1080` | 得到 1080p mp4（帧不落盘） |

---

## 快速开始

```bash
cd ~/.agents/skills/animated-lesson

# 0. 先看：介绍页（背景 / 优势 / 场景 / 人群，一页看完）
./serve.sh                       # → http://127.0.0.1:8099/intro.html
#                                元课件：?scenes=./scenes.about.js（8 幕 / 3.2 分钟）

# 0.5 有材料的话，先让它生成骨架（素材 → 课件，这是以前缺的一环）
node scripts/from-md.mjs docs/你的文档.md --out=templates/scenes.mine.js
#    它会搭出 主张/机制/量级/边界/溯源，并打印"待你补齐"的清单

# 1. 静态校验（毫秒级，作者循环里一直跑）—— 顺带输出内容深度体检表
node scripts/lint-scenes.mjs

# 2. 浏览器门禁（22 项，含确定性双渲染 diff、遮挡、两两不相交、数据敏感性）
node scripts/verify.mjs
node scripts/verify.mjs --shots=/tmp/shots              # 顺便导出关键帧
node scripts/verify.mjs --deck='templates/deck.html?scenes=./scenes.mine.js'

# 3. 一键出片：帧直接管道进 ffmpeg，不落盘
node scripts/verify.mjs --deck='templates/deck.html?scenes=./scenes.mine.js' \
     --mp4=out/mine.mp4 --fps=24 --size=1920x1080

# 4. 交付前一键（lint + 链接 + 五份课件全量门禁）
./scripts/check-all.sh
```

**人群**：工程师做技术分享（讲机制、讲拐点）· 老师与课程作者（讲构造过程）·
产品与架构设计者（讲演进）· 做 agent 的人（让 agent 汇报它做了什么）。
共同点是**要讲的东西都有「顺序」**。详见 [intro.html](intro.html) 与
[references/stroke-drawing.md](references/stroke-drawing.md)。

---

零 npm 依赖：Node 22 + 系统 Chrome（CDP 驱动）+ 可选 ffmpeg。three.js 从 CDN 懒加载，可用 `window.THREE_URL` 换成内网地址。

---

## 文件结构

```
engine/
  scene.css          主题令牌 + 1280×720 设计坐标系 + 动作的视觉实现
  scene.js           引擎内核：ACTIONS / validate / stateAt / createDeck / 控制条 / 预测题
  three-adapter.js   three 懒加载 + 2D 等距投影降级
templates/
  scenes.instancing.js   参考课件（5 幕：钩子→机制→3D→数据→边界）
  deck.html              可跑课件壳
scripts/
  lint-scenes.mjs    静态校验（复用 validate + 源码扫非确定性）
  verify.mjs         浏览器 22 项门禁 + 关键帧/帧序列导出
  gate-selftest.mjs  负向测试：造坏课件，证明门禁真的会失败
references/
  scene-dsl.md       DSL 完整参考（元素、动作、API、ink 工具箱）
  stroke-drawing.md  「按笔画出来」模式参考：5 个 case + 设计规则 + 度量演进
  authoring-gates.md 门禁清单 + 失败模式库（A–F 六类，含真实踩坑）
  design-notes.md    设计取舍：从 OpenMAIC 抄了什么、为什么不抄什么
```

---

## 质量门禁（不合格不交付）

**硬门禁 —— 任一不过就不能交付：**

1. `lint-scenes.mjs` 零错误零警告（含源码级确定性扫描）
2. `verify.mjs` 15 项全绿，尤其：
   - **G3 每一幕都在动**（静态 PPT 冒充不了动画）
   - **G4 同 t 双渲染逐字节相同**（确定性）
   - **G5 每条旁白都能在剩余时长内说完**
   - **G9 信息释放节流**（≤3 信息单元 / 0.5s，防认知过载）
   - **G9b 笔速**（同时生长的笔画 ≤ 4，防"一次画太多"）
   - **G10 笔画只增不减**（已画好的东西不被擦掉 —— 「按笔画」的定义性质）
   - **G8 `?three=off` 时 3D 区域仍在动**（断网不开天窗）
3. 正文里每个数字都能在 `PROVENANCE` 里找到出处
4. 有预测题，且每个错误选项都写了 `why`

**软门禁 —— 影响质量，酌情处理：**

- 一页 ≤ 3 个视觉焦点（靠 spotlight/dim 分批，而不是一次性全 reveal）
- 有一幕专门讲"什么时候不该这么做"
- 3D 只用在"空间关系本身就是重点"的地方；纯数值对比用 chart/metric 更清楚
- 旁白是讲解，不是朗读画面上的字

---

## 与相邻 skill 的分工

| 场景 | 用哪个 |
|---|---|
| 要**成品 PPTX**，人继续在 PowerPoint 里编辑 | `ppt-master` / `open-kimi-ppt` |
| 要**网页幻灯片**，重设计与排版，不重动画机制 | `frontend-slides` / `open-narrate` |
| 要**交互式学习页**（读者自己点、自己做实验） | `learn.html` 模式（见 `~/Projects/webgpu/learn.html`） |
| 要**把机制讲清楚、能播能拖能导视频** | **本 skill** |
| 要**把构造过程/算法顺序讲清楚**（贝塞尔、A*、SDF、编译流程…） | **本 skill** + `references/stroke-drawing.md` |
| 要**构建一个 PPT 生成系统** | `ppt-agent-methodology` |

判断口诀：**重点在"看到过程"就用这个；重点在"留下文档"就用 PPT 类 skill。**

---

## 授权与依赖

- 引擎与脚本为本 skill 原创，零外部依赖。
- three.js 由 CDN 加载（MIT），仅在使用 `type: 'three'` 的元素时加载，且必有 2D 降级。
- 参考课件的性能数字来自本机真实基准（见 `~/Projects/webgpu/`，`PROVENANCE` 记录了每条的来源文件）。
