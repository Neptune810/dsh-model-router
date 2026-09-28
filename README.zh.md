# dsh-model-router

[English](README.md) | 中文

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：按每个步骤的形态设置
DeepSeek flash 模型的思考等级。模型本身从不改变——它只决定这一步该想多深。

host-only：没有前端 UI，不带客户端 bundle，后台静默生效。

## 路由表

| 步骤类别 | 判定依据 | 思考等级 | 底层标量 |
| --- | --- | --- | --- |
| `trivial` | 短步骤里的明确廉价意图（翻译、改名、格式化） | `low` | ~50 |
| `standard` | 普通短请求，无工程线索 | `low` | ~50 |
| `engineering` | 工程线索 / 代码·diff·XML 结构 / 工具循环 | `high` | ~75 |
| `hard` | 密集工程简报，或任务内挣来的失败证据 | `high`（`allowMax` 时为 `max`） | ~75 / 100 |

`high` 是默认上限。V4.1-Flash 底层是一个 1–100 的标量，对外只暴露三个预设名；`high` 约等于 75，
正是公开曲线仍然陡峭的位置。再往上拉，输出 token 多花约 1.6–1.8 倍，换来的提升却很边际。

## 授权模式、模型池与任务预设（v0.5）

`control` 决定插件能改什么。**手调永远优先**：你一动手，插件立即让位，直到你发下一条命令，或在
输入栏控件上点「重新接管」。

| 模式 | 控制范围 |
| --- | --- |
| `full` 全授权 | 模型 + 思考等级 |
| `effort` 思考等级模式 | 只调思考等级，模型听你的 |
| `model` 模型模式 | 只调模型，思考等级听你的 |

客户端半边注册在 `conversation.input.right` 列表槽——正好在**手选模型控件左边**——承载模式切换、
重新接管、任务类型选择、模型池与任务预设；它通过同源 `/model-router/*` 路由与宿主通信。

**模型池**：只有池里的模型会被选中。

```yaml
pool:
  - { id: deepseek-official/deepseek-flash, cost: 1, tier: cheap }
  - { id: deepseek-official/deepseek-v4-pro, cost: 8, tier: strong, maxPerTask: 3 }
  - { id: deepseek-official/deepseek-v4-flash-vision-exp, cost: 1, tags: [vision] }
  - { id: vendor-x/writer-pro, cost: 20, weights: { 小说续写: 95 } }
```

`tier: strong` 是困难步骤与证据升级时优先的档位；`cost` 参与 `scoring.costPenalty` 扣分；
`maxPerTask` 限制单个任务能用这个模型几步；一旦池中有模型带 `vision` 标签，带图步骤只在它们
之间选。

**任务预设**：自定义任务类型 + 规则 + 每模型权重。

```yaml
presets:
  小说续写:
    match: ["续写", "小说", "文风", "/chapter\\s+\\d+/i"]
    weights: { "vendor-x/writer-pro": 95, "deepseek-official/deepseek-v4-pro": 60 }
  代码重构:
    match: ["重构", "refactor", "架构"]
    weights: { "deepseek-official/deepseek-v4-pro": 90 }
```

在控件里手动选定的任务类型**优先于规则**；没选才走关键词规则（`classifier: rules`）。第三方模型用
自己的 effort 词表：插件向 provider 查询它支持哪些档位，取最接近的，模型完全不支持思考时就不发
effort 字段。

## 图片、会话信号、子 agent 与语义分类（v0.6.0）

**图片**：`imagePolicy: vision` 会把「带图任务」路由到视觉模型——池里带 `vision` 标签的模型，或
`visionModel` 显式指定的那个。图片是**任务级**的：下一条不带图的命令会回到普通档位。

**会话信号**：插件读取 DSH 的核心投影来细化判断。

| 信号 | 作用 |
| --- | --- |
| 当前 todo（`todos`） | 参与任务类型匹配——计划项比用户那句话更能说明这一步在做什么 |
| 上下文压力 | 超过 `signals.contextPressure`（0–1）时偏向廉价档 |
| token 总量 | 超过 `signals.sessionTokens`（0=关闭）时偏向廉价档 |
| `delegationDepth` | 子 agent 默认走廉价档（`subagent.preferCheap`） |

每个决策都会记录它看到的信号，所以 `/router` 和输入栏控件都能解释「为什么这么选」。

**`/router`**：打印当前授权模式、是否接管、模型池、任务类型、最近若干次决策以及本任务强档花费。

