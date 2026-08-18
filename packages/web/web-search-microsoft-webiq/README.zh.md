# @deepseek-ai/dsh-web-search-microsoft-webiq

[English](README.md) | 中文

由 [Microsoft Web IQ](https://webiq.microsoft.ai/) 支持的 `WebSearchProvider`，用于 harness 的 [web 能力](../web/README.md)（`ctx.web`）。该包调用 Web Search v3 REST 端点，并把与查询相关的 passage（段落）映射为 `@deepseek-ai/dsh-tool-web` 消费的提供方无关 `WebSearchResult`。

这是一个同时包含两端实现的插件包。Host 端注册提供方 `microsoft-webiq`；浏览器端向“插件”设置页贡献包内自有卡片。它不会注册 `webiq_search` 或任何其他面向模型的工具。Agent 调用仍使用唯一的 `web_search` 工具。

安装该包不会静默替换现有搜索提供方。`web` seam 会继续选择 `deepseek-official`，直到用户点击**设为默认**，或显式存储 `web.searchProvider: microsoft-webiq`。

## 安装与选择

该包是可安装的 profile 组合包，因此随附组合在 profile 安装它之前不会挂载任何 Web IQ 行：

```sh
dsh plugin --profile web add @deepseek-ai/dsh-web-search-microsoft-webiq
```

在仓库 checkout 中，改为安装该包目录：

```sh
dsh plugin --profile web add ./packages/web/web-search-microsoft-webiq
```

两种形式都会记录依赖，把该包追加进 profile 的 `dsh.profile.bundles`，并将本包自有的 patch 层叠在随附组合包之后：

```yaml
- insert:
    - id: web-search-microsoft-webiq
      name: '@deepseek-ai/dsh-web-search-microsoft-webiq'
      config:
        apiKeyEnv: WEBIQ_API_KEY
```

直接挂载配置行的组合则在 seam 与工具旁声明同一行：

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: deepseek-official

- id: web-search-microsoft-webiq
  name: '@deepseek-ai/dsh-web-search-microsoft-webiq'
  config:
    apiKeyEnv: WEBIQ_API_KEY

- id: tool-web
  name: '@deepseek-ai/dsh-tool-web'
```

Web IQ 行会注册提供方并激活该包的浏览器模块。可在卡片中选择它，或配置：

```yaml
web:
  searchProvider: microsoft-webiq
```

`@deepseek-ai/dsh-web` 会在操作入口读取该设置。下一次 `web_search` 无需重启即可使用 Web IQ，而已经运行的搜索会保留启动时的提供方与选项。如果没有显式选择，只有在恰好注册了一个可用提供方时，web seam 才会自动选择。

## 凭据

默认凭据引用为 `WEBIQ_API_KEY`。每次搜索均按以下顺序解析：

1. 直接 Cordis 组合中的非空字面量 `apiKey`。
2. 可选的 `ctx.credentials` 服务按 `apiKeyEnv` 解析。
3. 启动环境中的同名引用。

浏览器卡片只通过 credentials RPC 写入替换密钥。密码输入框在每次加载后以及保存被接受后始终为空。Host schema 将密钥字面量标记为 secret，因此 Settings 描述、浏览器启动数据、日志和常规配置读取都不会包含它。缺少密钥时，已选择的提供方以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败，并且只给出未解析的引用名称。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | 未设置 | 用于直接组合的 API 密钥字面量。建议使用 `apiKeyEnv`；非空字面量优先。 |
| `apiKeyEnv` | `WEBIQ_API_KEY` | 每次搜索都会解析的凭据引用。 |
| `endpoint` | `https://api.microsoft.ai/v3/search/web` | 完整的 HTTPS Web Search v3 端点。可以使用部署代理，但代理会收到已解析的密钥。 |
| `language` | 未设置 | 可选的两位 ISO 639-1 界面语言。Web IQ 默认为 `en`。 |
| `region` | 未设置 | 可选的两位国家或地区代码。Web IQ 默认为 `US`。 |
| `maxLength` | `5000` | 每个结果的最大 passage 字符数；必须是正整数，最大 `500000`。 |
| `safeSearch` | `strict` | `strict` 或 `off`。设为 `off` 时，Web IQ 仍会屏蔽非法内容。 |

Host 拥有 Settings namespace `web-search-microsoft-webiq`；提供方选择单独位于 namespace `web`。浏览器卡片可以编辑全部非敏感提供方字段、存储替换密钥，并显式选择 Web IQ。每个所有者都会在写入后重新读取，因此被拒绝的操作会显示失败，而不会伪装成已接受。

## REST 约定与映射

每次搜索发送：

```http
POST https://api.microsoft.ai/v3/search/web
x-apikey: <resolved credential>
content-type: application/json
```

```json
{
  "query": "current TypeScript release",
  "maxResults": 10,
  "contentFormat": "passage",
  "maxLength": 5000,
  "safeSearch": "strict"
}
```

未配置时会省略 `language` 和 `region`。直接调用提供方时，`maxResults` 默认为 10，并被限制在 Web IQ 的最大值 50。超过 1,000 个字符的查询会在凭据或网络工作开始前于本地失败。

每个 `webResults[]` 条目按以下方式映射：

| Web IQ | `WebSearchSource` |
|---|---|
| `url` | `url` |
| 非空 `title` | `title` |
| 非空且与查询相关的 `content` | `snippet` |
| 非空 `crawledAt` | `publishedAt` |

提供方报告 `truncated: false`；`ctx.web` 对规范化来源执行最终的 `maxResults` 限制。适配器会验证外部 envelope（信封结构）和每个被消费的条目字段。缺少 `webResults` 数组、条目格式错误、成功响应不是 JSON、重定向、网络失败或非成功状态都会变为 `WEB_PROVIDER_ERROR`。HTTP 消息会在存在时包含 Web IQ 的 `userMessage`、`errorCode`、`retryAfter` 和 `traceId`，绝不包含密钥。调用方取消始终为 `WEB_ABORTED`，包括发生在凭据解析或响应体解析期间的取消。提供方内部不会重试。

## 模型体验

### 模型看到的内容

注册不会添加工具。通过 `@deepseek-ai/dsh-tool-web`，会话模型看到现有的 `web_search` 参数，以及包含 URL、标题、passage 和可选抓取时间戳的规范化结果。Web IQ 只会收到搜索查询与配置的 REST 参数，不会收到会话记录。

### Token 影响

注册不消耗模型 token。结果 token 随返回 passage 的数量和 `maxLength` 增长，随后由现有工具渲染限制约束。Web IQ 是检索 API，因此该包不会创建单独的模型轮次。

### KV Cache 影响

仅追加。工具结果位于可复用的会话前缀之后，不会使更早的缓存条目失效。

## 限制

- `safeSearch: off` 仍要求调用方适当处理可能敏感但合法的内容。
- `site:` 和 `-site:` 查询运算符可能降低相关性；无论 SafeSearch 如何设置，`site:` 都可能返回成人内容。
- 自定义端点决定 API 密钥会被发送到哪里，并且必须使用 HTTPS。
- 凭据可用性是异步的。`available()` 可以确认解析器存在，但已选择且无法解析出值的提供方会在搜索开始时失败。
- 真实 API 覆盖为可选项：运行 `tests/microsoft-webiq.e2e.ts` 前请设置 `WEBIQ_API_KEY`。