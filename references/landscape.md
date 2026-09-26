# 「教学动画」这块的线上版图（2026-09 实测）

> 这份文档回答一个问题：**把技术概念讲成可播放/可导出的动画课，线上已经有哪些成熟方案？**
> 所有数字和结论都在本机核实过（GitHub API + 拉源码读实现），不是转述二手总结。

---

## 一、结论先行

1. **线上有相关 skill，而且有一个正面竞争者。** `heygen-com/hyperframes` 做了和本 skill
   几乎相同的事（HTML → 确定性 mp4，为 agent 而生），但成熟度高一个量级。
2. **但它和本 skill 的攻击面不同。** HyperFrames 是**视频生产管线**，本 skill 是
   **讲解编排**。它把"渲染"做到了工业化，把"教什么、怎么教"留给了使用者。
3. **必须修正一个我自己的错误判断。** 我原先认为"对渲染结果做像素/DOM 断言门禁"是
   本 skill 独有的。**这是错的** —— HyperFrames 有一套更成熟的断言系统。
4. **真正独有、且线上找不到等价物的只有两样**：
   - **G11 扰动测试**（把数据 ×1.6 / 删掉最后一个元素 → 画面必须变化）
   - **教学法门禁**（把 Mayer 原则、提取练习、认知负荷变成可执行断言）
5. **最该补的短板是叙事结构。** `iart-ai/explainer-video-skills` 有量化的叙事弧
   （Problem→Stakes→Solution→How→Payoff + 每段 runtime 占比 + 每秒字数），
   本 skill 的 A 轨只有"主张/机制/量级/边界"，**没有任何时长预算**。

---

## 二、实测数据

| 仓库 | ★ | forks | 许可 | 语言 | skill 数 | 实测日期 |
|---|---|---|---|---|---|---|
| `heygen-com/hyperframes` | **53,109** | 4,846 | Apache-2.0 | TypeScript | 40 个 `SKILL.md` | 2026-09-26 |
| `remotion-dev/skills` | 4,710 | 530 | 无 | TypeScript | — | 2026-09-25 |
| `iart-ai/explainer-video-skills` | 25 | 8 | MIT | HTML | 5 | 2026-06-22 |
| `iart-ai/manim-skills` | 9 | 6 | MIT | HTML | 1 | 2026-06-22 |

**本地**：288 个已安装 skill 里，只有 `animated-lesson` 一个提到"确定性时间轴 / `render(t)` /
逐帧导出"。教学法一侧由 `teach`、`ultralearning`、`teach-investigate` 拥有，**三者都没有动画**。

→ **「教学」和「动画」这两半在本地也是分开的**，没有人把它们缝起来。

---

## 三、方案对比

### 3.1 程序化动画引擎

| 方案 | 定位 | 做对了什么（可抄） | 代价 / 该避开 |
|---|---|---|---|
| **Manim / manimgl** | 数学讲解引擎（3b1b） | mobject / transform / LaTeX 原语最丰富；`self.wait(d)` 推进时钟 | **没有 `seek(t)`**：`construct()` 是命令式执行，t 时刻的状态只能从头 replay。时间轴是*隐式涌现*的 |
| **manim-slides** | Manim → 交互 deck | `next_slide()` 插分段点 → 导出 RevealJS/PPTX。**「同一源 → 分段 deck」值得抄** | 不解决确定性，只加分段 |
| **Remotion** | React 视频 | 确定性契约写得最清楚：组件 = frame→image，4 条准则（同帧重复调用同结果 / 不依赖渲染顺序 / 暂停不动 / 无随机） | 只用**文档**约束纯函数；没有断言。`--concurrency=1` 是"慢且不保证时序"的兜底 |
| **Motion Canvas** | TS 生成器动画 + 编辑器 | `function*` + `yield*`，`waitFor(秒)` 确定性；编辑器可 seek | `waitUntil('event')` / `useDuration('event')` 让时长由**运行时命名事件**决定 → 破坏 t 纯度。issue #1129 只是*假设*帧独立 |
| **Revideo** | Motion Canvas 的 fork | 补了 `render` API + React `<Player>` 嵌入 | 继承 MC 的纯度缝，生态小 |
| **HyperFrames** | HTML → 确定性 mp4，为 agent 而生 | **见下节，最该研究** | 管线/CLI/分布式**已经做完**，别重造 |
| **Slidev / reveal.js** | 代码驱动 PPT | 单文件、MDX、代码动画 | 边界清晰：它们是**离散 slide + fragment**，没有连续 t 时间轴、没有逐帧断言 |
| **tldraw / Excalidraw** | 程序化画布 | tldraw `programmatic-control`、Excalidraw `convertToExcalidrawElements` | 只做"画"，不做时间轴/导出。要手绘风格时用 SDK，别自造 |
| **Ciechanowski 式交互讲解** | 交互式文章 | 真交互、无视频，理解深度最高 | **不可导出、不可断言、不可批量** —— 正是要避开的 |

