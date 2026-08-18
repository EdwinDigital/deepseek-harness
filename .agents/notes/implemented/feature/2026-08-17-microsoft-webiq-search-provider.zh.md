# Agent Note：Microsoft Web IQ 搜索提供方

Status: implemented

[English](2026-08-17-microsoft-webiq-search-provider.md) | 中文

## 问题

web 能力有一个面向模型的 `web_search` 工具和一个提供方注册表，但发布的 Web profile 只提供 DeepSeek 搜索提供方。想使用 Microsoft Web IQ 的用户只能替换该工具，或在正常的提供方、设置与凭据生命周期之外自行拼装集成。

提供方包还需要一条产品化的配置路径。API Key 绝不能进入设置响应或浏览器产物，而新增第二个可用提供方会让隐式选择变得含混。`dsh-web` 服务在启动时就捕获了所配置的提供方，因此浏览器里的设置无法在不重启应用的前提下为下一次搜索选中另一个提供方。

## 决策

Web IQ 从自己的仓库以 `@edwindigital/dsh-web-search-microsoft-webiq` 发布，不再位于 `packages/web/`。它是"搜索提供方无需在本仓库占位"这一判断的实证：`dsh plugin --profile web add` 记录依赖并追加该包自带的 `dsh.bundle.patch` 层，harness 包作为 peer 依赖从运行中的安装解析，浏览器半包经由已安装的 Host 行进入客户端模块表。

Agent 调用继续使用来自 `@deepseek-ai/dsh-tool-web` 的中立 `web_search` 工具，不存在第二个面向模型的工具。已安装的提供方组合包与 DeepSeek 并存而非取代它——在用户显式选择另一个提供方之前，`web` 接缝保持 `deepseek-official`。未选定提供方的独立组合沿用既有的 `ctx.web` 规则：恰有一个可用提供方时自动选中，多个可用提供方则要求显式选择。

本仓库只保留树外组合包无法自行完成的那一处改动。

## 运行期提供方选择

`@deepseek-ai/dsh-web` 拥有设置命名空间 `web` 的 `searchProvider` 与 `fetchProvider`，并在执行时而非启动时读取生效分区，未挂载设置服务时回落到组合条目。既有环境变量继续作为缺失字段的回落。因此已提交的 `searchProvider` 变更控制下一次 `web_search` 调用，既不打断进行中的调用，也不把 Settings 变成必需服务。

## 树外命名空间的浏览器暴露

卡片能被服务，曾经需要在 `@deepseek-ai/dsh-apiproxy` 的硬编码 `WEB_SETTINGS_NAMESPACES` allowlist 中有一条条目，这使得每一个第三方配置界面都要付出一次上游改动。该 allowlist 已退场：proxy 现在服务 `ctx.settings.describe()` 返回的全部命名空间，而 `settings.plugin.item` 以卡片所编辑的命名空间为 key。树外插件现在凭自己的注册就能抵达配置页，本仓库不再为提供方代持任何东西。

外部卡片应注册到这个键控槽位；仍使用早先 `id`/`order` 列表形式的卡片不会被分发。

## 已评估的替代方案

**注册专用的 `webiq_search` 工具。** 否决，因为它重复了中立 `web_search` 的 schema 与呈现，把提供方选择暴露给模型，并绕开 `ctx.web` 拥有的选择规则。

**使用 Web IQ MCP 服务器。** 对发布的 Web 能力否决，因为 MCP 工具同样会造出第二个面向模型的搜索工具，且不参与 `ctx.web` 的提供方选择。用户仍可为 Web IQ 更广的图片、视频、新闻与 Browse 工具单独组合该 MCP 服务器。

**把 Web IQ 字段放进现有的 DeepSeek 卡片。** 否决，因为这会让一个中心 Client Plugin 拥有另一个提供方的设置，并使提供方包无法携带自己的 Host 与浏览器生命周期。

**安装即选中 Web IQ。** 否决，因为安装不得静默改变既有部署的搜索后端。显式选择同时防止一次无凭据的安装取代正在工作的提供方。

**把包留在 `packages/web/` 下的 `@deepseek-ai/` 作用域。** 否决，因为该作用域是工具链强制的工作区不变量：发布族发现与 npm 发布基线对 `packages/` 下的任何其他作用域直接抛错，而许可证、cordis-peer 与模块图门禁按该前缀选包，改名后会静默停止覆盖。第三方作者作用域属于独立仓库，而可安装组合包格式已经支持这一形态。

**把 Web IQ 作为 base 组合的一行发布。** 否决，因为那样该行无需安装即存在，而包自带组合层插入的同 id 行会与之冲突，使 `dsh plugin --profile web add` 不可用。`packages/web/` 下其他携带凭据的提供方同样不在 base 组合中。

**改默认提供方后要求重启。** 否决，因为提供方解析本就按操作发生。在同一时点读取由设置支撑的提供方 id，既保全进行中的调用，也让下一次操作反映已提交的选择。

## 验证

- `dsh-web` 定向套件 22 项测试通过，含运行期提供方选择与 Settings 脱离时的回落。
- base 组合包两项组合测试通过，选中的提供方仍为 `deepseek-official`。
- 把外部组合包装入一份临时 `DSH_HOME` 后，它被记入 `dsh.profile.bundles`，其行挂载进组合配置，卡片在插件设置页可达。

## 后果

插件配置的 Playwright 场景不再覆盖"已安装的第三方卡片"，因为树内已无包能产出这样一张卡片。它断言的是随产品发布的那几张卡片；第三方卡片行为改由提供方自己的仓库验证。

一张浏览器卡片会写入两个设置命名空间外加一份凭据，这些操作并非原子。该约束现随提供方外移，但今后任何跨两个拥有者的树内卡片都继承它：在结算后分别读回各拥有者，保留 Host 未接受的值，并报告失败的那个动作而非宣称成功。
