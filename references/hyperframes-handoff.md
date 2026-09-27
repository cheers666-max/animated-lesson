# 和 HyperFrames 的分工：只接门禁层，不接管线

> 这份文档回答一个问题：**既然 `heygen-com/hyperframes`（53k★，Apache-2.0）已经把
> 渲染管线做得比我们成熟，我们还要不要重写一遍？**
>
> 结论：**不要。** 我们只保留"门禁 + 教学法 + 确定性时间轴"这一层，
> 把它当作可以插到任何管线前面/后面的**质检器**。

---

## 一、先把两边的家底摆清楚

| | 本 skill（animated-lesson） | HyperFrames |
|---|---|---|
| 体量 | ~40 文件、零依赖、Node + 系统 Chrome | monorepo，TypeScript，40 个 `SKILL.md` |
| 渲染 | 自己的确定性时间轴 + ffmpeg 管道 | Docker / Lambda / 分布式渲染 / golden baseline |
| 素材 | 手写场景 DSL（10 种元素、11 个动作） | frame-presets + 每帧一个 sub-agent |
| 音频 | 无（成片静音，字幕是唯一旁白通道） | `/media-use` 接 BGM/SFX（**要 HeyGen 账号**） |
| 断言 | **31 项门禁**，含 G11 扰动测试、G15 节奏、G16 焦点、G17 一致、G19 送答案 | `check` 支持 `samples/at/atTransitions/maxIssues/tolerance/contrast/snapshots/captionZone/frameCheck/layout`，issue code 含 `text_occluded`（**带 `coveredFraction` 连续遮挡比例**）、`motion_selector_missing`、`motion_appears_late`、`motion_out_of_order`、`motion_off_frame`、`liveness`，还有静态页冒充检测 |
| 教学法 | **可执行**（门禁断言） | 无 |
| 依赖 | 无 | `npx` + HeyGen 账号（`/media-use`） |

**要诚实**：HyperFrames 的断言层**不比我们弱**，某些地方更细 ——
它的遮挡是**连续比例**（`coveredFraction`，默认 floor 0.15），我们 G2d 是二值；
它有 `motion_off_frame`、`liveness`、静态页检测，和我们 G2/G3 同级。
（这一条是被打脸后改正的：最初以为"像素断言门禁线上没人做成 skill"，
读了 `layoutAudit.ts` / `motionAudit.ts` / `verifyStaticPage.ts` 才发现是错的。
见 `landscape.md` §九 核实记录。）

---

## 二、我们真正的差异化（自己搜源码验证过）

只有两条，但都是硬差异：

1. **G11 扰动测试** —— 搜遍对方 9,578 个文件，**没有任何等价物**。
   我们做的事：把元素声明的 `data` 数值 ×1.6（或结构扰动：数组删最后一项），
   画面**必须跟着变**。不变 = 画的是装饰不是数据。
   这一条上线时把元课件 7 块画布**全部**判为"无法证明承载信息"。

2. **教学法门禁的可执行化** —— 两边各缺一半，我们是那个交叉点：
   - HyperFrames：有强断言，但断言里没有一条关于"教学"
   - iart `explainer-video`：有量化叙事弧（Problem ~20% → Solution ~15% → How → Payoff）、
     "The VO is the spine"、每原语的时长/缓动，但**全是 prose，没有断言**
   - 我们：把 Mayer 的 segmenting / signaling / coherence / retrieval 变成了
     G15 家族 / G16 / G17 / G19 + `meta.oneLine` + `beat` 时长占比

---

## 三、如果要把两边接起来（三条路径，按侵入性排序）

### 路径 A：把本 skill 当 HyperFrames 的**前置质检器**（推荐，零改动）

```
Markdown / 大纲
   ↓  from-md.mjs            ← 产出可过门禁的场景骨架
   ↓  lint-scenes.mjs        ← 静态：确定性 / 安全区 / 叙事结构 / 内容深度
   ↓  verify.mjs             ← 浏览器 31 项门禁（含 G11 扰动、G15 节奏、G19 送答案）
   ↓  ??? 出片
```

出片这一段**可以换成任何东西** —— HyperFrames、Manim、Remotion、甚至手工剪辑。
门禁只看**渲染出来的帧**，不关心谁渲染的。

代价：`verify.mjs` 需要能加载页面。如果要验 HyperFrames 的产物，
需要把它的 `check` 输入（HTML + CSS 选择器）适配成我们的探针接口。

### 路径 B：只用我们的**教学法层**，套在 HyperFrames 的 `check` 上

我们的教学法门禁有一半是**纯数据的**，不依赖浏览器：

- `meta.oneLine` 必填
- 每幕 `beat` + 至少一幕 `boundary` + 节拍时长占比 ∈ [8%, 50%]
- 叙事弧的时长预算（Problem ~20% / Solution ~15% / How / Payoff）

这些可以直接变成 HyperFrames 某个 `SKILL.md` 里的 `check` 规则。
**这是把教学法带到 53k★ 项目里的最短路径**，而且不需要我们维护渲染管线。

### 路径 C：抄 HyperFrames 的编排模型（不改代码，改工作流）

它的 Step 0→6 编排（setup → brief → design system → storyboard/script → audio →
visual → frames → render，每步一道 gate，0/3/6 由用户确认）有两个东西值得直接搬：

- **`BRIEF.md`** —— 持久的意图文档。我们的对应物是 `meta.oneLine` + `PROVENANCE`，
  但它是**散在两处**的；`BRIEF.md` 是"这份课件为什么存在"的单一出处。
- **`frame.md`** —— 把设计系统**反译成视频语言**（颜色→情绪、字号→层级、间距→节奏）。
  我们的 `meta.theme` + `scene.css` 的三个主题只做到了"给 token"，没做到"给意图"。

---

## 四、明确不做的事

| 不做 | 为什么 |
|---|---|
| 重写渲染管线（Docker / Lambda / 分布式） | 别人做得更成熟，且我们的场景是"几十秒到几分钟的课件"，不是批量出片 |
| 接 `npx` 依赖 | 零依赖是本 skill 的硬约束（`engine/` 全部手写，验证器用 Node 内置 `WebSocket` + CDP）。引入 HeyGen 账号会把它变成云服务 |
| 抄 40 个 `SKILL.md` 的规模 | 我们有 31 项门禁 + 7 份课件，规模小是特性不是缺陷 |
| 做音频/VO | 成片静音 + 烘焙字幕是我们的取舍：**视频没有音轨，字幕是唯一旁白通道**（G12 会量像素验证它真的在） |
| 做时间轴编辑器 UI | 编辑器和"确定性时间轴"是两种产品。我们的编辑体验是**场景文件 + 门禁报错** |

---

## 五、一句话结论

> **别在渲染管线上竞争，那已经有人做得更好。
> 占住"门禁 + 教学法 + 确定性时间轴"这一层 ——
> 它是 HyperFrames 太大而不做、iart 太小而做不了的那个交叉点。**

---

## 参考

- `landscape.md` —— 完整的版图调研、实测数据、三类清单、核实记录
- `authoring-gates.md` —— 31 项门禁的逐条说明
- `ppt-bridge.md` —— 为什么**不做**另一个 PPT 生成器（同一个判断的另一面）