### 3.2 HyperFrames 到底做到了哪一步（读了源码）

`packages/cli/src/commands/` 有 `lint / check / snapshot / doctor / inspect`。
`check` 的选项（`checkTypes.ts` 实测）包括：

```
samples, at[], atTransitions, maxIssues, collapseStatic,
tolerance, contrast, strict, snapshots,
captionZone{x0,y0,x1,y1}, frameCheck{tol, seek},
layout{proseCoverageFloor}
```

`layoutAudit.ts` 的 issue 码里有 **`text_occluded`**，带 `coveredFraction`
（"遮挡探针网格命中不透明遮挡物的比例"，默认阈值 0.15）。
`motionAudit.ts` 的 issue 码包括：

| HyperFrames | 语义 | 对应的本 skill 门禁 |
|---|---|---|
| `motion_selector_missing` | 选择器一个都没匹配到 | （无） |
| `motion_appears_late` | 元素晚于 deadline 出现 | ≈ G9 信息释放节流 |
| `motion_out_of_order` | "A 应该在 B 之前出现" | ≈ reveal 排序 |
| `motion_off_frame` | 元素飘出画布 | ≈ G2 无越界 |
| `liveness`（每 scope 的活跃签名） | "它到底动没动" | ≈ G3 每一幕都在动 |
| `text_occluded` + `coveredFraction` | 文字被遮挡的**比例** | ≈ G2d 遮挡（**它的更细**） |
| `verifyStaticPage.ts` | 静态页冒充检测 | ≈ 同名门禁 |

**所以必须承认：断言系统的「种类」我并没有创新。** HyperFrames 做得更成熟，
而且 `coveredFraction` 这种连续量比我的二元判定更可调。

**但全仓搜不到任何「扰动测试」** —— 改数据、看画面变不变。G11 是真独有。

### 3.3 两个「教学/讲解视频 skill」

**`iart-ai/explainer-video-skills`**（5 个 skill：`explainer-video`、`diagram-animation`、
`isometric-animation`、`whiteboard-animation`、`wrapped-video`）

它的 `explainer-video` 里有本 skill **完全缺失**的东西：

- **叙事弧 + runtime 占比**：Problem ~20% → Solution ~15% → How → Payoff
- **"One core idea"**：一句话说不清就是没有脊梁，砍范围而不是缩小
- **Script-first**：*"The VO is the spine; visuals illustrate the line being spoken,
  never lead it. Write and time the words before you storyboard or animate —
  it is far cheaper to cut a sentence than a built scene."*
- **一个比喻骑到底**：中途换比喻会重置理解
- **英文旁白 2.3 词/秒（≈140 wpm）**；60 秒 ≈ 138 词
- **Pacing per beat**：Problem/Stakes 快切，How it works 最慢（每步停住让人读）

它的 `diagram-animation` 和本 skill 的 action 目录几乎 1:1 对应，但**每个原语都给了
量化时长和缓动**：

