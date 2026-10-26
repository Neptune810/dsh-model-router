# test/fixtures — 合成宿主事件与路由决策样本

本目录是 **0.15 回放/评测**（replay + offline evaluation）与端到端冒烟测试的数据基线。
所有数据都是**合成/脱敏**的：没有任何真实用户 prompt、文件路径、密钥或 provider 响应原文。
文本一律替换为占位短语（如 `"<prompt:refactor-3-files>"`），token 计数是构造值而非实测值。

## 文件

| 文件 | 内容 | 消费者 |
|---|---|---|
| `host-events.json` | 宿主（DSH 0.1.7-rc.2）事件样本：`agent/request` 的消息摘要、`assistant/message` + `usage`、`agent/request-error` 的 TRANSPORT/SERVER/TIMEOUT 三种、`tool/result` isError、`turn/end` completed/error/aborted，以及 `llm/retry`/`llm/retry-started` | 0.15 replay harness、classifier/effort 回归测试 |
| `decisions.sample.jsonl` | 108 条 router decision 记录（JSON Lines，一行一条），覆盖 4 个 class × 4 档 effort、多 provider/model、clamp/poisoned/carry/escalation/cross/frugal/image 等 reason | 面板/统计脚本、`/state.decisions` 形状回归、遥测 schema |
| `fake-host.mjs` | 冒烟测试用的假宿主（独立进程，`FAKE_HOST_SERVE=1 node test/fixtures/fake-host.mjs <mode>`，`PORT=0` 时在 stdout 打印 `{"port":N}`；**无 `FAKE_HOST_SERVE=1` 时是空操作**——Node 的测试运行器会把 `test/` 下每个 `*.mjs` 当测试文件执行，否则裸 `node --test` 会被它挂住）：6 种模式 `healthy`/`no-token`/`auth-refuse`/`no-decisions`/`open-control`/`missing-route`，只实现 `GET /state` 与 `POST /control`、`POST /resume` | `test/smoke.test.js`（冒烟脚本自身的端到端测试） |
| `README.md` | 本文件：来源、字段依据、更新规则 | 维护者 |

## 字段依据（证据优先，勿凭记忆改字段名）

**宿主事件**（`host-events.json` 的 `contract` 字段逐条指向出处）：

- `agent/request` / `agent/request-error` / `agent/pre-step`：`@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts:304-356`；
  `RequestErrorAction = { kind: 'retry' } | undefined` 见 `:100-103`；`PreStepDecision` 见 `:92-99`。
- `LlmFailure`（`message`/`code`/`status?`/`providerRetryAfterMs?`/`requestId?`/`offloadImages?`）：
  `@deepseek-ai/dsh-llm/lib/types/types.d.ts:25-44`。
- `TokenUsage`（`inputTokens`/`outputTokens`/`totalTokens?`/`cacheReadTokens?`/`cacheWriteTokens?`/`reasoningTokens?`）：
  `@deepseek-ai/dsh-llm/lib/types/types.d.ts:152-174`。**三桶互斥**：`billed input = inputTokens + cacheReadTokens + cacheWriteTokens`。
- `assistant/message`（含 `usage`，`interrupted?: true`）与 `assistant/attempt`（失败但未产出 surface 消息的尝试）：
  `@deepseek-ai/dsh-session/lib/types/types.d.ts:320-348`。
- `tool/call` / `tool/result`（`error?: {name,code,reason?}` 仅在 `message.isError === true` 时出现）：
  同上 `:349-388`。
- `turn/start`/`turn/end`/`step/start`/`step/end` 与 `TurnEndReasonMap`（`completed`/`aborted`/`blocked`/`error`/`max-tokens`/`interrupted`/`forked`）：
  同上 `:255-286`、`:162-210`。
- `llm/retry` / `llm/retry-started`：`@deepseek-ai/dsh-llm-retry/lib/index.js:141`、`:143`（该插件是官方 retry 参考实现）。
- 完整契约与行号索引见 `C:/DSH/routing-plan-2026-10/research/03-platform-capabilities.md` 的 §4.1–§4.5。

**路由决策**（`decisions.sample.jsonl`）字段来自 0.14.3 实际写入口：

