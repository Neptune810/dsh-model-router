# dsh-model-router

[English](README.md) | 中文

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：按每个步骤的形态设置
DeepSeek flash 模型的思考等级。模型本身从不改变——它只决定这一步该想多深。

host-only：没有前端 UI，不带客户端 bundle，后台静默生效。

## 路由表

| 步骤类别 | 判定依据 | 思考等级 | 底层标量 |
| --- | --- | --- | --- |
| `trivial` | 短步骤里的明确廉价意图（翻译、改名、格式化） | `off` | 关闭思考 |
| `standard` | 普通短请求，无工程线索 | `low` | ~50 |
| `engineering` | 工程线索 / 代码·diff·XML 结构 / 工具循环 | `high` | ~75 |
| `hard` | 密集工程简报，或任务内挣来的失败证据 | `high`（`allowMax` 时为 `max`） | ~75 / 100 |

`high` 是默认上限。V4.1-Flash 底层是一个 1–100 的标量，对外只暴露三个预设名；`high` 约等于 75，
正是公开曲线仍然陡峭的位置。再往上拉，输出 token 多花约 1.6–1.8 倍，换来的提升却很边际。

## 四条规则

1. **无棘轮。** 轮次深度默认不贡献任何分数（`scoring.turnPerPoint: 0`），工具调用按「当前任务」
   计数。长 agent 循环不会漂向最贵的档位——跑得久 ≠ 任务难。
2. **升级要证据。** 当前任务里累计 `escalateOnErrors` 个失败的工具结果，或同一个工具调用用相同
   参数重试 `escalateOnRepeats` 次，才升一档，每个任务最多升 `maxEscalations` 档。其它任何东西
   都不能抬高等级。
3. **`max` 是选项。** 除非打开 `allowMax`，auto 模式永远不会发出 `max`。这条在 effort 层面强制，
   就算有人在 `routes` 表里手写 `effort: max` 也会被压回来。
4. **手动选的 `max` 同样降级**（`demoteManualMax`），但只针对本插件管理的模型，别的模型一律不碰。
   打开 `allowMax` 会同时关掉这两个钳制。

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
    escalateOnErrors: 2   # 多少个失败工具结果升一档
    escalateOnRepeats: 3  # 同一工具同参数重试多少次升一档
    scoring:
      turnPerPoint: 0     # 想让长会话重新变重就调大（不推荐）
    routes:
      trivial:     { effort: off }
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
| `leaveImageSteps` | `true` | 带图步骤保持调用方模型 |
| `imagePolicy` | `keep` | 改成 `flash` 则带图步骤也路由（flash 有原生视觉） |
| `escalateOnErrors` | `2` | 失败证据阈值 |
| `escalateOnRepeats` | `3` | 重复调用阈值 |
| `maxEscalations` | `2` | 单任务最多升几档 |
| `carryUnresolved` | `true` | 未解决的失败是否带一档到下一个任务 |

## 安装

`dsh plugin` 是 pnpm 的前置封装，任何 pnpm 规格都能用：

```sh
dsh plugin --profile web add github:Neptune810/dsh-model-router
```

装完需要重启 `dsh web`。路由器的监听器在启动时注册，刷新页面不够。

## 运行要求

- Node 20 或更新。
- 已在 `@deepseek-ai/dsh` 0.1.5-rc.2 上验证。插件用到 `agent/request`、`agent/inbox/claimed`
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

36 个用例。`test/policy.test.js`（26 个）覆盖分类、无棘轮、max 不可达、证据升级、effort 钳制、
tool-result 错误解析；`test/plugin.test.js`（10 个）用 ctx/agent 替身驱动宿主接线——注册监听、
领取消息、逐步路由、把 pro 会话拉回 flash、降级手动选择的 max。

## 许可证

MIT