| 目标 | 机制 | 缓动 | 时长 |
|---|---|---|---|
| 节点出现 | scale 0.8→1 + opacity，`transform-origin:center` | `back.out(1.5)` | 0.45s，stagger 0.35 |
| 边连接 | `stroke-dashoffset` len→0 | `easeInOut` | 0.4–0.7s |
| 数据流动 | dashoffset 循环 + 行进点 | `linear` | 无限 |
| 柱状生长 | `scaleY` 0→1，`transform-origin:bottom` | `easeOut` | stagger 0.06s |
| 折线绘制 | path `stroke-dashoffset` len→0 | `easeInOut` | 0.8–1.2s |
| 数字滚动 | 用缓动后的 t 插值 | `easeOutCubic` | — |
| 高亮 | 活跃 1.0，其余 0.35 | — | 0.3s |

还有两条可直接变成门禁的规则：

- **揭示顺序语法：nodes → edges → labels**（先节点、再边、最后标签）
- **"hold each step 0.5–1.5s so it lands"**（每步停 0.5–1.5 秒让人读）
- **"color means meaning, and that mapping never changes mid-piece"**

**`HyperFrames /faceless-explainer`** 的编排模型：Step 0 setup → 1 brief → 2 design system
→ 3 storyboard/script → 3.1 audio → 4 visual design → 5 frames → 6 render，
每步一个 gate，Step 0/3/6 是用户确认点。关键设计：

- **`BRIEF.md`** —— 意图持久化，重开项目不重新盘问（"never re-interrogate a half-built project"）
- **`frame.md`** —— 把 web 设计系统**反转**成视频语汇（安全区/字号/节奏）
- **frame-presets 目录** —— 出货级设计预设，用户"用眼睛挑"而不是描述风格
- **Step 5 一帧一个 sub-agent** 并行出帧
- `/media-use` 管 BGM/SFX/图片/logo，需要 HeyGen 账号（**云依赖**）

---

## 四、三类清单

### ① 可以直接抄

| 抄什么 | 来源 | 变成什么 |
|---|---|---|
| 叙事弧 + 每段 runtime 占比 | iart `explainer-video` | A 轨加**时长预算表**，lint 检查占比 |
| "One core idea" 一句话 | iart | `meta.oneLine` 必填，且每幕 claim 必须能追溯 |
| Script-first（先写词、再分镜） | iart | 现有"旁白 4.6 字/秒"升级成**先定词再排版**的流程 |
| 一个比喻骑到底 | iart | lint：跨幕检测比喻词，换了就警告 |
| 每个原语的时长 + 缓动表 | iart `diagram-animation` | 写进 `scene-dsl.md` 的默认值 |
| 揭示顺序 nodes→edges→labels | iart | 新门禁：图类场景的 reveal 顺序 |
| "每步停 0.5–1.5s" | iart | G9 补一条**下限**（现在只查上限） |
| `BRIEF.md` 持久意图 | HyperFrames | `meta.brief` + 重开不重问 |
| `frame.md` 设计系统反转 | HyperFrames | `meta.palette` 派生成安全区/字号/节奏 |
| CLI 动词命名 `lint/check/snapshot/preview/render/doctor` | HyperFrames | 命令面统一命名（降低学习成本） |
| `coveredFraction` 连续遮挡比例 | HyperFrames | G2d 从二元升级为可调比例 |
| `next_slide()` 分段点 | manim-slides | 一份源同时出 web / mp4 / **分段 deck** |
| 5 维评分命名 | TheoremExplainAgent | 人工/VLM 评分维度对齐，可与论文数值对比 |

### ② 已经有人做得更好 —— 别自己造

- **渲染管线**：`seekFrame` 纯度 + headless Chrome 逐帧 seek + ffmpeg + Docker + Lambda
  + golden MP4 基线，HyperFrames 全有，且 53k 星、今天还在更新。**别硬拼。**
- **动画运行时 / 缓动**：别自造 GSAP/WAAPI 等价物。
- **分布式渲染**：Remotion Lambda / HyperFrames AWS Lambda。
- **数学 / STEM 原语**：Manim 的 mobject / LaTeX 远强于本 skill 的 shape/code/metric。
  **数学重的场景委派给 Manim**（`iart-ai/manim-skills` 已经包好了）。
- **时间轴编辑 UI**：Motion Canvas / Revideo 编辑器、HyperFrames Studio 已有。
- **手绘 / 白板渲染**：tldraw / Excalidraw SDK。
- **音频 / 配音**：两家都有；本 skill 导出的是**无声**视频。

