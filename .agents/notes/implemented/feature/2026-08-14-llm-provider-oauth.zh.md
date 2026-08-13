# Agent Note: LLM 提供方 OAuth 登录与刷新

Status: implemented

[English](2026-08-14-llm-provider-oauth.md) | 中文

## 问题

已安装的 pi-ai 提供方可以公布 OAuth 与静态模型目录，但提供方请求还需要持久登录、过期刷新、登出和重启恢复。把短期 access token 当作 API key 存储无法提供这些行为。OAuth 凭据必须保持机密，并发刷新必须串行化，浏览器绝不能收到 access token 或 refresh token。

提供方专用登录协议不属于通用 credentials 服务。该服务负责持久保存“引用到机密”的映射；LLM 适配器负责提供方认证行为。

## 决策

LLM 服务公开可选的提供方认证方法、非机密状态、使用调用方交互回调的登录和登出。可配置提供方条目声明其存活适配器支持的方法。不支持交互认证的适配器保留空默认实现。

pi-ai 适配器向每份不可变 `Models` 快照注入同一个 Harness-backed `CredentialStore`。从提供方路由派生出的确定性引用通过 `ctx.credentials` 保存一份带版本的 JSON 文档，其中包含 pi-ai 规范 OAuth 凭据。读取时完整解析并校验文档。`modify` 在写入前按提供方路由在进程内串行化更新；`delete` 删除机密。API-key 路由保留显式 `apiKeyEnv` 解析。

pi-ai 负责登录、过期检查、锁内刷新、凭据轮换、请求认证和登出。已存 OAuth 凭据在登出前始终是该提供方的认证来源；刷新失败时绝不回退到环境 API key。替换后的模型快照共享 credential store，但不共享可变 provider registry。

ApiProxy 把每次登录表示为有界 operation resource，包含稳定随机 id、状态、至多 32 条非机密通知和至多一个待回答 prompt。`startAuth` 复用该提供方正在运行的操作；`authOperation` 支持轮询和页面恢复；`respondAuth`、`cancelAuth` 与 `logout` 释放待处理回调。后续操作会替换该提供方保留的终态操作，使 Host 内存以提供方数量为界。token 绝不进入 operation view。

Web 模型设置渲染这套通用操作。GitHub Device OAuth 显示验证 URL 和用户代码，只在用户操作后打开 URL，只在操作运行时轮询，页面刷新后恢复当前操作，并提供取消和登出。只有非机密状态报告认证已配置时，OAuth 路由才计为可用。

## 失败与生命周期语义

未知提供方和不支持的方法在交互开始前失败。格式错误的存储文档以 credential-store 错误失败，并且仍可通过登出移除。设备流程被拒绝、过期、网络失败、存储失败和刷新失败会保留提供方错误文本，但不会记录或返回 token。取消会中止提供方工作并拒绝待回答 prompt；除非登录已经完成并存下替代凭据，pi-ai 会保留登录前凭据。

一个进程按提供方路由串行化 `CredentialStore.modify`，满足 pi-ai 的双重检查刷新协议。跨进程序列化仍由底层 credential provider 负责。若该 provider 不提供更强锁，两个共用同一个 home 的 Harness 进程可能重复刷新；每次完成的写入都是有效规范凭据，后续请求看到最后一个写入者。

## 考虑过的替代方案

**给 credentials 服务增加 OAuth 方法。** 不采用，因为设备流程、token 交换、刷新和模型可用性属于提供方行为。这样会迫使通用机密存储理解 GitHub 和 pi-ai 协议。

**增加 pi-ai 专用 Host RPC 方法。** 不采用，因为 Web 客户端会依赖一个适配器 namespace，而未来每个支持 OAuth 的适配器都需要新增一套协议。

**通过全局 Host 事件流转发登录。** 不采用，因为可恢复 operation resource 能承载同样的 prompt 和进度，却不扩大 forwarded-event allowlist。轮询仅在操作运行时存在，稳定 id 可在重连后恢复状态。

**只持久化 `COPILOT_GITHUB_TOKEN`。** 不采用，因为 Copilot access token 有效期短，没有提供方 OAuth 凭据和实现就无法刷新。

## 后果

浏览器可以完成提供方 Device OAuth 和登出，且不会收到 token。成功登录通过 `ctx.credentials` 持久化；新的 Harness 进程可以解析并刷新它。同一份过期凭据上的并发 `Models.getAuth()` 只在进程内执行一次刷新，并在分派前持久化轮换。API-key 提供方与显式 `apiKeyEnv` 路由保持原有行为。

通用 LLM 与 ApiProxy API 增加了公开的交互、operation 状态、轮询和取消约定。序列化 OAuth JSON 会增加 credential store 泄露的影响，但仍位于现有机密平面，不进入 settings 或 session log。Harness 依赖 pi-ai 维持 GitHub Device Flow 与 Copilot token 交换兼容性。

聚焦测试固定版本化存储校验、pi-ai 登录持久化、并发解析只刷新一次、Host 操作恢复与取消、fetch carrier schema，以及 Web 恢复运行中设备码操作。
