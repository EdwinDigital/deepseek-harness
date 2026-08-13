# GitHub Copilot 提供方

[English](github-copilot-provider.md) | 中文

`github-copilot` 路由使用 pi-ai 的 GitHub Device OAuth 实现，以及 Harness 的 LLM、凭据、Host API 和 Web 客户端插件。本文说明这个组装后提供方的职责与生命周期。通用认证类型仍属于 [LLM 子系统](llm-streaming.md)，将提供方协议归属适配器的理由记录在[提供方 OAuth Agent Note](../../.agents/notes/implemented/feature/2026-08-14-llm-provider-oauth.md)中。

## 插件职责

该实现扩展现有插件服务，不向 agent loop（智能体循环）加入提供方行为。

| 插件 | 职责 |
|---|---|
| [`dsh-llm`](../../packages/llm/llm/README.md) | 在 `LlmAdapter` 上声明提供方中立的认证方式、状态、交互回调、登录和登出；`LlmRuntime` 将调用路由至为提供方注册的适配器。 |
| [`dsh-llm-pi-ai`](../../packages/llm/llm-pi-ai/README.md) | 在 `ctx.llm` 上注册 `github-copilot`，将登录、刷新、请求认证和登出委托给 pi-ai，并将 pi-ai 凭据接入 Harness 存储。 |
| [`dsh-credentials`](../../packages/credentials/credentials/README.md) | 通过 `ctx.credentials` 提供活动的 secret store（机密存储）；它持久化不透明值，不了解 GitHub 或 pi-ai 协议。 |
| [`dsh-host-apiproxy`](../../packages/host/apiproxy/README.md) | 通过类型化 unary RPC 公开通用 LLM 认证操作，并在 Host 中保存实时提示、取消状态和有界非机密进度。 |
| [`dsh-ui-settings-models`](../../packages/client/ui-settings-models/README.md) | 渲染提供方中立的操作、Device OAuth 代码和验证 URL、提示、取消、完成状态及登出。 |

该拆分符合 Harness capability（能力）模型：`dsh-llm` 是 Service Definition（服务定义），`dsh-llm-pi-ai` 是 Service Provider（服务提供者），ApiProxy 和模型设置是 Consumers（消费者）。提供方可通过 `ctx.llm` 替换；注册使用 Cordis effect，并随插件卸载。`dsh-agent-loop` 中没有 GitHub 专用分支。

## 登录流程

1. 模型设置为已注册路由和 `oauth` 方式启动 `llm.startAuth`。
2. ApiProxy 创建或复用该路由正在运行的操作，并使用 Host 持有的通知、提示和取消回调调用 `ctx.llm.providerLogin()`。
3. `LlmRuntime` 验证活动适配器声明了该方式，再分派至 `PiAiAdapter.login()`。
4. pi-ai 发出 GitHub 验证 URL 和用户代码，处理可能的提示，交换已批准的设备代码，并通过 `HarnessCredentialStore` 写入其规范 OAuth 凭据。
5. 操作运行期间，模型设置持续轮询。成功的终止状态会触发一次新的非机密认证状态读取，并使该路由可用。

浏览器会收到操作 id、状态、有界通知以及至多一个待处理提示。它不会收到 access token、refresh token 或序列化凭据。保留的操作使重新加载的页面可在 Host 进程仍存活时恢复运行中或已终止的流程；操作不会跨 Host 重启保留。

## 凭据存储与刷新

`HarnessCredentialStore` 从每个提供方路由派生一个确定性 `CredentialRef`，并通过活动的 `ctx.credentials` 提供方存储带版本的 JSON 文档。设置中包含提供方 profile，以及 API key 路由的凭据引用，但绝不包含 GitHub OAuth token。

每个 pi-ai `Models` 快照共享该存储。pi-ai 在提供方请求前读取凭据、检查过期状态、按需刷新，并在分派请求前持久化凭据轮换。已存储的 OAuth 凭据在登出前始终是权威认证来源；刷新失败不会回退到环境中的 API key。

`modify()` 和 `delete()` 在单个 Harness 进程内按提供方路由串行执行操作。共享的底层凭据提供方仍负责跨进程锁定。若它不提供该能力，两个 Harness 进程可能并发刷新，后续读取会观察最后完成的写入。

## 登出与失败行为

`llm.logout` 会取消正在运行的登录、拒绝所有待处理提示、将凭据删除委托给适配器，并移除保留的操作。后续请求需要重新登录，除非该路由另有独立配置的认证方式。

未知路由和不受支持的方式会在交互开始前失败。设备流程拒绝、过期、取消、网络失败、存储失败、损坏的已存储 JSON 和刷新失败都会作为提供方或凭据错误呈现，但不会返回 token。损坏的文档仍可通过登出删除。

ApiProxy 最多保留 32 条非机密通知，并且每个提供方只保留一个操作。启动新流程会替换该提供方已终止的操作，从而使 Host 内存以提供方数量为界。

## 架构评估

该提供方符合仓库的插件架构：

- 提供方认证扩展已注册的 `ctx.llm` 适配器，不引入 GitHub 服务，也不修改循环；
- GitHub 协议和凭据序列化仍由提供方持有，`ctx.credentials` 持有机密持久化；
- Host RPC 和 Web 设置只依赖提供方中立的 LLM 认证类型；
- OAuth 交互对模型不可见，因此不新增 session event；模型请求沿用既有的已记录提供方和模型 provenance（来源）信息；
- API key 适配器继承空认证方式，并保持既有行为。

明确保留的限制是进程内刷新串行化和进程内认证操作。它们不削弱插件替换能力，也不暴露机密，但多个进程共享同一凭据存储的部署需要底层提供方提供更强的锁定。

## 验证归属

存储解析、版本控制、串行化、删除和并发修改由 [`credential-store.spec.ts`](../../packages/llm/llm-pi-ai/tests/credential-store.spec.ts) 验证。适配器注册和提供方认证路由由 `dsh-llm` 与 `dsh-llm-pi-ai` 包测试验证。操作恢复、提示、取消、有界事件、登出和 wire validation（传输验证）由 ApiProxy 测试验证。模型设置测试覆盖 Device OAuth 渲染、轮询、页面恢复、提示响应、取消和登出。组装后的 Web 快照证明真实 profile 无需实时凭据即可公开提供方流程。