### ③ 线上没有 —— 是真差异化

1. **G11 扰动测试**（数据 ×1.6 / 删末元素 → 画面必须变）。
   实测全仓搜不到等价物。它直接攻击"**画的是装饰，不是数据**"，
   而且**模型自己就能跑**（不需要人看图）。这是最强的原创点。
2. **教学法门禁可执行化**。两家都停在"叙事结构散文"：
   iart 写了规则但没有断言，HyperFrames 有断言但不管教学法。
   **把 Mayer 原则、提取练习、认知负荷变成可执行断言 —— 全行业最未产品化的一侧。**
3. **可测量内容深度表 + 门禁**作为 agent skill。
4. **一份源 → 可交互网页 + mp4 + 可断言帧**。HyperFrames 是 mp4 优先 + Studio；
   本 skill 的网页本身可交互、可嵌入、可 iframe。
5. **零 npm 依赖**。HyperFrames 要 `npx` + 账号；本 skill 只用 Node 内置 + CDP + ffmpeg。

---

## 五、教学法侧：5 条可落地的（带证据）

1. **段长门禁，补充 G9。**
   transient information effect 的证据变量是**段长**，不是"信息率"。
   做法：DSL 加 `hold(d)`（全静态、可重读），门禁要求**任意连续变化段 ≤ 8–10s，
   且每段至少一个 ≥ 1.2s 的静态可读帧**。G9 降为二级约束。
   → [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0959475212000369) ·
   [Cambridge Handbook ch.21](https://www.cambridge.org/core/books/cambridge-handbook-of-multimedia-learning/transient-information-principle-in-multimedia-learning/670D96C3B9520320CE558AA855A49EE9)

2. **Signaling 门禁（Mayer signaling principle）。**
   每个元素**首次出现必须伴随一个 signaling 动作**（spotlight / highlight / 箭头）。
   本 skill 有原语，缺"必须成对"。可断言：新元素出现的帧上存在 cue 层。

3. **Coherence 门禁（去装饰）。**
   每个视觉元素必须被旁白或脚本**引用**，未被引用的判 fail。
   纯静态分析即可，直接来自 coherence principle（排除 seductive details），
   且自然扩展 G11。

4. **Pre-training / 依赖门禁。**
   第 N 幕用到的概念必须已在 < N 幕引入。把"概念引入"做成一等事件。

5. **Prediction 门禁。**
   每 K 个概念至少一个 `quiz`，且 **quiz 必须出现在它所问对象的 `reveal` 之前**
   （predict-then-measure）。
   → [Ogan et al.](https://www.chrisharrison.net/amyogan/files/1197-ogan.pdf) ·
   [testing effect](https://link.springer.com/article/10.1007/s10758-024-09746-1)

**反面提醒：别把"自动 pause"当卖点。**
有研究在长视频里**没发现 pause 的收益**；证据支持的是**学习者自控的分段**，
不是自动停顿。本 skill 的 `pause` 动作 ≠ segmenting，两者要在文档里区分清楚。
→ [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0747563218300207)

---

## 六、相关论文（已核实标题与摘要）

| 论文 | 关键结论 |
|---|---|
| [TheoremExplainAgent](https://arxiv.org/abs/2502.19400) | 生成 **5 分钟以上**的 Manim 定理讲解视频。TheoremExplainBench：**240 个定理**、**5 个自动评分指标**；o3-mini 成功率 **93.8%**、总分 **0.77**。两条关键结论：① *"most of the videos produced exhibit minor issues with visual element layout"* —— **直接印证布局门禁的必要性**（本 skill 的 G2/G2b/G2d/G14 就是在防这个）；② *"multimodal explanations expose deeper reasoning flaws that text-based explanations fail to reveal"* —— 多模态讲解能暴露纯文本讲解**看不见的推理漏洞**，这是"为什么值得做动画讲解"最硬的论据 |
| [Manimator](https://arxiv.org/html/2507.14306v1) | LLM 把论文/自然语言 → 结构化场景描述 → Manim 代码。两阶段流水线（先描述、后生成代码）和本 skill 的"先大纲、后场景"一致；它明确承认**无用户反馈迭代** |

---

## 七、关于「确定性时间轴」是否已被做得更好

- **契约层面**：Remotion 和 HyperFrames 的确定性模型与本 skill 的 `render(t)` **本质相同**
  （帧是 t 的纯函数、乱序 seek 安全、禁墙钟/随机）。
- **成熟度**：HyperFrames 在管线（Docker / Lambda / golden 基线 / 40 个 skill）上
  **明显更成熟** —— 这块别硬拼。
- **本 skill 没有更差**：Motion Canvas 有 `waitUntil` 事件缝、Manim 没有 `seek(t)`，
  它们的确定性弱于本 skill。但 Remotion 靠**文档**约束纯函数，本 skill 靠**断言** ——
  这个差别比想象的小，因为 HyperFrames 也有断言。
- **唯一硬优势**：把确定性从**性质**升级成**可回归的验收门禁**，
  尤其是 G11 这种"攻击语义"的断言（不是"动没动"，而是"画的是不是数据"）。

**建议策略：渲染管线该采用就采用，门禁与教学法层自研 —— 那才是别人抄不走的部分。**

---

## 八、和相邻 skill 的分工（更新版）

| 你要什么 | 用哪个 |
|---|---|
| 工业级视频生产管线、分布式渲染、云配音 | **HyperFrames** |
| 数学/STEM 重公式的讲解动画 | **Manim**（+ `iart-ai/manim-skills`） |
| 脚本 / 分镜 / 叙事结构（不渲染） | **`iart-ai/explainer-video-skills`** |
| 有状态的多会话教学（MISSION / 学习记录 / 最近发展区） | **`teach`** |
| 原理机制讲清楚 + 可播可拖可导 + **可断言** | **本 skill** |
| 要成品 PPTX 人继续编辑 | `ppt-master` / `open-kimi-ppt` |
| 要网页幻灯片、重设计排版 | `frontend-slides` / `open-narrate` |

判断口诀：
**要工业产能 → HyperFrames；要数学原语 → Manim；要教学法与可断言 → 本 skill。**

---

## 九、核实记录（哪些是实测、哪些是转述）

写这份文档时有一条二手结论被实测推翻，记在这里以免以后再被误导：

| 结论 | 来源 | 核实结果 |
|---|---|---|
| "确定性时间轴 + 可导出 mp4 + agent skill 已被 HyperFrames 正面做掉" | 调研 agent | ✅ **成立**。53,109★、Apache-2.0、9,578 文件、40 个 `SKILL.md`、当天仍在更新 |
| "**像素断言门禁** 线上没人做成 skill，是你的差异化" | 调研 agent | ❌ **不成立**。拉 `checkTypes.ts` / `layoutAudit.ts` / `motionAudit.ts` 实测：它有 `text_occluded` + `coveredFraction`、`motion_off_frame`、`motion_out_of_order`、`liveness`、`verifyStaticPage`，覆盖了本 skill 的 G2/G3/G9/G2d/静态页检测，且遮挡是**连续比例**（比二元判定更可调） |
| "G11 扰动测试 找不到等价物" | 调研 agent | ✅ **成立**。全仓 9,578 个文件搜不到任何"改数据看画面变不变"的机制 |
| HyperFrames "21 个 skill" | 调研 agent | ⚠️ 实测是 **40 个** `SKILL.md`（含 registry/blocks 下的模板） |
| TheoremExplainBench 的 240 / 5 维 / 93.8% / 0.77 | 调研 agent | ✅ **成立**。直接读 arxiv 摘要逐项核对 |
| Manim 无 `seek(t)`、Motion Canvas 有 `waitUntil` 事件缝 | 调研 agent | ⚠️ **未独立核实**（未读两者源码），按二手处理。但这两条不影响任何决策 |

**教训**：调研 agent 的"某某没人做过"这类否定性断言最不可靠 ——
**必须自己拉源码搜一遍再下结论**。肯定性断言（"X 做了 Y"）通常可信，
否定性断言（"没人做 Z"）默认不可信。
