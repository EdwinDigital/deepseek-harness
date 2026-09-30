# Agent Note: Microsoft Web IQ 搜索提供方

Status: implemented

[English](2026-08-17-microsoft-webiq-search-provider.md) | 中文

## 问题

web 能力有一个面向模型的 `web_search` 工具和一个提供方注册表，但发布的 Web profile 只提供 DeepSeek 搜索提供方。想使用 Microsoft Web IQ 的用户只能替换该工具，或在正常的提供方、设置与凭据生命周期之外自行拼装集成。

提供方包还需要一条产品化的配置路径。API Key 绝不能进入设置响应或浏览器产物，而新增第二个可用提供方会让隐式选择变得含混。只在启动时捕获的提供方选择，无法让用户在不重启应用的前提下为下一次搜索选择另一个提供方。

## 决策

Web IQ 从自己的仓库以 `@edwindigital/dsh-web-search-microsoft-webiq` 发布，不再位于 `packages/web/`。它是"搜索提供方无需在本仓库占位"这一判断的实证：`dsh plugin --profile web add` 记录依赖并追加该包自带的 `dsh.bundle.patch` 层，harness 包作为 peer 依赖从运行中的安装解析，浏览器半包经由已安装的 Host 行进入客户端模块表。

Agent 调用继续使用来自 `@deepseek-ai/dsh-tool-web` 的提供方无关 `web_search` 工具，不存在第二个面向模型的工具。已安装的提供方组合包与 DeepSeek 并存而非取代它——在用户显式选择另一个提供方之前，`web` seam 保持 `deepseek-official`。未选定提供方的独立组合沿用既有的 `ctx.web` 规则：恰有一个可用提供方时自动选中，多个可用提供方则要求显式选择。

本仓库只保留树外组合包无法自行完成的那一处改动。

## 运行期提供方选择

`@deepseek-ai/dsh-web` 将 `searchProvider` 与 `fetchProvider` 声明为 `.volatile()` Config 字段。Settings 从 profile 条目 id 派生命名空间，base profile 中该 id 为 `web`。服务在每项操作开始时读取对应引用，值缺失时回落到环境变量。已提交的变更控制下一次调用，不会重新挂载服务或打断进行中的工作。引用由 Loader 管理，因此 Settings 不是必需服务，移除它也不会回退 profile 配置。

## 树外命名空间的浏览器暴露

Settings 从活动的 Loader 条目及其 volatile Config 字段派生可编辑表单。树外插件通过根包条目交付浏览器半包，并通过 `ctx.configForms.whileServed` 和 `plugins.item` 注册页面。[实时配置指南](../../../../docs/cookbook/adding-a-settings-card.zh.md)定义表单与浏览器交付接口，无需提供方专用的 Host allowlist 或中心设置卡片。

外部组合包必须适配所安装 Harness 版本的配置和客户端 API。页面从所属页面拥有者接收表单状态与携带版本号的 `form.mutate` 操作。

## 已评估的替代方案

**注册专用的 `webiq_search` 工具。** 否决，因为它重复了中立 `web_search` 的 schema 与呈现，把提供方选择暴露给模型，并绕开 `ctx.web` 拥有的选择规则。

**使用 Web IQ MCP 服务器。** 对发布的 Web 能力否决，因为 MCP 工具同样会造出第二个面向模型的搜索工具，且不参与 `ctx.web` 的提供方选择。用户仍可为 Web IQ 更广的图片、视频、新闻与 Browse 工具单独组合该 MCP 服务器。

**把 Web IQ 字段放进现有的 DeepSeek 卡片。** 否决，因为这会让一个中心 Client Plugin 拥有另一个提供方的设置，并使提供方包无法携带自己的 Host 与浏览器生命周期。

**安装即选中 Web IQ。** 否决，因为安装不得静默改变既有部署的搜索后端。显式选择同时防止一次无凭据的安装取代正在工作的提供方。

**把包留在 `packages/web/` 下的 `@deepseek-ai/` 作用域。** 否决，因为该作用域是工具链强制的工作区不变量：发布族发现与 npm 发布基线对 `packages/` 下的任何其他作用域直接抛错，而许可证、cordis-peer 与模块图门禁按该前缀选包，改名后会静默停止覆盖。第三方作者作用域属于独立仓库，而可安装组合包格式已经支持这一形态。

**把 Web IQ 作为 base 组合的一行发布。** 否决，因为那样该行无需安装即存在，而包自带组合层插入的同 id 行会与之冲突，使 `dsh plugin --profile web add` 不可用。`packages/web/` 下其他携带凭据的提供方同样不在 base 组合中。

**改默认提供方后要求重启。** 否决，因为提供方解析本就按操作发生。在同一时点读取由设置支撑的提供方 id，既保全进行中的调用，也让下一次操作反映已提交的选择。

## 验证

- `dsh-web` 定向套件通过 Loader 使用的同一实时引用更新原语覆盖搜索与抓取提供方的实时切换。
- base 组合包显式选择 `deepseek-official` 进行搜索，选择 `http` 进行抓取。
- 外部提供方仓库负责针对目标 Harness 版本验证安装和浏览器页面；树内套件不验证已安装的第三方组合包。

## 后果

插件配置的 Playwright 场景覆盖随产品发布的插件。第三方安装和卡片行为需要在提供方自己的仓库中验证。

一张浏览器卡片会写入两个设置命名空间外加一份凭据，这些操作并非原子。该约束现随提供方外移，但今后任何跨两个拥有者的树内卡片都继承它：在结算后分别读回各拥有者，保留 Host 未接受的值，并报告失败的那个动作而非宣称成功。
