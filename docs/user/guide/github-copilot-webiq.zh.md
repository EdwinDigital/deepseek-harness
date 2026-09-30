---
description: 从访谈整理到行业深度研究，体验 GitHub Copilot 模型与 Microsoft Web IQ 搜索，并在 DeepSeek Harness 中搭建这套组合。
---
# 如虎添翼：用 GitHub Copilot + Microsoft Web IQ，让 DeepSeek Harness 联网做研究

[English](github-copilot-webiq.md) | 中文

## 摘要

给 DeepSeek Harness 一句任务，让它搜索近期访谈、读取网页，再整理出带来源的观点摘要。GitHub Copilot 提供模型，Microsoft Web IQ 提供联网搜索，两者可以在同一个会话里配合使用。这篇文章先看真实使用效果，再讲如何把这套组合装起来。

为什么值得折腾这一步？DeepSeek Harness 不附送可直接使用的模型账号，你需要配置自己的模型访问。对已经有 Copilot 权限、又经常需要联网查资料的人来说，这套组合把两件事放到一起：通过一次 GitHub 授权接入多款前沿模型，再用面向智能体的全球检索服务补充最新资料，让研究少一点手工搬运，多一点连续推进。

## 目录

- [先看效果：从访谈搜索到观点对比](#real-use)
- [使用DSH进行行业深度研究](#deep-research)
- [模型接入更省事，全球检索更直接](#requirements)
- [如何快速安装](#installation)
- [详细安装与配置截图](#appendix)
- [参考信息](#related-links)

---

<a id="real-use">

</a>

## 先看效果：从访谈搜索到观点对比

先不看设置页，看一个实际会话。使用者输入的是一句很自然的任务：

> 搜索总结微软CEO最新访谈的观点

截图中的模型是 GPT-6 Astra。它先说明要核对访谈时间和原始来源，随后执行网页搜索、读取相关页面，最后给出“一句话总结”和“六个核心观点”，并附上来源链接。你不用先把几篇网页逐一复制进聊天框。

![实际会话中搜索微软 CEO 近期访谈，读取网页并生成带来源的观点摘要](images/github-copilot-webiq/research-conversation.png)

接着，同一会话又收到“对比分析Meta Mark的最新访谈观点”。轨迹里出现了新的搜索和网页获取调用：任务从单篇访谈的整理，继续到两位人物的观点对比。这里值得关注的，不只是回复有多长，而是**搜索、阅读、引用和后续追问都留在同一个会话里**。

### 回答之外，还能看到一次搜索到底做了什么

切换到**轨迹**，选中 `web_search`，可以看到查询参数、返回来源、完成状态和耗时。下面截取的是使用者提供的同一会话中的工具详情，保留了实际查询和结果。

![轨迹中的一次已完成 web_search 调用，展示查询、来源和 723 毫秒工具耗时](images/github-copilot-webiq/research-search-trace.png)

这次选中的工具调用耗时 **723 毫秒**，前面的整轮任务显示 **1 分 6 秒**。两者统计范围不同：工具耗时不是整个研究任务的耗时，也不等于 Web IQ 单个 HTTP 请求的延迟。这是一条实际会话记录，不是一组性能基准。

有了来源和调用记录，你可以回到原文核对，而不是只看模型说得是否流畅。截图里的摘要仍是模型生成的内容，不能把“附了链接”当作每个判断都已核实。

<a id="deep-research">

</a>

## 使用DSH进行行业深度研究

访谈整理是一个短任务。如果问题变成“研究 Personal Agent 的行业趋势、竞争格局和未来定位，最后形成一份详细的 Markdown 报告”，就不只是搜到几条链接再概括了。产品名称是否准确、哪些能力已经发布、哪些只是报道或预测，都需要分别核实。

下面这个真实会话把 Meta Muse、Manus Cue、OpenAI Dots、Microsoft Copilot/Autopilot 列为研究对象。它们是使用者提出的待核实名称，不是本文确认已经发布的产品清单。模型也明确提出，要区分已发布事实、媒体披露和前瞻判断，并附可追溯来源。

![Personal Agent 行业深度研究中的目标、任务清单、两个子智能体和多轮网页检索，任务仍在进行](images/github-copilot-webiq/personal-agent-deep-research.png)

这张图里，研究已经被拆成几个可跟踪的部分：核对名称与时间线，分析竞争格局、技术趋势、商业模式和风险，撰写报告与来源索引，最后检查事实和引用。会话创建了目标和任务清单，还启动两个子智能体分别研究不同对象，并继续执行搜索和网页读取。

与前面的访谈总结相比，这个场景更适合展示“深度研究”的工作方式：**研究范围先被拆开，资料持续补充，报告和核对各有明确任务**。这些目标、任务和子智能体能力来自该 Harness 会话的配置；Copilot 和 WebIQ 仍分别负责模型调用与搜索。

<a id="requirements">

</a>

## 模型接入更省事，全球检索更直接

GitHub Copilot 提供可调用的模型，负责理解任务、组织回答；Microsoft Web IQ 提供与查询相关的网页段落。DeepSeek Harness 把模型和工具放进会话中，同时展示调用过程和结果。搜索不绑定某一个 Copilot 模型，也可以配合其他已经配置的模型使用。

### Copilot：一次授权，接入多家前沿模型

DeepSeek Harness 默认提供模型配置入口，但不会替你准备模型凭据。使用 DeepSeek 或其他 API 提供商时，需要配置相应凭据；自定义服务还可能需要填写地址、协议和模型列表。Copilot 的便利在于：**用已有的 GitHub Copilot 权限统一接入模型，不必为每家模型厂商分别准备 API 密钥**。

安装登录插件后，点击登录入口、完成 GitHub 授权，再启用 `github-copilot` 提供商，就可以在同一个选择器中挑选模型。当前安装目录包括 **GPT-6 Astra、Claude Opus 5.5** 等前沿模型，正文截图也展示了 GPT-6 Astra 的实际会话。模型名称来自当前目录，可用性仍以你的 Copilot 订阅、组织策略和配额为准；不是安装插件就能解锁所有模型，也不是自动实时刷新到所有新模型。

所谓“一键接入”，更准确地说，是把多家模型的接入集中到一个登录入口，省去分别管理多组 API 密钥的工作；GitHub 授权和 Harness 的模型启用仍需完成。对访谈整理、复杂材料分析和报告写作来说，模型选择与工具调用都留在 Harness 里，这才是让它如虎添翼的地方。

### Web IQ：把默认搜索换成独立的全球检索服务

DeepSeek Harness 的出厂组合默认选择 `deepseek-official`，通过 **DeepSeek API** 执行联网搜索。它不是一个独立的搜索接口：搜索在一次辅助模型请求中完成，会产生该请求的延迟和 token 用量。即使聊天模型改成 Copilot，默认搜索也不会自动跟着改，仍要有相应的 DeepSeek 搜索凭据；实现细节见 [DeepSeek 搜索提供方](../../../packages/web/web-search-deepseek/README.zh.md)。

启用 WebIQ 并选中它后，原来的 `web_search` 改由 Microsoft Web IQ 提供检索结果，不必再为了这条搜索路径额外调用 DeepSeek 模型。**Copilot 负责分析，Web IQ 负责检索**：你可以用同一个会话查找海外官方公告、英文访谈和跨地区行业资料，再让模型整理、对比并生成中文内容。它替换的是搜索提供方，不是网页读取工具，也不让聊天模型失去作用。

### Microsoft Web IQ 的性能优势，具体是什么？

[Microsoft](https://webiq.microsoft.ai/)把Web IQ定位为面向 AI 智能体的事实检索服务，强调“更少的输入 token、更好的回答、更低的单次调用成本”。官网给出的能力与指标如下：


| 官网说明                                        | 对联网研究的意义                         |
| ------------------------------------------- | -------------------------------- |
| 全球覆盖：`100+ languages and markets`           | 支持跨语言、跨市场查找资料，适合不只依赖中文来源的研究。     |
| 延迟：**164 毫秒 p95**，并宣称比“当前最佳替代方案”快 **2.5 倍** | 多步任务会重复检索，较低的单次检索延迟有助于减少这些步骤的等待。 |
| 效率：优先返回相关段落，减少不必要的上下文与每次查询的 token 用量        | 让模型少读无关内容；官网称这有助于降低推理时间及总体回答成本。  |
| 质量：结合开放网页、授权和专门数据源，强调相关性、时效性与权威性            | 为近期事件、行业分析提供可引用的资料，方便回到来源核对。     |


备注：p95 是第 95 百分位延迟，不是平均值。上述数字和比较均为**微软官网公布的服务指标**，不是本文与 DeepSeek 搜索的对照测试，也不保证你的每次调用达到 164 毫秒，网络、模型推理和网页读取仍会影响整轮任务时间。

Web IQ服务覆盖网页、新闻、图片、视频等多种内容；当前DSH插件只支持网页搜索接口。

### 谁最值得配置这套组合？

如果你已经有 Copilot 权限，经常做跨语言资料搜集、访谈对比或行业研究，这套组合的价值最直接：减少模型接入的重复配置，把检索与分析连起来。它不是所有人的必装项；现有 DeepSeek 模型和搜索已经满足需求时，可以继续使用。Web IQ 的访问资格、独立密钥与配额是额外条件，不能只看性能宣传就忽略它们。

开始之前，先确认两件事：你的 GitHub 账号有可用的 Copilot 权限，以及你有真正的 Web IQ 服务密钥。Web IQ 是受限访问服务，没有密钥时需要通过微软的[访问申请](https://aka.ms/webiq-access)申请；Copilot token、DeepSeek API 密钥都不能替代它。两项服务的用量、配额和计费规则也要分别确认。

应用需要已经运行，并具有**插件**页面；启动方法见[根 README](../../../README.zh.md#run)。本文配置截图使用中文 Web UI，桌面应用可从对应入口操作。

<a id="installation">

</a>

## 如何快速安装

两个插件都可以直接从 GitHub 仓库安装。在**插件 → 添加插件**里，分别粘贴下面的地址：


| 插件                                                                                 | 填入**包名或地址**的内容                                                   |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [GitHub Copilot](https://github.com/lujianjun19/dsh-llm-github-copilot)            | `https://github.com/lujianjun19/dsh-llm-github-copilot`          |
| [Microsoft Web IQ](https://github.com/EdwinDigital/dsh-web-search-microsoft-webiq) | `https://github.com/EdwinDigital/dsh-web-search-microsoft-webiq` |


安装后记得**启用**。GUI 安装会先把 bundle 留在禁用状态，装进列表不等于已经运行。如果界面要求重启，先完成正在执行的工作，再重启相应应用。已有且正在运行的插件可以跳过安装，也无需额外手工插入第二份 `cordis.patch.yml` 配置。

<a id="appendix">

</a>

<a id="copilot-auth">

</a>

## 详细安装与配置截图

正文的三张实战图由使用者提供，展示访谈研究、搜索调用和进行中的行业深度研究；已裁去无关会话列表及模型上下文。下方六张配置图通过 Orca 调试浏览器从 Web UI 实际截取，Copilot 插件为 v0.4.9，WebIQ 为 v0.1.2。安装图展示提交前的地址，不表示又安装了一次；所有配图均未包含密钥、OAuth token 或设备码。

### 1. 从 Copilot 仓库安装

在插件对话框中粘贴 GitHub 地址。示例中的包源是本地选择，不是必需的安装源。

![添加插件对话框中填写 GitHub Copilot 仓库地址](images/github-copilot-webiq/copilot-install.png)

### 2. Copilot 认证状态

**已登录**表明已有保存的凭据。显示的凭据名称不是密钥值，保存的账号模型数量也不是输入框中的模型目录。

![GitHub Copilot 设置页显示已登录，没有显示 token](images/github-copilot-webiq/copilot-auth.png)

### 3. 已启用的模型提供商

模型页单独列出 `github-copilot`，与登录设置分开。无关的 DeepSeek 条目提示缺少密钥，不会阻止使用 Copilot。

![模型设置中已经配置 github-copilot 提供商](images/github-copilot-webiq/copilot-provider.png)

### 4. Copilot 模型选择器

输入框在 `github-copilot` 下列出模型。可见的名称是安装目录中的示例，不是保证账号有权使用的列表。

![会话输入框的模型选择器显示 GitHub Copilot 目录中的模型](images/github-copilot-webiq/copilot-models.png)

### 5. 安装 Microsoft Web IQ 插件

在相同的插件对话框中填写 WebIQ 仓库地址。服务密钥在安装后配置，不要填写在地址输入框中。

![添加插件对话框中填写 Microsoft Web IQ 仓库地址](images/github-copilot-webiq/webiq-install.png)

### 6. WebIQ 配置

详情页展示搜索提供方开关、接口地址、密钥存储提示和搜索参数。

![Microsoft Web IQ 插件配置中已启用提供方，并提示已保存密钥](images/github-copilot-webiq/webiq-config.png)

---

<a id="related-links">

</a>

## 参考信息

- [GitHub Copilot 插件仓库](https://github.com/lujianjun19/dsh-llm-github-copilot)维护登录插件的安装和认证细节。
- [MicrosoftWebIQ 插件仓库](https://github.com/EdwinDigital/dsh-web-search-microsoft-webiq)维护完整搜索配置和服务映射。
- [DSH内置 pi-ai管理模型](../../../packages/llm/llm-pi-ai/README.zh.md)维护模型目录和凭据行为。