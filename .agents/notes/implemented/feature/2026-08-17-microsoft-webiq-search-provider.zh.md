# Agent Note: Microsoft Web IQ 搜索提供方

Status: implemented

[English](2026-08-17-microsoft-webiq-search-provider.md) | 中文

## 问题

网页能力只有一个面向模型的 `web_search` 工具和一个提供方注册表，但交付的 Web profile 只提供 DeepSeek 搜索提供方。希望使用 Microsoft Web IQ 的用户只能替换工具，或在常规提供方、设置和凭据生命周期之外组装集成。

提供方包还需要产品配置路径。API key 绝不能进入设置响应或浏览器包，而加入第二个可用提供方会让隐式选择产生歧义。当前 `dsh-web` 服务在启动时捕获配置的提供方，因此浏览器设置无法在不重启应用的情况下让下一次搜索选用 Web IQ。

## 决策

`@deepseek-ai/dsh-web-search-microsoft-webiq` 位于 `packages/web/web-search-microsoft-webiq/`。该包包含 Host 半包和浏览器半包：Host 半包在 `ctx.web` 中注册搜索提供方 `microsoft-webiq`，浏览器半包向 `settings.plugin.item` 贡献自己的卡片。agent（智能体）仍调用 `@deepseek-ai/dsh-tool-web` 提供的、与提供方无关的 `web_search` 工具；该包不注册 `webiq_search` 或其他面向模型的工具。

该包以可安装 profile 组合包的形式交付：manifest 声明 `dsh.bundle.patch`，因此 `dsh plugin --profile web add` 会记录依赖并追加本包自有的配置层。交付的组合不挂载任何 Web IQ 配置行，与 `packages/web/` 下其他需要凭据的搜索提供方一致。安装该包会注册 Web IQ，但不会替换选中的提供方：`web` seam 保持使用 `deepseek-official`，直到用户显式选择 Web IQ。未选择提供方的独立组合继续遵循现有 `ctx.web` 规则：只有一个可用提供方时自动选择；存在多个可用提供方时必须显式选择。

## 提供方约定

提供方使用 `x-apikey` 和 `content-type: application/json` 发送 `POST https://api.microsoft.ai/v3/search/web`。请求包含工具查询、限制在 Web IQ 协议上限 50 以内的结果数量、`contentFormat: "passage"`，以及可配置的语言、区域、最大段落长度和 SafeSearch 模式。该包在派发前校验 Web IQ 的 1,000 字符查询限制，并把调用方的 `AbortSignal` 传给 `fetch`。

每个 `webResults` 条目都把 `url`、`title` 和与查询相关的 `content` 映射为一个 `WebSearchSource`；非空 `crawledAt` 映射为 `publishedAt`，后者的现有约定允许提供方提供抓取时间戳。提供方报告 `truncated: false`；`ctx.web` 继续负责对返回的来源列表执行 `WebSearchRequest.maxResults` 限制。

响应解析器校验适配器使用的外部 JSON 字段。成功响应缺少 `webResults` 数组、结果条目格式错误、发生重定向、响应体无法解析或状态码非成功时，均产生 `WEB_PROVIDER_ERROR`。HTTP 诊断会在存在时使用 Web IQ 的 `userMessage`、`errorCode`、`retryAfter` 和 `traceId`，但不会暴露 API key。即使在凭据解析或响应解析期间发生，调用方取消仍产生 `WEB_ABORTED`。

提供方在操作入口只解析并快照一次全部选项。因此，在凭据解析或网络 I/O 进行期间提交的设置更新只影响下一次搜索，不会只改变当前搜索的一部分。

## 配置与选择

Host 插件拥有设置命名空间 `web-search-microsoft-webiq`。其 schema 包含：仅用于直接 Cordis 组合的字面量 secret（密钥）、默认指向 `WEBIQ_API_KEY` 的凭据引用、默认指向 Microsoft Web IQ Web Search URL 的端点、可选语言和区域、默认值为 5,000 的 `maxLength`，以及默认值为 `strict` 的 `safeSearch`。凭据解析先检查配置的字面量，再检查可选凭据服务，最后检查启动环境。缺少密钥时，搜索以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败，并只指出引用名称而不返回其值。

`@deepseek-ai/dsh-web` 为 `searchProvider` 和 `fetchProvider` 拥有设置命名空间 `web`。服务在执行时读取活动设置区段；未挂载设置服务时，回退到组合配置。现有环境变量仍作为字段缺失时的回退。因此，已提交的 `searchProvider` 变更无需中断正在执行的调用，也无需让 Settings 成为必需服务，就能控制下一次 `web_search` 调用。

## 浏览器配置

该包的浏览器半包只在 `settings.plugin.item` 存在时注册 Web IQ 卡片。顶部的开关用于为 `web_search` 选择 Web IQ；关闭时清除用户层覆盖，而不是指定另一个提供方，因此组合选定的提供方重新生效。其下，API 配置分组包含接口地址与 API 密钥，参数配置分组包含语言、地区、段落长度和安全搜索，底部单一命令同时提交两个所有者：密钥走凭据 RPC，其余写入设置命名空间。因为一条命令跨越两个所有者，卡片根据该命令自身的返回值保留凭据写入结果，而不依赖共享的“最后一次失败”标记——后者会被设置写入覆盖。凭据引用是 `cordis.yml` 中的部署选择，从不作为字段出现，因此配置该提供方不会要求用户填环境变量名。继承自启动环境的密钥是本进程唯一无法改写的一层，因此卡片禁用密码输入框并说明归哪一层所有，而不接受一次无法生效的写入。secret 字面量保持只写，每次加载后均为空白。

