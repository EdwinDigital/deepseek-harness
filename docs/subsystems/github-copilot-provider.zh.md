# GitHub Copilot 提供方

[English](github-copilot-provider.md) | 中文

`github-copilot` 路由使用 pi-ai 的 GitHub Device OAuth 实现。[LLM 子系统](llm-streaming.zh.md)负责模型路由，[凭据子系统](credentials.zh.md)负责凭据记录与授权流程。本文说明这些插件如何共同支持该提供方。

## 插件职责

该实现扩展现有插件服务，不向 agent loop（智能体循环）加入提供方行为。

| 插件 | 职责 |
|---|---|
| [`dsh-llm`](../../packages/llm/llm/README.zh.md) | 将模型请求路由至已注册的适配器。 |
| [`dsh-llm-pi-ai`](../../packages/llm/llm-pi-ai/README.zh.md) | 注册模型路由与授权流程，将 GitHub 协议委托给 pi-ai，并适配其凭据存储。 |
| [`dsh-credentials`](../../packages/credentials/credentials/README.zh.md) | 持久化带作用域的凭据记录，并负责记录更新的串行化。 |
| [`dsh-authorization`](../../packages/credentials/authorization/README.zh.md) | 注册登录方式，将通知与提示路由到调用方，并在报告成功前确认凭据已提交。 |
| [`dsh-client-ui-settings-models`](../../packages/client/ui-settings-models/README.zh.md) | 配置提供方路由和模型目录，并为额外的提供方控件提供扩展 slot。 |

适配器负责提供方协议，授权独立于模型执行。注册使用 Cordis effect，并随插件卸载。`dsh-agent-loop` 中没有 GitHub 专用分支。

## 登录流程

1. pi-ai 插件注册 `llm-pi-ai/github-copilot` 授权流程，不依赖是否已经配置模型路由。
2. 调用方通过 `ctx.authorization.begin()` 启动流程，并传入 `oauth` 方式及其自身的交互回调。
3. 授权服务校验方式，并限制每个凭据键同时只有一个尝试。流程携带该尝试的取消信号执行 pi-ai 登录。
4. pi-ai 发出 GitHub 验证 URL 和用户代码，处理提示，交换已批准的设备代码，并通过 `credentialStoreFrom()` 写入凭据。
5. 授权服务只在观察到本次尝试中的凭据提交后报告 `authorized`。已配置的模型路由在后续请求中读取该存储凭据。

调用方接收通知、提示和授权结果，而不是已存储的 OAuth 授权数据。交互属于发起它的请求。尝试不可恢复：登录期间重新加载浏览器会放弃该尝试，用户必须重新开始。

## 凭据存储与刷新

适配器在 `llm-pi-ai/github-copilot` 处将 OAuth 授权数据保存为不透明的 `grant` 记录。提供方配置包含路由设置和可选的凭据引用，不包含 OAuth token。登录约定由 [pi-ai 包](../../packages/llm/llm-pi-ai/README.zh.md)定义。

每个 pi-ai 模型集合都使用同一个 Harness 凭据适配器。路由显式指定的 `apiKeyEnv` 覆盖值优先于已存储的登录状态。没有该覆盖值时，pi-ai 按需读取和刷新已存储的授权数据。

凭据刷新在 `ctx.credentials.modifyRecord()` 内执行，本地提供方在整个更新期间持有跨进程锁。[凭据存储文档](../../packages/credentials/credentials/README.zh.md)定义持久化和锁定的责任。

## 登出与失败行为

`ctx.authorization.cancel(key)` 撤回活动的尝试。登出通过 `ctx.credentials.deleteRecord(key)` 完成：它删除本地授权记录，但不会在 GitHub 端撤销授权。独立配置的凭据与该记录相互分离。

未知流程、不支持的方式和并发尝试会在新交互开始前失败。拒绝提示或撤回请求会以 `cancelled` 结束；网络、存储和提供方故障仍作为错误返回。授权服务会拒绝未提交凭据就返回的流程。

取消尝试和删除本地记录是两个独立操作。它们的生命周期规则由[授权包](../../packages/credentials/authorization/README.zh.md)定义。

## 架构评估

该提供方符合仓库的插件架构：

- 模型执行保留在 `ctx.llm` 上，交互式凭据获取使用 `ctx.authorization`；
- GitHub 协议和授权数据序列化仍由提供方持有，`ctx.credentials` 负责持久化和锁定；
- 授权调用方呈现提供方无关的通知与提示，不实现 GitHub 协议；
- OAuth 交互对模型不可见，不新增会话事件；
- API key 引用、已存储授权数据和提供方原生发现遵循适配器定义的优先级。

尝试仅存在于当前进程中，不能恢复。本地登出不会撤销签发方的访问授权。这些限制属于共享授权行为，不是 GitHub 专用例外。

## 验证归属

pi-ai 适配器、授权服务和凭据提供方分别维护协议适配、交互取消、提交确认、持久化和刷新锁定的测试。真实 GitHub 登录还需要有权限的账号；无密钥测试不能证明某个账号具有 Copilot 访问权限。