**语义分类**：`classifier: llm` 每轮做一次很小的模型调用挑预设（`classifierModel`、effort off、
`classifierTimeoutMs`），当轮缓存，任何失败都静默回落到关键词规则；默认仍是 `rules`。

## 五条规则

1. **无棘轮。** 轮次深度默认不贡献任何分数（`scoring.turnPerPoint: 0`），工具调用按「当前任务」
   计数。长 agent 循环不会漂向最贵的档位——跑得久 ≠ 任务难。
2. **升级要证据。** 当前任务里累计 `escalateOnErrors` 个失败的工具结果，或同一个工具调用用相同
   参数重试 `escalateOnRepeats` 次，才升一档，每个任务最多升 `maxEscalations` 档。其它任何东西
   都不能抬高等级。
3. **`max` 是选项。** 除非打开 `allowMax`，auto 模式永远不会发出 `max`。这条在 effort 层面强制，
   就算有人在 `routes` 表里手写 `effort: max` 也会被压回来。
4. **手动选的 `max` 同样降级**（`demoteManualMax`），但只针对本插件管理的模型，别的模型一律不碰。
   打开 `allowMax` 会同时关掉这两个钳制。
5. **思考必须一直开着。** `off` 不再是自动路由。DeepSeek Messages API 会拒绝这样的请求：开启思考
   时，历史里存在一条「关闭思考时产生的、带工具调用」的 assistant 消息（报
   `The content[].thinking in the thinking mode must be passed back to the API`）。廉价步骤照样可能
   调用工具，而同一任务的下一步就是 engineering 工具循环，于是「一步 off、下一步 high」直接让本轮
   失败。现在 `trivial` 走 `low`，任何配置或手动选择的 `off` 都会被抬到 `low`，除非打开
   `allowThinkingOff`。**补救：** 如果某个会话里已经存在这种「无思考的工具调用」消息（旧版本或手动选
   `off` 留下的），路由器会识别出来并让该会话保持 `off`（否则每一步都会失败），同时只提醒一次。想恢复
   思考就压缩该会话或新建会话。

任务边界取自 `agent/inbox/claimed`——那才是真正开启一件新工作的事件。上一个任务以未解决的失败
收尾时，下一个任务只继承「犹豫一档」，且只对 engineering / hard 生效。一句「翻译一下」不会继承
上一次的崩溃。

## 配置

配置写在该插件行里（profile 的 `cordis.patch.yml`）：

```yaml
- id: model-router
  config:
    mode: auto            # auto | off
    model: deepseek-flash
    allowMax: false       # true 时 auto 与手动选择都放开 max
    maxFallback: high     # allowMax 为 false 时 max 压回的目标
    allowThinkingOff: false # true 才重新允许 effort "off"（见规则 5：会打断工具循环）
    control: full         # full | effort | model —— 插件能改什么
    manualOverride:
      yieldOnManual: true        # 手调即让位
      resumeOnNextCommand: true  # 下一条命令自动恢复接管
    pool: []              # 模型池白名单；为空则沿用上面的单模型
    presets: {}           # 任务类型 -> { match: [...], weights: { 模型id: 0-100 } }
    scoring:
      costPenalty: 0.4    # 成本在评分里的扣分权重
    hysteresis:
      downAfter: 2        # 降档前需要连续几步没有证据
    imagePolicy: keep     # keep | vision —— 带图任务是否路由到视觉模型
    visionModel: null     # 显式视觉模型；不填则用池里带 vision 标签的
    signals:
      todos: true         # 当前 todo 参与任务类型匹配
      contextPressure: 0.75  # 上下文占用超过此比例时偏向廉价档（0 关闭）
      sessionTokens: 0    # 会话 token 超过此值时偏向廉价档（0 关闭）
    subagent:
      preferCheap: true   # 子 agent 默认走廉价档，除非预设权重更高
    classifier: rules     # rules | llm —— llm 每轮做一次小调用
    classifierModel: null # llm 分类用的模型（默认池里第一个）
    escalateOnErrors: 2   # 多少个失败工具结果升一档
    escalateOnRepeats: 3  # 同一工具同参数重试多少次升一档
    scoring:
      turnPerPoint: 0     # 想让长会话重新变重就调大（不推荐）
    routes:
      trivial:     { effort: low }   # 这里写 off 也会被抬到 low，除非 allowThinkingOff
      standard:    { effort: low }
      engineering: { effort: high }
      hard:        { effort: max }
```

