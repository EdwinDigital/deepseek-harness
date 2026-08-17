# DeepSeek Harness 架构与 Loop 工程分析报告

> 分析对象：`deepseek-harness`（`dsh`），DeepSeek AI 开源的 Agent Harness，基于 vendored [Cordis](https://github.com/cordiverse/cordis) 插件框架。
> 分析日期：2026-08-14　｜　代码规模：**49 个包组 / 219 个 workspace 包**，其中 21 个 `tool-*` 工具包、31 个 `ui-*` 前端插件包。

---

## 0. 对比基线的界定

报告中的"原生 PI Agent"指**裸 LLM API 之上的最小 Agent 循环**——即以 `@earendil-works/pi-ai`（本仓库 `packages/llm/llm-pi-ai` 正是该库的适配器）之类的多厂商 SDK 为底座，直接写出的经典 ReAct 循环：

```ts
// 基线形态
const messages = [system, user]
while (true) {
  const res = await llm.chat({ messages, tools })
  messages.push(res.message)
  if (!res.message.tool_calls?.length) break
  for (const call of res.message.tool_calls) {
    messages.push({ role: 'tool', content: await runTool(call) })
  }
}
```

这个基线具备：流式输出、工具调用、多轮对话。它**不具备**：可重放的持久化、可拦截的扩展点、上下文压缩、并发与取消语义、沙箱与审批、子智能体、能力可替换。

本报告即沿着"从这个基线到 `dsh` 之间补了什么工程"这条线索展开。若"PI Agent"另有所指（如某个具体产品），第 6 章的**能力对照表**与第 4 章的**工程主题拆解**依然是可复用的评估维度。

---

## 1. 结论速览

| 维度 | 原生 Agent 循环 | DeepSeek Harness |
|---|---|---|
| 架构范式 | 单体函数 + 回调 | **一切皆插件**（Cordis DI 容器 + 可撤销 effect） |
| 状态载体 | 内存 `messages[]` 数组 | **只读追加事件日志（session log）**，`messages` 由日志投影而来 |
| 循环结构 | `while(toolCalls)` | **turn / step 双层状态机 + inbox 双队列** |
| 扩展方式 | 改源码 | 12+ 个具名 waterfall / serial 事件挂载点 |
| 上下文管理 | 无 / 简单截断 | 压缩（compaction）+ 溢写（spill）+ 保留（retention）+ 剪枝（prune）四层 |
| 并发 | 串行或 `Promise.all` | 按 `executionMode` 分组的**有界滚动池 + 屏障 + 模型序提交** |
| 取消 | `AbortController` 直穿 | 唤醒闩锁（wake latch）+ 排空 + 合成结果 + 幂等收敛 |
| 安全 | 无 | 沙箱 seam（Landlock/bwrap/Seatbelt/Windows ACL）+ 审批 + fs 意图门 |
| 多智能体 | 无 | 6 种 subagent provider + workflow 脚本引擎 |
| 交付形态 | 一个脚本 | profile/bundle 分层组合 + Web/CLI/ACP/SDK/JSON-RPC 五种入口 |
| 质量保障 | 单测 | 100% 逐文件覆盖率 + 无密钥快照重放 + 运行时不变量 + 20+ 仓库门禁 |

一句话概括：**`dsh` 把"Agent 循环"从一段控制流，重构成了一个带有持久化事件溯源、可替换能力接缝、可撤销插件效果的运行时。**

---

## 2. 架构底座：Cordis 与"一切皆插件"

### 2.1 没有特权内核

`dsh` 最反直觉的设计是：**模型适配器、工具注册表、会话日志、乃至 Agent 循环本身，全都是插件**（见 [docs/architecture.md](docs/architecture.md)）。

| 包 | 职责 | `ctx` 键 |
|---|---|---|
| `core/session` | 追加式 `SessionEvent` 日志 + 内存存储 | `ctx.sessions` |
| `core/system-prompt` | 提示段与工具 schema 装配 | `ctx.systemPrompt` |
| `core/tools` | 作用域工具注册表 + 受保护执行管线 | `ctx.tools` |
| `core/agent` | `Agent` 接口、活体注册表、`agent/*` 事件 | `ctx.agents` |
| `core/agent-loop` | **默认驱动实现**（可整体替换） | `ctx.agentLoop` |
| `core/scope` | 每 Agent 作用域注册原语 | 纯库 |
| `llm/llm` | 消息/流式词汇 + 适配器接缝 | `ctx.llm` |

因此"改行为"的默认路径不是 fork 循环，而是**在旁边挂一个插件**。仓库约定甚至把这条写死：*"Plugins, not loop changes: 改 `agent-loop` 必须同步更新 `docs/architecture.md`"*（[AGENTS.md](AGENTS.md)）。

### 2.2 注册即效果（Registrations are effects）

所有贡献都经由 `ctx.effect()` / `ctx.on()`，注册表的 `register()` 返回 disposer。插件卸载时，它注册过的工具、提示段、事件监听、服务全部原子回滚。这是"热插拔"与"自我修改"能成立的前提。

### 2.3 Profile / Bundle 三层组合

```
空条目表
  → 各 bundle 的 cordis.patch.yml（按 profile 声明顺序）
  → profile 自己的 cordis.patch.yml
  → home 级 ~/.dsh/cordis.patch.yml
  → --patch 命令行覆盖层
```

- **bundle** 是"配置行 + 代码"的分发格式：[`dsh-base`](packages/bundle/base)（模型/工具/持久化/沙箱/审批/凭据/遥测）、[`dsh-web-app`](packages/bundle/web-app)、[`dsh-headless`](packages/bundle/headless)。
- **profile** 是 Harness home 中的具名组合，可安装树外插件。
- `dsh --profile web --dump-config` 可在**不启动**的情况下打印最终插件树——任何一行都能被自己的 patch 替换。

> 工程价值：产品形态（Web / 无头 / ACP 自动化）不是 if-else 分支，而是**不同的配置层叠**。同一份 `core/*` 代码支撑五种交付入口。

---

## 3. Loop 工程：turn/step 状态机

这是相对基线改进最密集的部分。核心实现在 [packages/core/agent-loop/src/agent.ts](packages/core/agent-loop/src/agent.ts)。

### 3.1 双层生命周期

**step** = 一次模型请求 + 它触发的工具调用。
**turn** = 零个或多个 step，从首个输入被 claim 时开启，到"无事可欠"时关闭。

```text
turn/start
  claim: next-step 输入 + 一条 next-turn 队列消息
  组装 prompt sections + tool schemas
  → agent/pre-step (waterfall)        reject | enter(messages)
     被拒 / 首次 enter 被改写为空 → 关闭 turn，不花费任何 step
     step/start
     entered messages 落为 user/message
     从日志派生模型历史
     agent/request (waterfall) → llm/stream (waterfall) → assistant/chunk* → assistant/message
     tool/call* → tools/pre-execute → tools/execute → tools/post-execute → tool/result*
     step/end
     工具欠一次请求，或 next-step 有新输入 → claim → 下一个 step
  → agent/turn-stopping (serial)
turn/end
```

**关键差异**：turn/step 边界在执行**之前**就已落盘，因此崩溃后可从 turn 中途恢复；而基线循环的边界只存在于调用栈里。

### 3.2 Inbox 双队列：`next-turn` / `next-step`

[packages/core/agent/src/inbox.ts](packages/core/agent/src/inbox.ts) 把"用户输入"从函数参数升级成**可观测队列**：

- `next-turn`：普通提示，一个 turn 消费一条。
- `next-step`：**steering（转向）与注入上下文**，在 step 之间被 claim。

claim 操作本身发布 `agent/inbox/spliced` / `agent/inbox/claimed` 事件——消息在进入模型历史前一直可被追踪与撤回。

> 这解决了基线的一个真实痛点：用户在模型思考中途补充一句话，基线要么丢弃、要么等整轮结束、要么打断重来。`dsh` 的 step 级输入让补充**在下一次模型请求前无缝并入**，且不会产生一串空 turn（这正是双队列而非单队列的原因）。

`agent.inject()` 走同一条路：注入的上下文停在 inbox 里，直到另一条消息把驱动唤醒才生效。

### 3.3 取消语义：唤醒闩锁与排空

基线的取消通常是"抛 AbortError 然后祈祷"。`dsh` 定义了完整的收敛协议：

1. `cancel(cause, { keepInbox })`——**首因胜出**，`signal.reason` 携带结构化 `AgentCancelCause`。
2. **唤醒闩锁（wake latch）**：中止期间到达的唤醒型消息被 `wakeRequested = true` 闩住；驱动收敛到 idle 后，若消息仍在 inbox 则重放，若已被移除则抑制。这条防止了"取消后遗留一条永远不会被处理的排队消息"。
3. **在飞工具的排空**（[tool-calls.ts](packages/core/agent-loop/src/tool-calls.ts)）：
   - 停止新启动；
   - `Promise.allSettled` 等待已派发的工具落定；
   - 为**未启动**的调用按模型序补写合成结果 `TOOL_ABORTED_BEFORE_DISPATCH`——保证 `tool_calls` 与 `tool` 消息严格配对（否则下一次请求会被厂商 API 直接拒绝）；
   - 已落定调用的 `additionalContexts` 在返回前仍被接受进 next-step inbox。
4. **部分助手消息保留**：流式循环里每个 chunk 先落 `assistant/chunk` 再进装配器，中止时部分块照常成为可重放事实。

### 3.4 错误恢复：`agent/request-error` waterfall

```ts
if (finish.kind === 'error' || finish.kind === 'aborted') {
  const action = await dispatch.waterfall('agent/request-error', { turn, step, provider, failure, retryPolicy, signal }, ...)
  signal.throwIfAborted()          // 取消优先于重试
  if (action?.kind !== 'retry') throw new LlmError(...)
  continue                          // 重试：回到 buildRequest
}
```

这是一个**开放的恢复挂载点**，而非硬编码 `catch`：

- [`llm-retry`](packages/llm/llm-retry/src/index.ts) 挂上去做指数退避（`normal` 有限次 / `always` 无限次，带 jitter），并把 `llm/retry` 与 `llm/retry-started` 落成**持久事件**——重试历史可审计、可在 UI 显示、可被中断检测。
- [`compaction-basic`](packages/compaction/compaction-basic/src/index.ts) 也挂在同一个点上，专门处理"上下文溢出"错误：剪枝/摘要后返回 `{ kind: 'retry' }`，且**仅当替换代数（generation）真正推进时**才重试，否则保留原始错误——从机制上杜绝了"压缩没起作用却无限重试"的死循环。

### 3.5 流式：可重放的 chunk 词汇

[packages/llm/llm/src/types.ts](packages/llm/llm/src/types.ts) 定义了跨厂商归一的流式词汇：

```ts
type StreamChunk =
  | { type: 'block-start';      index, blockType }
  | { type: 'text-delta';       index, text }
  | { type: 'reasoning-delta';  index, text }          // 推理内容一等公民
  | { type: 'tool-call-delta';  index, id, name?, argumentsDelta }
  | { type: 'block-end';        index, block }          // 权威闭合
  | { type: 'usage';            usage }
  | { type: 'finish';           reason, replayState? }
```

[`BlockAssembler`](packages/llm/llm/src/assembler.ts) 处理**交错块**（按 index 归属）、**部分工具参数拼接**（累积 JSON 字符串）、**闭合后掉队 delta 的丢弃**（首次闭合胜出）。

适配器可能 throw、也可能发终止 finish chunk；`LlmRuntime` 把 throw **归一化**为终止 finish，使得驱动只需读 `assembler.finish`，永不处理流异常。这是"在边界两侧都遵守公开契约"的典型落地。

### 3.6 并发调度：模式分类 + 有界滚动池 + 模型序提交

基线要么串行、要么 `Promise.all` 全并发（会让 `write` 与 `read` 打架）。`dsh` 的调度器（[tool-calls.ts](packages/core/agent-loop/src/tool-calls.ts)）：

1. **分类**：逐调用解析 `ctx.tools.executionMode(exec).kind` → `parallel` | `exclusive`。
2. **贪心分组**：`parallel` 吞掉后续所有可并行调用；`exclusive` 单独成组，形成**屏障**。
3. **启动前重分类**：池填充时若遇到 `exclusive`，立即收束当前池、开新组——因为并发安全性可能依赖参数（`isConcurrencySafe(args)`）。
4. **有界滚动池**：`inFlight.size < maxParallelToolCalls`（默认 10），`Promise.race` 落定一个补一个。
5. **模型序提交**：`commitReady()` 严格按模型给出的调用顺序追加 `tool/result`，即便实际落定乱序。

> 为什么重要：模型序提交保证**同一份提示前缀在重放时逐字节一致**，这直接决定了厂商 prefix cache 的命中率——见 §5.2。

---

## 4. Harness 工程：围绕循环的十个子系统

### 4.1 会话日志与"模型可见 ⟺ 已记录"

这是全仓库最强的一条不变量（[AGENTS.md](AGENTS.md)、[docs/architecture.md](docs/architecture.md)）：

> **任何进入模型请求的内容，必须能从会话日志重建。**

落地方式：

- `Session` 是 seq 连续（`events[i].seq === i`）的追加式日志。
- 只有三类事件产生模型消息（[surface.ts](packages/core/session/src/surface.ts)）：`user/message`、`assistant/message`、`tool/result`。
- `deriveMessages()` 增量折叠 surface 节点为消息数组，结果 deep-freeze 后共享。
- 新增"模型可见输入"**必须**先扩展 `SessionEventMap` 再从日志渲染——没有旁路。
- `runtime-diagnostics/invariants` 在运行时**独立重建每次请求**并与实际发出的对比。

对比基线：基线的 `messages[]` 是过程性副作用的累积，任何一处 `messages.push()` 都可能引入不可重放的内容。`dsh` 把它变成了 CQRS 式的"事件溯源 + 投影"。

**Surface 替换机制**：压缩不是删除历史，而是追加一条带 `surfaceOp: { op: 'replace', start, end }` 的事件，并用 `sourceEventSeqs` 列出被遮蔽的全部来源 seq。原始事件永远在日志里（可审计、可导出、可 UI 回看），只是不再进入派生历史。`replaceGeneration` 计数器则用于缓存失效与"压缩是否真的推进了"的判定。

### 4.2 工具执行管线

[docs/tool-execution-pipeline.md](docs/tool-execution-pipeline.md) 定义的顺序（严格）：

```
tool/call 落盘 → tools/pre-execute (waterfall: hooks/权限/沙箱)
  → 单调 guards（只能降级，不能把 deny 升成 allow）
  → ctx.approval 一次性询问（缺席或不可应答 = deny，fail-closed）
  → tools/execute (around-dispatch: 超时/重试/度量，唯一可替换 signal 的层)
  → 工具 execute() 本体 → fs/write-intent | fs/edit-intent 门
  → tools/post-execute (waterfall: 接受/阻断/替换/追加上下文)
  → 注册表外层归一化（快照抛错 → isError）
  → ToolDefinition.finalizeContent（同步、仅内容）
  → tools/result（冻结的权威结果，只观察不修改）
  → tool/result 落盘 → 批次结算后 additionalContexts FIFO 注入
```

工程要点：

- **三个 waterfall 分工明确**：`pre` 决定能不能做，`execute` 包裹派发（超时/重试），`post` 修饰结果。策略跨工具族复用，工具本身不与任何策略服务耦合。
- **单调性**：`ctx.tools.guard()` 注册的守卫只能拒绝或弃权，无法把已拒绝的调用放行——避免"最后一个插件说了算"的安全塌陷。
- **结果结构化**：`{ isError: false, value, content, meta? } | { isError: true, error: { message, info } }`。`content` 面向模型，`meta` 面向持久化与 UI。
- **渲染意图是设计的一部分**（[presentation.ts](packages/core/tools/src/presentation.ts)）：`presentCall(args)` / `presentResult(args, result)` 是**纯函数**，卡片类型为 `generic | terminal | diff | search | read | web`。仓库约定要求新工具**在设计阶段就定 UI 意图**，而不是事后由前端猜。
- **作用域分层**：`agent.ctx.tools.register()` 注册的工具遮蔽同名全局工具；`restrict({ allow, deny })` 收窄可见集。这让"给某个 session 一套不同能力"成为配置而非分支。

### 4.3 上下文工程：四层防线

| 层 | 包 | 触发 | 机制 |
|---|---|---|---|
| **保留** | [`util/output-retention`](packages/util/output-retention) | 工具产出时 | `TextRetainer` / `ItemRetainer`：head/tail/headTail 预算截断，保 UTF-8 边界，输出 `{ truncated, omittedBytes }` |
| **溢写** | [`spill/spill-policy`](packages/spill/spill-policy) | `tools/post-execute`，超 `maxInlineBytes` | 全文存 `ctx.spillStore`（会话私有 0700 目录），模型只见 head/tail 预览 + `SpillRef` 检索提示 |
| **剪枝** | [`compaction-tool-result-pruner`](packages/compaction/compaction-tool-result-pruner) | 压缩前 | **无模型参与**、确定性的工具结果头尾保留；落 `compaction/prune` 影子事件 |
| **压缩** | [`compaction-basic`](packages/compaction/compaction-basic) | `agent/pre-step` 压力 / `agent/request-error` 溢出 | LLM 摘要替换历史区间 |

压缩的几个精细之处：

- **工具配对平衡守卫**（[tool-pairing.ts](packages/compaction/compaction/src/tool-pairing.ts)）：折叠 surface 节点跟踪未闭合的 tool-call 计数，**拒绝把 tool_call 与其 result 切开**的区间划分——这是压缩类实现最常见的线上事故来源。
- **摘要请求复用前缀**：摘要调用逐字重放已路由的请求前缀 + system prompt + tools + 前导消息，只在末尾追加压缩指令，从而**复用厂商 KV cache**；并打 `purpose: 'compaction'`（DeepSeek 适配器发 `x-deepseek-harness-compact: 1` 头）。
- **事务化**：`compaction/start` → `compaction/summary` → `user/message(replace)` → `compaction/end`，`start` 即持久锁；崩溃留下孤儿 `start` 可被检测。
- **失败即无损**：压缩失败不改变会话 surface，只在日志留痕。

### 4.4 System Prompt 装配

[`ctx.systemPrompt`](packages/core/system-prompt/src/index.ts) 把"拼字符串"变成注册表 + waterfall：

- `section(name, order, text | provider)`：有序提示段
- `context(name, order, ...)`：动态上下文（渲染为 user 角色的**持久快照**，而非隐形注入）
- `variable(name, ...)`：`{{var}}` 插值
- `tools(provider)`：工具 schema 提供者
- `system-prompt/assemble` waterfall：监听者可重排/替换/增删任意段；带 `complete: true` 的段替换全部段（人格/预设切换）

配套的上下文插件：

- [`agent-instructions`](packages/context/agent-instructions)：发现并加载 `AGENTS.md` / `CLAUDE.md`；并在 `read`/`write`/`edit` 触碰文件后**重新扫描并把新增/变更/删除的指令文件投影进 inbox**——项目规范随工作目录漂移而自动跟进。
- [`session-reference`](packages/context/session-reference)：跨会话快照作为 `<referenced-sessions>` 只读背景，带保留预算（默认 5 条）。
- [`time-context`](packages/context/time-context) / [`tmux-context`](packages/context/tmux-context)。
- [`skill`](packages/skill/skill)：**渐进式披露**——目录只给 name/description/whenToUse，`skill` 工具调用时才加载正文；多 provider 按 rank 竞争（bundled 600 / runtime 250 / project / user）。

### 4.5 请求头快照与前缀缓存稳定性

`request/header` 事件记录**完整的**调用配置 + system prompt + tool schemas 快照（reason: `initial` | `resume` | `change`，**不允许 delta 事件**——"整值事件规则"）。

带来的直接工程收益：

- header 不变时，跨 step 的前缀逐字节一致 → 厂商 prefix cache 持续命中；
- header 变化（压缩、提示变更、工具集变更、配置变更）时**恰好在 step 边界**产生一次可解释的缓存失效；
- Code Mode 生成的 SDK 段按字典序确定性排序，同样为缓存友好。

### 4.6 Code Mode：`run_code`

[packages/core/tools/src/code-mode.ts](packages/core/tools/src/code-mode.ts)。配置 `mode: 'native' | 'code' | 'both'`：

- `code` 模式下模型**只能看到 `run_code`**，其余能力以生成的 TypeScript/Python SDK 声明（`ToolArgsMap` / `ToolOutputMap` / `tools` 命名空间）出现在提示里。
- 程序体内 `await tools.read({...})` 的每次调用**重新进入完整的受保护工具管线**（携带父 token），落 `tool/code-dispatch-start` / `tool/code-dispatch` 事件对，拒绝以绑定级异常返回。
- 并发遵守原生契约：`isConcurrencySafe` 的调用最多 `maxParallelSubCalls`（默认 10）重叠，exclusive 独占。
- 只有 `logs` 与 `result` 回到模型上下文，且总量受 `maxOutputBytes` 限制。
- 运行时是接缝：[`code-runtime-worker-thread`](packages/code-runtime/code-runtime-worker-thread) 每次运行一个 worker 线程，取消时**先排空桥接队列再返回**。

> 解决的问题：多步骤工具编排在原生工具调用下需要 N 次模型往返（N 次 prefill + N 次上下文膨胀）。Code Mode 把编排逻辑下沉到一次代码执行，中间结果不进上下文——是当前上下文经济性最有效的手段之一。同时保留全部策略与审计（不是逃逸口）。

### 4.7 安全：沙箱 / 审批 / 文件系统门

**沙箱接缝**（[packages/sandbox/sandbox](packages/sandbox/sandbox)）：

- 词汇：`SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'`，策略层只能强制 `ConfinedSandboxMode`（前两者）。
- **诚实的执行度**：`SandboxEnforcement = 'full' | 'partial'`——旧 Landlock ABI、Windows ACL 的 ambient SID 缺口如实标记为 `partial`，而不是假装完全隔离。
- `confine(argv, policy)` 返回 `ConfinedArgv`，其中 `denialSignatures`（各后端被拒时的 stderr 特征串：bwrap 的 `EROFS`、Landlock 的 `EACCES`、Seatbelt 的 `EPERM`）与 `runnerFailureRules`（用于区分"命令被沙箱拒绝" vs "沙箱 runner 自己起不来"）是很少见的细致设计。
- 后端：Linux bwrap / Landlock（含 [`native/`](native) 的 `node-addon-landlock-run`）、macOS Seatbelt、[Windows 受限令牌 ACL](packages/sandbox/sandbox-windows-acl)。
- 策略按**每次调用**解析（`ctx.sandboxPolicy.resolve(request)`），不是固定在 provider 上。

**审批**（[packages/interaction/user-approval](packages/interaction/user-approval)）：

- 结果封闭枚举 `'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`，**`unavailable` 即拒绝**（fail-closed）。
- 策略 `'ask' | 'never'` 落 `approval/policy` 事件（last-one-wins，可折叠重建）。
- `approval/asked` / `approval/decided` 成对落盘，属**仅日志事件**——审批过程可审计，但不污染模型上下文。
- 请求体刻意不含工具参数，避免与 `tool/call` 重复存储。

**文件系统**（[packages/fs](packages/fs)）：`FsTarget`（稳定身份）/ `FsVersion`（读改写原子性）分离；`fs/write-intent`、`fs/edit-intent` 是单槽决策门；`fs/observed` 记录存在性观察，[`fs-observation-policy`](packages/fs/fs-observation-policy) 据此实现 **read-before-edit** 守卫——且该守卫位于 `tool-fs` **之下**的事件层，任何文件工具自动受益。

### 4.8 循环卫生（Loop Hygiene）

这是"Harness 与裸循环"差距最直观的一类功能：

| 包 | 解决的失败模式 |
|---|---|
| [`repeat-tool-reminder`](packages/guard/repeat-tool-reminder) | 模型连续重复同名同参调用。阈值 `[3, 5, 8]` 递进提醒，首次温和、后续附上工具名/次数/规范化参数预览；以 `additionalContexts` 注入并落成 plugin-sourced `user/message` |
| [`timeout-policy`](packages/guard/timeout-policy) | 工具挂死。around-dispatch 包裹 `exec.signal`，**只在自己的 deadline 触发时**才替换结果为 `TOOL_TIMEOUT`，不误吞外层超时 |
| [`plan-mode`](packages/plan/plan-mode) | 未经确认就动手。`plan/mode` 事件持久化，`exit_plan_mode` 需人类批准；策略提示段由部署方拥有 |
| [`tool-todo`](packages/todo/tool-todo) | 长任务失焦。`todo_write` 会话状态，`allowParallelInProgress` 是**必填无默认**的配置（强制部署方表态） |
| [`goal`](packages/goal/goal) | 目标漂移。创建/更新需人类根权限，完成/阻塞可接受当前轮次；blocked 下界默认 3 轮 |
| [`tool-ralph`](packages/workflow/tool-ralph) | 需要固定迭代的任务。每轮开一个全新结构化子代理，模型只能选目标与轮数上限 |

注意 `repeat-tool-reminder` 的设计取向：它**不阻断**，只注入提醒。这符合"守卫单调、策略可组合"的整体立场——阻断留给 guard 与审批。

### 4.9 多智能体：Subagent 接缝与 Workflow

**Subagent** 是具名多 provider 注册表（不同于 shell 的单执行器）：

| Provider | 形态 |
|---|---|
| `subagent-fork-in-process` | 同进程 fork 当前会话 |
| `subagent-spawn-in-process` | 同进程全新子代理 |
| `subagent-dsh-sdk` | 通过 JSON-RPC SDK 的外部 dsh |
| `subagent-acp` | 任意 ACP 兼容代理 |
| `subagent-claude-code` | 委派给 Claude Code |
| `subagent-codex` | 委派给 Codex |

两条路径：

- **one-shot**：`start(request)` → `SubagentRun { result, cancel }`，调用方只拥有结果。
- **continuable**：`startContinuable()` → `{ childId, messageId }`，**由 manager 而非 provider 组装子代理**；子会话持久化，进程内最多一个 Activation（`running` / `waiting` / `settled`），冷恢复用存储的 lineage seed。控制工具 `send_message` / `interrupt_agent` / `list_agents` 全局注册；`report` 仅在子代理作用域内可见并**豁免全局 `toolFilter`**。

深度用 `delegationDepthOf(session)` 逐级继承并双重设限（会话上限 + 请求上限），杜绝递归委派炸弹。

**Workflow**（[packages/workflow](packages/workflow)）：脚本引擎，全局暴露 `agent()`、`parallel()`、`pipeline()`、`phase()`、`log()`，跑在 worker 线程内的 VM 上下文。失败纪律清晰：`WorkflowError.fatal` 决定组合子是否重抛（配置错误、schema 违规、上限触顶为 fatal；子运行失败为逐项 `null`）。事件 `workflow/start|phase|log|agent-start|agent-end|end` 为纯观察事件，`end` **刻意不含返回值**（避免大对象污染日志）。

### 4.10 持久化、投影与可观测性

- **双后端**：[JSONL](packages/session/session-persistence-jsonl)（每会话一文件，第一行 header，可选 **Zstandard 帧压缩**，连续 `assistant/chunk` 打包为 `text-chunks` 行，无损且体积约 -60%）与 [SQLite](packages/session/session-persistence-sqlite)（单库、WAL、单调 `SCHEMA_VERSION`、0600 权限）。
- **写后合并**：[`SessionWriteBehind`](packages/session/session-persistence/src/write-behind.ts) 固定批延迟（默认 200ms）+ 静默屏障（`flush()` 并发调用合并为一个 barrier）。
- **语义检查点**：[`session-checkpoint-policy`](packages/session/session-checkpoint-policy) 在 `llm/stream` 派发前、`tools/execute` 顶层调用前、`agent/pre-step` 前强制落盘，**fail-closed**——检查点失败即阻止下游派发。这保证"模型看到的东西一定先在磁盘上"。
- **投影框架**：[`session-projection`](packages/session/session-projection) 的 `ProjectionDefinition { key, init, apply, view, stateVersion }` 是纯折叠；框架负责驱动、缓存（按 `replaceGeneration` 设水位）、变更馈送。[`session-projection-cache`](packages/session/session-projection-cache) 做持久检查点，冷读走"缓存行 → 持久化尾部 → registry 恢复 → 回写"阶梯，失败只是变慢不会错。
- **整值事件规则**：携带状态的事件必须携带**完整的变更后状态**，永不携带增量。这是让"任意 seq 处的快速折叠"与确定性重放同时成立的关键约束。
- **遥测**：[`session-telemetry-otel`](packages/session/session-telemetry-otel) 输出 OTel span；[`session-stats`](packages/session/session-stats)、[`token-meter`](packages/llm/token-meter)（区分 `uncachedInput / output / cacheRead / cacheWrite`，无 usage 时用字符启发式估算）。
- **查询**：[`session-query`](packages/session-query/session-query) + SQLite 后端 + 5 个只读模型可见工具（`session_search`、`session_trace`、`session_event_read/search/trace`），**每条结果都要用调用方会话的不可变工作区权限授权**。

### 4.11 互操作与生态

- **MCP**：[`mcp-client`](packages/mcp/mcp-client) 每实例连一个外部 MCP server，工具以 `mcp__<server>__<tool>` 命名空间注册；stdio / streamable-http；带重连退避与每工具超时。
- **Hooks 桥**：[`hook-protocol`](packages/hooks/hook-protocol) 提供 matcher 引擎与 stdin/exit-code/stdout 编解码；[`hooks-claude-code`](packages/hooks/hooks-claude-code) 直接读 Claude Code 的 `hooks.json`，[`hooks-codex`](packages/hooks/hooks-codex) 对应 Codex。**现有生态的 hook 配置可零改动迁移过来。**
- **ACP**：[`acp`](packages/acp/acp) 自动化专用 Agent Client Protocol server。
- **SDK**：[`sdk-protocol`](packages/sdk/protocol)（NDJSON JSON-RPC over stdio）+ [`sdk-server`](packages/sdk/server) + [`sdk-client`](packages/sdk/client)（`HarnessClient` 低阶 / `DeepSeekHarness` 高阶），另有 [`python/`](python) Python SDK。
- **E2B**：[`e2b`](packages/e2b) 共享远程沙箱句柄 + `fs-e2b` / `subprocess-e2b` 适配器。**因为 fs 与 subprocess 共用一个执行世界，把这两个 provider 指向远程，Bash / PTY / LSP 全部随之迁移，无需任何 provider 分叉**——这是能力接缝设计最有说服力的一次兑现。

### 4.12 自我修改

[`tool-cordis`](packages/extensions/tool-cordis) + [`cordis-host-runner`](packages/extensions/cordis-host-runner) + [`cordis-client-runner`](packages/extensions/cordis-client-runner)：模型可以 `cordis_inspect_*` 查看自己的运行时（已加载插件、服务、fiber、effect 链），`cordis_define` 写一个新插件、`cordis_run` 挂载到活体上下文（Host 半 + Client 半）、失败即 `cordis_stop` / `cordis_undefine` 卸载。新插件注册的工具**会立刻出现在模型可见集里**，并触发一次完整的 `request/header` 变更记录。

该工具包**刻意不在任何出厂配置树里**（`pnpm run demo:cordis` 才启用）——因为动态包代码直达真实运行时。这种"能力做出来但默认不装"的克制值得肯定。

---

## 5. 技术亮点深挖

### 5.1 Waterfall 语义作为一等扩展机制

`agent/pre-step`、`agent/request`、`llm/stream`、`tools/pre|execute|post-execute`、`system-prompt/assemble`、`agent/request-error` 都是 waterfall：**监听者必须调用 `next()` 才委派下去，直接返回即短路**。

这给了插件三种能力（在同一个 API 里）：观察、改写、拦截。对比基线中"要么加一个 if、要么加一个 callback 数组"的做法，waterfall 的组合性与可撤销性（每个监听是一个 effect）要强一个量级。

配套约定同样严谨：返回的 `agent/pre-step` 决策是**权威的**——包装 `next()` 的监听者若非有意替换，必须保留下游消息。

### 5.2 前缀缓存稳定性是被设计出来的，不是碰巧的

把这几条放在一起看，会发现是一个整体：

1. 工具结果按**模型序**提交（而非落定序）；
2. `request/header` 是**整值快照**，变更点恰在 step 边界；
3. Code Mode 的 SDK 段按**字典序**确定性生成；
4. 压缩摘要请求**逐字重放已路由前缀**；
5. 消息在日志里已冻结，派生时不做二次深拷贝。

结果：跨 step、跨压缩、跨重启，提示前缀都尽可能保持字节一致。对成本敏感的长会话，这是数量级的差异。

### 5.3 Typert：跨 Host/Client 的编译期 RPC 类型图

[packages/typert](packages/typert) 是全仓库最"重"的自研基础设施：

- Host 侧方法用 `@Remote` / `@RemoteScope` 装饰；
- 构建期（tsdown 插件）分析 `tsconfig.host.json` 的 `ts.Program`，校验签名约束（无泛型、具名参数、`AbortSignal` 必须最后），解析类型图（复杂入参需 `TypertLookupMap`，复杂返回需 `TypertContextMap`）；
- 生成 `typert.host.{js,d.ts}`（反射 + 描述符 + schema）与 `typert.remote-client.{js,d.ts}`（Client 安全声明 + 编解码器）+ **声明映射**（Client 侧点击方法可跳到 Host 实现）；
- Client 侧 `ctx.remote.<ns>.<method>()` 是**类型安全且运行时校验**的；
- 源码直跑模式（`node --import tsx/esm`）下生成器不运行，降级为装饰器 WeakMap 元数据 + 参数名解析的弱描述符，且**Client 永不接受弱描述符**。

这解决的是 Web Agent 产品的真实痛点：Host（Node）与 Client（浏览器）之间几十个方法的手写 proxy 与类型漂移。`api-remotes` 是全仓库**唯一**允许 Host/Client 双 tsconfig 分裂的包，边界被刻意压到了一个点上。

### 5.4 运行时不变量（Runtime Invariants）

[`packages/runtime-diagnostics/invariants`](packages/runtime-diagnostics/invariants) 提供 `ctx.invariants`，每个包导出 `./invariant` companion 注册自己的检查，各跑在子 fiber 里（失败即释放）。

仓库对"什么算合格的不变量"有明确规定（[packages/AGENTS.md](packages/AGENTS.md)）：

> 不变量断言**自己拥有的关系**，检查权威事件流或可变数据，**而不是**服务/方法是否存在、插件元数据、effect、或固定的纯例子。

最典型的一条：`dsh-agent-loop/invariant` **独立重建每一次请求**，把 messages 与折叠后的 header 字段与实际发出的请求比对——这是"模型可见 ⟺ 已记录"这条产品级不变量的**运行时执法者**，而不是靠 code review 维持。

### 5.5 品牌类型与显式化的边界纪律

几条约定叠加起来形成了很强的一致性：

- **跨边界不透明 id 一律 branded**（`Branded<B>`，`dsh-brand`），从不用裸 `string`；
- **在同进程强类型边界上信任 TypeScript**——不为静态类型已保证的值加运行时校验或敌意输入测试；只在 parser/config、队列、模型/工具 JSON、持久化/文件、worker、进程、wire 七类边界校验；
- **显式优于隐式**：默认值是所属实现里显式的 `resolve(request): Spec` 步骤，而非 `run()` 里藏一个 `?? default`；
- **插件里禁止硬编码可调参数**：随部署变化的选择必须是可从 `cordis.yml` 改的 `Config` 字段；`DEFAULT_*` 常量或测试钩子不算可配置；
- **配置错误必须大声失败**：能自包含判定的在加载期失败，否则在最早可解析点失败，绝不静默跳过缺失的引用。

这套纪律的收益在 219 个包的规模上才真正显现——它让"读一个陌生包"的成本大幅下降。

### 5.6 无密钥快照重放测试

[docs/testing.md](docs/testing.md) 定义的分层：

| 层 | 命令 | 说明 |
|---|---|---|
| 单元 | `pnpm run test` | vitest |
| 覆盖率门禁 | `pnpm run test:coverage` | **`packages/*/*/src` 逐文件 100%**（CI 阻断线） |
| 快照 | `pnpm run test:snapshot` | **无密钥** ACP/headless/CLI 重放 vs 期望产物 |
| 真实 API | `pnpm run test:e2e` | 无 `DEEPSEEK_API_KEY` 自跳过 |
| 浏览器 | `pnpm run test:web` | Chromium 渲染快照（Linux CI） |

关键在 [`llm-replay`](packages/test-support/llm-replay)：从录制的会话 JSONL 中重放模型 chunk，短路 `llm/stream`。于是**整条组装后的应用链路（ACP → 循环 → 工具 → 会话日志 → 输出）可以在没有 API key 的 CI 上逐字节验证**。配套 [`llm-mock-server`](packages/test-support/llm-mock-server) 做故障注入（超时、中断、错误码），[`loader-smoke`](packages/test-support/loader-smoke) 用子进程启真实示例验证配置组合，[`agent-loop-testkit`](packages/test-support/agent-loop-testkit) 统一挂载循环前置依赖。

仓库约定进一步要求：*"每个非平凡的模型可见或用户可见行为变更，必须在同一个 PR 里通过真实可运行示例新增/更新一个无密钥快照"*。这是把"端到端可复现"从口号变成了合并条件。

### 5.7 仓库门禁体系

[scripts/](scripts) 下的门禁调度器（`run-gates.ts`，按 CPU 核数有界并行）编排了 20+ 项检查，值得单独点名的几项：

- `verify-cordis-config`：`cordis.yml` 里的裸插件必须出现在解析清单的 `dependencies` 中；
- `verify-export-jsdoc`：每个公开导出必须有 JSDoc（函数类需 `@param`/`@returns`）；
- `verify-type-equiv`：文档中粘贴的类型声明必须与源码一致（防文档漂移）；
- `verify-doc-budgets`：文档**字数上限**清单（[scripts/doc-budgets.manifest.json](scripts/doc-budgets.manifest.json)）；
- `gen-tool-catalog`：**真实启动每个工具插件**读 `ctx.tools.schemas()` 生成 [docs/tool-catalog.md](docs/tool-catalog.md)，并有 glob 完备性守卫——新工具不可能被静默漏文档；
- `duplication`：跨文件 TypeScript 克隆检测；
- `hygiene`：knip（无用依赖）+ publint + workspace 约束 + NodeNext 消费者检查。

以及**流程层**的独特设计：`.agents/notes/` 的 Agent Notes 制度——非平凡变更必须在同一 PR 附带一份决策记录，已归档的 note 冻结不可编辑。仓库把"AI 协作者的上下文"也当作一等工程产物在治理。

---

## 6. 能力对照表

| 能力 | 原生 Agent 循环 | DeepSeek Harness | 对应实现 |
|---|---|---|---|
| 多轮对话 | ✅ 内存数组 | ✅ 事件日志投影 | `core/session` |
| 流式输出 | ✅ | ✅ 归一 chunk 词汇 + 可重放 | `llm/llm` |
| 推理内容 | ⚠️ 厂商各异 | ✅ `reasoning-delta` 一等公民 | `llm/llm` |
| 工具调用 | ✅ | ✅ 6 阶段管线 + 作用域注册表 | `core/tools` |
| 并行工具 | ⚠️ 全并发或串行 | ✅ 模式分类 + 有界池 + 屏障 + 模型序提交 | `agent-loop/tool-calls.ts` |
| 中途插话 | ❌ | ✅ step 级 inbox（steering） | `core/agent/inbox.ts` |
| 取消 | ⚠️ 尽力而为 | ✅ 闩锁 + 排空 + 合成结果 + 收敛 | `agent-loop/agent.ts` |
| 重试退避 | ⚠️ 手写 | ✅ 可插拔策略 + 持久重试事件 | `llm/llm-retry` |
| 上下文压缩 | ❌ | ✅ 压力 + 溢出双触发，配对守卫 | `compaction/*` |
| 大输出治理 | ❌ | ✅ 保留 / 溢写 / 剪枝三层 | `output-retention`, `spill/*` |
| 崩溃恢复 | ❌ | ✅ 追加日志 + 语义检查点 + fork/resume | `session-persistence/*` |
| 会话分叉 | ❌ | ✅ `ctx.sessions.fork()` | `core/session` |
| 沙箱 | ❌ | ✅ 四平台后端 + 诚实的 enforcement 标注 | `sandbox/*` |
| 人工审批 | ⚠️ 自己写 | ✅ fail-closed 接缝 + 审计事件 | `interaction/user-approval` |
| read-before-edit | ❌ | ✅ `fs/*` 事件层守卫 | `fs-observation-policy` |
| 子智能体 | ❌ | ✅ 6 provider + 深度限制 + 可续 | `subagent/*` |
| 工作流编排 | ❌ | ✅ worker 线程脚本引擎 | `workflow/*` |
| 后台任务 | ❌ | ✅ `ctx.jobs` + `job_*` 工具 | `jobs/*` |
| 循环卫生 | ❌ | ✅ 重复提醒 / 超时 / plan / todo / goal | `guard/*`, `plan`, `todo`, `goal` |
| 技能系统 | ❌ | ✅ 渐进披露 + 多 provider 排序 | `skill/*` |
| MCP | ⚠️ 需自接 | ✅ 命名空间化 + 重连 | `mcp/mcp-client` |
| Hooks 生态 | ❌ | ✅ Claude Code / Codex 配置直读 | `hooks/*` |
| Web UI | ❌ | ✅ 31 个 ui-* 插件 + 类型安全 RPC | `client/*`, `typert/*` |
| 远程执行 | ❌ | ✅ E2B（fs+subprocess 一起搬迁） | `e2b/*` |
| 自我修改 | ❌ | ✅ 运行时挂载模型编写的插件 | `extensions/tool-cordis` |
| 可观测性 | ⚠️ console.log | ✅ OTel + 统计 + 会话查询工具 | `session-telemetry-otel` 等 |
| 端到端测试 | ⚠️ 需真 key | ✅ **无密钥重放快照** | `test-support/llm-replay` |

---

## 7. 权衡与风险

客观地看，这些优势都有代价：

1. **认知成本高**。219 个包、Cordis 的 fiber/effect/waterfall 心智模型、七类校验边界的判定规则——新贡献者上手曲线陡峭。仓库用 `docs/`（含 cordis-primer / cordis-tutorial）、生成式目录、Agent Notes、skills 来对冲，但成本客观存在。

2. **对 Cordis 的强绑定**。虽然 vendored 并锁定 SHA（[vendor/README.md](vendor/README.md)），但架构的每一条主干（服务、效果、waterfall、Loader patch）都是 Cordis 语义。这不是可以轻易替换的依赖。

3. **间接层的调试代价**。一次工具调用要穿过 3 个 waterfall + 守卫 + 审批 + 归一化 + finalize + 通知。文档化的管线图（[docs/tool-execution-pipeline.md](docs/tool-execution-pipeline.md)）与运行时不变量缓解了这一点，但栈追踪的可读性必然不如基线。

4. **逐文件 100% 覆盖率的边际收益递减**。这条门禁会推动"为覆盖而写测试"。仓库用"测试描述行为而非正确性"的约定反制，但张力是真实的。

5. **前置声明未定型**。README 明确标注 developer preview，`SESSION_FORMAT_VERSION` 固定为 `0` 且**不作任何兼容承诺**，后端直接拒绝旧格式（AGENTS.md 的 "Pre-release stance: foundation over blast radius"）。这是刻意选择的策略——在首个 tag 之前优先要正确的地基——但意味着现在集成需要接受破坏性变更。

6. **`partial` 沙箱的真实边界**。Windows ACL 与旧 Landlock ABI 下的 `partial` 标注很诚实，但使用方需要真正理解它意味着什么，否则会产生虚假的安全感。

### 可能的改进方向

- [BENCHMARK.md](BENCHMARK.md) 目前只有"如何跑"的三行说明，**没有任何基线数字**。以这套架构的完成度，缺一份公开的 SWE-bench / Terminal-Bench 类结果与 token 经济性对比是明显的空白。
- 压缩策略目前是单一 `basic` 实现（阈值 0.8 / 保留比 0.16）；接缝已经在了，但缺少语义分层（如"保留全部决策、丢弃全部中间搜索"）之类的第二实现来验证接缝的表达力。
- 子智能体的**成本归属**（token 计入哪个会话、如何汇总展示）在文档中不够显式。

---

## 8. 结论

`dsh` 相对"原生 Agent 循环"的改进，可以归纳为**四次抽象跃迁**：

1. **从数组到日志**——`messages[]` 被替换为追加式事件日志 + 投影，并用运行时不变量强制"模型可见 ⟺ 已记录"。这是所有其他能力（重放、恢复、分叉、压缩、审计、无密钥测试）的共同地基。

2. **从控制流到状态机**——`while` 循环被替换为 turn/step 双层机 + inbox 双队列 + 收敛式取消，让"中途插话""崩溃恢复""干净取消"从难题变成默认行为。

3. **从 if-else 到能力接缝**——每个能力都拆成 Service Definition / Provider / Consumer 三角。收益在 E2B 那个例子上最明显：换两个 provider，Bash / PTY / LSP 整体迁移到远程沙箱，零 fork。

4. **从"一个 Agent"到"一个 Agent 运行时"**——profile/bundle 组合、Typert 类型化 RPC、31 个 UI 插件、5 种交付入口、6 种子代理后端、Claude Code / Codex / MCP / ACP 全生态互通，以及模型可以修改自身插件树的能力。

如果说裸循环回答的是"怎么让模型用上工具"，那么 `dsh` 回答的是"**怎么让一个 Agent 系统在多年演进中保持可替换、可审计、可恢复、可测试**"。它的工程重心不在 prompt 技巧，而在**把 Agent 的每一个隐式状态显式化、每一个隐式扩展点具名化、每一个隐式默认值配置化**。

对同类项目最值得借鉴的三条，按优先级：

1. **事件日志优先**——先把"模型看到的一切都必须先落盘"立成不变量，其余能力会自然长出来；
2. **waterfall 化的扩展点**——观察/改写/拦截统一在一个 API 里，且每个监听都是可撤销的 effect；
3. **无密钥快照重放**——把整条组装后的应用链路变成 CI 上可逐字节比对的产物，这是 Agent 类项目最难也最值钱的测试能力。

---

### 附：主要参考位置

| 主题 | 位置 |
|---|---|
| 架构总览 | [docs/architecture.md](docs/architecture.md) |
| 回合时序 | [docs/agent-lifecycle.md](docs/agent-lifecycle.md) |
| 工具管线 | [docs/tool-execution-pipeline.md](docs/tool-execution-pipeline.md) |
| 能力接缝图 | [docs/capability-seams.md](docs/capability-seams.md) |
| 事件生产/消费图 | [docs/event-producer-consumer.md](docs/event-producer-consumer.md) |
| 工具 schema 目录 | [docs/tool-catalog.md](docs/tool-catalog.md) |
| 配置目录 | [docs/config-catalog.md](docs/config-catalog.md) |
| 持久化目录 | [docs/persistence-catalog.md](docs/persistence-catalog.md) |
| 防御性模式 | [docs/defensive-patterns.md](docs/defensive-patterns.md) |
| 测试策略 | [docs/testing.md](docs/testing.md) |
| 仓库约定 | [AGENTS.md](AGENTS.md) / [packages/AGENTS.md](packages/AGENTS.md) |
| 决策记录 | [.agents/notes/](.agents/notes) |
