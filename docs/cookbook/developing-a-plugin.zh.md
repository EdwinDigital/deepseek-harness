# 实操手册：开发插件

[English](developing-a-plugin.md) | 中文

从一个想法到合入或安装一个插件的有序路径。每一步都指明规则的归属文档，并给出通向它的决策；规则本身留在各自的归属文档中。

## 1. 决定插件放在哪里

先做这个选择：它决定包名、评审路径以及适用哪些门禁。

| | 树内贡献 | 树外插件 |
|---|---|---|
| 位置 | 本仓库的 `packages/<group>/<pkg>/` | 你自己的仓库 |
| 名称 | `@deepseek-ai/dsh-<name>`，由发布家族发现与 npm 发布基线强制要求 | 任何你拥有的作用域 |
| 通过什么触达用户 | 随附组合包的配置层 | `dsh plugin --profile <name> add <package-or-git-spec>` |
| 必须满足 | 全部仓库门禁，外加 [packages/AGENTS.md](../../packages/AGENTS.md) | 仅组合包约定 |
| 从哪开始 | [添加 workspace 包](adding-a-package.md) | [打包与安装插件](../user/develop/basic/publish.md) |

两者使用同一套运行时模型和同样的扩展点，区别只在打包与强制手段，因此本文其余步骤对两者都适用。

## 2. 了解运行时模型

已经掌握的部分可以跳过。

- [Cordis 框架教程](../cordis-tutorial/index.md)：在裸 Cordis 启动器上的七个可运行章节，涵盖插件、生命周期、服务、事件、配置与组合。
- [第一个插件](../user/develop/basic/index.md)：产品内部的同一套模型，由 `cordis.yml` overlay 加载并在 Web UI 中驱动。
- [Cordis 入门](../cordis-primer.md)与[插件与生命周期](../user/develop/framework/index.md)：教程完成后可随时回查的精简参考。

## 3. 选择插件形态

[实操手册：扩展插件形态](extension-cookbook.md)是形态目录——工具、hook、UI、协议驱动——其「功能到机制」对照表指明每项产品功能挂在哪个扩展点上。请在写代码前先选定形态，因为它决定下一步适用哪份契约指南。

该页留给你一个决策：这项能力是否需要可替换的实现。若需要，就按[能力的三种角色设计](../user/develop/practice/index.md)拆分 **Service Definition**、**Service Provider** 和 **Consumer** 三种角色，并把完整三元组视为 seam。**Service Provider** 注册进已有的 seam，且常常完全不注册面向模型的工具，因为工具属于 **Consumer**。

## 4. 按形态遵循对应的契约指南

| 形态 | 指南 |
|---|---|
| 模型可调用的工具 | [工具编写参考](adding-a-tool.md)，工具定义的真源 |
| LLM 适配器 | [添加 LLM 适配器](adding-an-llm-adapter.md) |
| Web Client 对话行 | [添加 Conversation Node](adding-a-conversation-node.md) |
| hook、UI、协议驱动或 Service Provider | [扩展插件形态](extension-cookbook.md)与归属的[子系统页面](../subsystems/README.md) |

## 5. 建包

[添加 workspace 包](adding-a-package.md)是逐文件清单：目录布局、manifest 不变量、根配置注册、包拓扑、角色命名与 README 义务。[packages/AGENTS.md](../../packages/AGENTS.md) 承载与之并行、由门禁强制执行的包规则，包括各类插件使用的导出形态，以及每个包都必须拥有的 `./invariant` 伴生插件。

有两种形态需要额外的契约。贡献自有配置层的插件要声明 `dsh.bundle.patch` 并随包交付该 patch 文件，这使它可被安装；[打包与安装插件](../user/develop/basic/publish.md)定义了它所处的层顺序。同时包含 Host 半包和浏览器半包的插件，则按 [packages/client/AGENTS.md](../../packages/client/AGENTS.md) 处理 `dsh.client` 声明、`./client` 导出与共享打包预设。

## 6. 组合进配置

插件只有被配置项挂载后才会运行。[插件配置](../user/develop/basic/config.md)介绍如何接收用户配置，[Cordis 入门](../cordis-primer.md#loader-configuration)介绍组合包或 overlay 所用的配置项格式、表达式与 patch 分层。

## 7. 覆盖行为

[测试策略](../testing.md)规定插件必须证明什么。写测试前先读它：产品可见的插件需要真实组合测试，而非手工搭建的 context；模型可见或用户可见的行为变更，需要在同一次改动中通过可运行示例补一份无密钥快照。

## 8. 验证

先运行建包清单中的[验证命令](adding-a-package.md#5-verify)，再运行你所选形态额外需要的检查：transcript 可见输出跑快照套件，浏览器半包跑 web 套件，外部提供方跑可选的真实 API 套件。[推送前检查](../../.agents/skills/dsh-pre-push-checks/SKILL.md)负责挑选覆盖本次改动的最小检查集。