环境变量 `DSH_MODEL_ROUTER=off|auto` 可在启动时覆盖 `mode`。

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `mode` | `auto` | `off` 时完全透传（手动 max 钳制除外） |
| `provider` | `deepseek-official` | 只管这一家 |
| `model` | `deepseek-flash` | 唯一被驱动的模型 |
| `familyPattern` | `^deepseek-(flash\|v4)` | 允许接管的会话模型；pro 会话会被拉回 flash |
| `allowMax` | `false` | max 是否可达 |
| `maxFallback` | `high` | max 被压回的目标 |
| `demoteManualMax` | `true` | 是否也降级手动选的 max |
| `allowThinkingOff` | `false` | 是否重新允许 `off`；只适合全程不思考的会话 |
| `control` | `full` | 插件能改什么：`full` / `effort` / `model` |
| `manualOverride.yieldOnManual` | `true` | 手调后是否让位 |
| `manualOverride.resumeOnNextCommand` | `true` | 下一条命令是否自动恢复 |
| `pool` | `[]` | `provider/model` 白名单，支持 `cost`/`tier`/`tags`/`weights`/`maxPerTask` |
| `presets` | `{}` | 任务类型：`match` 规则 + 每模型 `weights` |
| `scoring.costPenalty` | `0.4` | 成本扣分权重 |
| `hysteresis.downAfter` | `2` | 降档前的安静步数 |
| `classifier` | `rules` | `rules` 或 `llm`（每轮一次小调用，失败回落规则） |
| `classifierModel` | 池中第一个 | LLM 分类使用的模型 |
| `imagePolicy` | `keep` | `vision` 时带图任务路由到视觉模型 |
| `visionModel` | `null` | 显式视觉模型 id |
| `signals.todos` | `true` | 当前 todo 是否参与任务类型匹配 |
| `signals.contextPressure` | `0.75` | 超过该占用比例偏向廉价档 |
| `signals.sessionTokens` | `0` | 超过该 token 总量偏向廉价档 |
| `subagent.preferCheap` | `true` | 子 agent 是否优先廉价档 |
| `leaveImageSteps` | `true` | 带图步骤保持调用方模型 |
| `imagePolicy` | `keep` | 改成 `flash` 则带图步骤也路由（flash 有原生视觉） |
| `escalateOnErrors` | `2` | 失败证据阈值 |
| `escalateOnRepeats` | `3` | 重复调用阈值 |
| `maxEscalations` | `2` | 单任务最多升几档 |
| `carryUnresolved` | `true` | 未解决的失败是否带一档到下一个任务 |

## 安装

`dsh plugin` 是 pnpm 的前置封装，任何 pnpm 规格都能用。从 npm registry 装：

```sh
dsh plugin --profile web add @neptune810/dsh-model-router
```

或者直接从仓库装：

```sh
dsh plugin --profile web add github:Neptune810/dsh-model-router
```

装完需要重启 `dsh web`。路由器的监听器在启动时注册，刷新页面不够。

## 运行要求

- Node 20 或更新。
- 已在 `@deepseek-ai/dsh` 0.1.7-rc.2 上验证。插件用到 `agent/request`、`agent/inbox/claimed`
  与 `session.deriveMessages()`。没有声明 `engines.dsh` 范围，因此插件市场会保持该条目可见，
  而不是替它猜一个兼容性结论。

## 已知限制

- **host-only。** 没有客户端 bundle，浏览器界面里不会出现任何入口。
- **没有配置 schema。** 配置直接读 profile 补丁层（见上），不会在设置界面渲染成表单。这是有意
  为之：声明 schema 需要 import `@deepseek-ai/*` 包，而安装在 profile 旁的插件解析不到它们。
- 只处理 `deepseek-official` provider 与匹配 `familyPattern` 的模型。

## 测试

```sh
node --test
```

75 个用例。`test/policy.test.js`（30 个）覆盖分类、无棘轮、max 不可达、拒绝 `off`、
证据升级、effort 钳制、中毒历史检测与 tool-result 错误解析；`test/routing.test.js`（12 个）覆盖模型池、
预设权重、视觉过滤、`maxPerTask`、effort 词表映射与迟滞；`test/plugin.test.js`（14 个）用 ctx/agent 替身
驱动宿主接线；`test/modes.test.js`（14 个）覆盖三种模式、手调让位与接管、同源校验、池/预设编辑、手动指定
任务类型、第三方 effort 词表、视觉分流、子 agent 廉价策略、todo 驱动任务类型、上下文压力、`/router` 命令
与 LLM 语义分类；`test/client.test.js`（4 个）在 VM 里加载浏览器 bundle 并断言输入栏贡献。

## 许可证

MIT