卡片监听 `credentials/updated`，并通过框架拥有的快照 hook 读取两个设置作用域。Host 未开放提供方命名空间时，卡片不渲染任何内容。卡片使用包内展示代码和主题 token；组件不会导入另一个客户端插件的组件，也不会访问客户端上下文。

Host 设置 API 显式开放 `web-search-microsoft-webiq` 和 `web`。必须修改该允许列表，因为插件注册设置命名空间不会自动向浏览器授予访问权限。

## 包集成

该包声明 `dsh.bundle.patch` 和 `dsh.client`，并生成 Host、invariant 和浏览器入口；它会加入 Host 与 Client TypeScript 聚合配置。CLI 依赖该包，使任何 profile 都能从安装位置解析它，而已安装的组合包层提供那一个 Host 配置行；客户端模块发现机制从该 Host 配置行加载浏览器半包，因此整个集成保留在一个包目录中。

包 README 记录配置、凭据优先级、选择行为、错误以及保持不变的模型体验。提供方测试覆盖请求构造、响应映射、格式错误响应、HTTP 诊断、缺失凭据和取消。浏览器测试覆盖凭据状态、只写密钥行为、默认选择、保存失败和 dispose（资源释放）。现有 `dsh-web` 测试覆盖 Settings 挂载、实时选择，以及 Settings 脱离后的回退。

## 考虑过的替代方案

**注册专用 `webiq_search` 工具。**不予采用，因为它会重复与提供方无关的 `web_search` schema 和展示逻辑，把提供方选择暴露给模型，并绕过 `ctx.web` 拥有的选择规则。

**使用 Web IQ MCP 服务器。**交付的网页能力不采用该方案，因为 MCP 工具仍会创建第二个面向模型的搜索工具，也不会参与 `ctx.web` 提供方选择。用户仍可独立组装 MCP 服务器，以使用 Web IQ 更广泛的图片、视频、新闻和 Browse 工具。

**把 Web IQ 字段放入现有 DeepSeek 卡片。**不予采用，因为这样会让一个中央客户端插件拥有另一个提供方的设置，也会使提供方包无法携带自己的 Host 和浏览器生命周期。

**安装后立即选择 Web IQ。**不予采用，因为安装不应静默改变现有部署的搜索后端。显式选择还可防止没有凭据的安装替换正在工作的提供方。

**把 Web IQ 作为基础组合配置行交付。**不予采用，因为那样未经安装就存在该配置行，而本包组合包层插入的同名 id 会与它冲突，使 `dsh plugin --profile web add` 无法使用。`packages/web/` 下其他需要凭据的提供方同样不在基础组合中。

**在保留于本工作区的同时，改用作者自有的 npm 作用域发布。**不予采用，因为单一 `@deepseek-ai/` 作用域是工具链强制的工作区不变量：发布家族发现与 npm 发布基线会对 `packages/` 下的其他作用域抛错，而许可证、cordis peer 和模块图门禁按该前缀筛选包，会静默停止覆盖该包。作者作用域属于树外插件仓库，而可安装组合包格式已支持这种分发；工作区内的归属由 manifest 的 `author` 字段承载。

**更改默认提供方后要求重启。**不予采用，因为系统本就按操作解析提供方。在同一位置读取由设置支持的提供方 ID，可以保留正在执行的调用，并让下一次操作采用已提交的选择。

## 验证

- `dsh-web` 聚焦套件通过 22 项测试，包括实时提供方选择和 Settings 脱离后的回退。
- Web IQ Host 套件通过 24 项无密钥测试，覆盖请求构造、协议限制、外部响应校验、凭据、取消、设置分层、生命周期和 invariant companion。真实 API 冒烟仍通过 `WEBIQ_API_KEY` 选择性启用。
- 浏览器控制器与卡片／注册套件通过 22 项测试，覆盖只写凭据、陈旧读取抑制、非敏感设置、默认选择、延迟插槽声明、失败草稿保留、URL 校验和资源释放。
- ApiProxy 的 32 项配置测试通过；`web` 与 `web-search-microsoft-webiq` 已开放，而任意 namespace 仍保持隐藏。基础 bundle 的两项组合测试通过，选中的提供方仍是 `deepseek-official`。
- Host、Client 和 Web 生产构建完成。无密钥插件配置 Playwright 文件通过 7 个场景，包括空密码控件和持久化的 Web IQ 显式选择；完整 GUI 套件通过 3,762 项测试，并保留 1 项既有跳过。

## 后果

一个浏览器卡片会写入两个设置命名空间和一项凭据，因此这些操作不具备原子性。控制器会在操作结束后重新读取每个所有者，保留 Host 未接受的值，并报告失败操作，而不会声称成功。

即使存在结果数量上限，Web IQ 段落仍可能很大。可配置且默认值为 5,000 的 `maxLength` 会在现有工具输出限制生效前约束每个来源。

可配置端点允许部署使用代理，也决定密钥被发送到何处。卡片会标识端点，端点必须使用 HTTPS，并且每次操作会在派发前通过一份快照绑定解析后的密钥和端点。

设置允许列表仍要求每个可配置插件都修改中央 Host。本实现保留该现有策略，没有为了加入一个提供方而重新设计设置开放权限。