- `lib/index.js:688-692` `record(state, payload, decision)` → 行内固定注入 `turn`、`step`，其余来自 `decision`；
- `lib/index.js:922-938` 调用点给出 `decision` 的完整形状：
  `scope` / `provider` / `model` / `effort`(可为 null) / `stepClass` / `score` / `preset`(可为 null) / `reason`(逗号拼接字符串) /
  `signals: { frugal, pressure(两位小数或 null), sessionTokens, depth, todo(≤80 字符或 null) }`。
- `/state` 读法：`lib/index.js:999` `decisions: state ? state.decisions : []`；上限 `DECISION_LOG_LIMIT`（`lib/index.js:71` 附近）。
- 4 个 class：`lib/policy.js:63` `STEP_CLASSES = ["trivial","standard","engineering","hard"]`。
- 4 档 effort：`lib/policy.js:52` `EFFORTS = ["off","low","high","max"]`；`EFFORT_POINTS` `:60`。
- clamp 文案：`lib/policy.js:458-462` `"max is opt-in; fell back to " + fallback`。
- escalation/carry 文案：`lib/policy.js:497-506` `"escalated on evidence"` / `"carried from unresolved failure"`。
- poisoned 文案：`lib/index.js:790-800` `"history already contains a tool call without thinking"`。
- cross 文案：`lib/index.js:731` `"cross-provider switch to <id> awaits confirmation"`；`:739` `allowed once`。
- 无可用模型：`lib/index.js:776` `"no eligible pool model; keeping the session route"`。
- 图像步：`lib/index.js:755` `"image step -> vision model"`；frugal：`:743` `"frugal signal (...)"`；任务类型：`:742`。

## 更新规则

1. **只在宿主契约或 decision 记录字段变化时更新**：先跑 `node --test test/smoke.test.js` 与 `node --test`，再改 fixture；改字段必须在 commit message 里引用新的 `file:line`。
2. **字段名大小写敏感、不可自创**：例如 decision 用 `stepClass` 而非 `class`、effort 为空时是 `null` 而非 `"default"`（logger 里的 `default` 只用于日志）。
3. **计数保持**：`decisions.sample.jsonl` 至少 100 行；新增 class/effort/provider 组合时**追加**，不要重排已有行（replay 断言依赖稳定顺序）。
4. **禁止真实数据**：不得把真实 session 日志、prompt、用户名、绝对路径写进来；如需真实样本，先脱敏并在此说明来源会话 id 的哈希。
5. `host-events.json` 顶层 `schemaVersion` 变化时，同步更新 0.15 replay harness 里按版本分支的读取逻辑（`scripts/smoke.mjs` 不读 fixture，它断言的是**运行中宿主**的 `/state` 实时字段）。

## 冒烟测试（`scripts/smoke.mjs` + `test/smoke.test.js`）

```sh
node scripts/smoke.mjs --help                 # 用法，退出码 0，不联网
node scripts/smoke.mjs --check                # 装完新版后确认插件已加载 + 伪 token 被拒
node scripts/smoke.mjs                        # 端到端：S1 /state 形状、S2 两次轮询 decisions、S3 control+resume
node --test test/smoke.test.js                # 脚本自测：假宿主 6 种模式，spawnSync 驱动，跨平台
```

- 环境变量：`ROUTER_BASE`（默认 `http://127.0.0.1:49832`）、`ROUTER_SESSION_ID`、`SMOKE_TOKEN`、`SMOKE_ALLOW_NO_TOKEN=1`（宿主设了 `DSH_MODEL_ROUTER_NO_TOKEN=1` 时 `/state` 不含 `clientToken`，只 WARN 不 FAIL）、`SMOKE_TIMEOUT_MS`。
- 分级：`PASS`/`WARN`/`SKIP`/`FAIL`，只有 FAIL 让退出码为 1；末行 `RESULT PASS n  WARN n  SKIP n  FAIL n`。
- S3 会 POST `/control {control:"full"}` 再 `/resume`，**结尾会恢复**它看到的 control scope（`effort`/`model` 可恢复，`full`/`null` 直接 SKIP）。`--check` 只发一次必被拒绝的伪 token 请求，不改状态。
- 已知非缺陷：0.14.3 的 `api.resume()` 只重新接管（`engaged=true`）而不改 scope，所以 S3 在 resume 后看到 `effectiveControl` 仍是上一步的值时给 WARN 而非 FAIL。
