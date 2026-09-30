---
description: Explore interview summaries and deeper industry research with GitHub Copilot and Microsoft Web IQ, then set up the combination in DeepSeek Harness.
---
# Power up DeepSeek Harness: web research with GitHub Copilot and Microsoft Web IQ

English | [中文](github-copilot-webiq.zh.md)

## Summary

Give DeepSeek Harness a task: find recent interviews, read the pages, and produce a summary with sources. GitHub Copilot supplies the model and Microsoft Web IQ supplies web search, working together in one conversation. This article starts with a real example, then shows how to set up the combination.

Why take this extra step? DeepSeek Harness does not include a ready-to-use model account; you configure your own access. For people who already have Copilot access and regularly research the web, this combination brings two benefits together: one GitHub authorization connects multiple frontier models, and an agent-oriented global retrieval service supplies current material. Less manual copying leaves more room for sustained research.

## Table of Contents

- [See it in action: from interviews to comparison](#real-use)
- [Use DSH for in-depth industry research](#deep-research)
- [Easier model access and direct global retrieval](#requirements)
- [Quick installation](#installation)
- [Detailed installation and configuration screenshots](#appendix)
- [References](#related-links)

---

<a id="real-use">

</a>

## See it in action: from interviews to comparison

Before opening a settings page, look at an actual conversation. The user starts with a natural request:

> Search for and summarize the views in the Microsoft CEO's latest interview.

The screenshot uses GPT-6 Astra. It first states that it will check interview dates and original sources, then searches the web and reads related pages. The answer includes a one-sentence summary, six key points, and source links. You do not have to paste each page into the conversation first.

![A real conversation searching recent Microsoft CEO interviews and producing a summary with sources](images/github-copilot-webiq/research-conversation.png)

The same conversation then receives a follow-up: compare those views with Mark Zuckerberg's latest interview. New search and page-fetch calls appear in the trace, extending the task from one interview to a comparison. The useful part is not simply a long answer: **search, reading, citations, and follow-up questions stay in one conversation**.

### Beyond the answer: inspect what a search actually did

Switch to **Trace** and select `web_search` to inspect query parameters, returned sources, completion status, and duration. The following crop comes from the user's screenshot of the same conversation and preserves the actual query and result.

![A completed web_search call showing its query, sources, and 723 ms tool duration](images/github-copilot-webiq/research-search-trace.png)

The selected tool call took **723 ms**, while the earlier full turn shows **1 minute 6 seconds**. These measurements cover different work: a tool duration is neither the entire research task nor the latency of one Web IQ HTTP request. This is an actual session record, not a benchmark sample.

Sources and call records let you check the original material instead of judging fluency alone. The summary in the screenshot is still model-generated content; having links does not establish that every conclusion is verified.

<a id="deep-research">

</a>

## Use DSH for in-depth industry research

An interview summary is a short task. Asking for Personal Agent industry trends, competitive positioning, and a detailed Markdown report requires more than finding a few links. Product names, released capabilities, reporting, and forecasts need separate checks.

The following real conversation names Meta Muse, Manus Cue, OpenAI Dots, and Microsoft Copilot/Autopilot as research targets. These are user-supplied names to verify, not a list of releases confirmed by this article. The model also states that it will distinguish released facts, media reporting, and forward-looking judgments, with traceable sources.

![Personal Agent industry research with a goal, task list, two subagents, and repeated web retrieval, still in progress](images/github-copilot-webiq/personal-agent-deep-research.png)

The research has several trackable parts: verify names and timelines; analyze competition, technology trends, business models, and risks; write the report and source index; then check facts and citations. The conversation creates a goal and task list, starts two subagents for different targets, and continues searching and reading pages.

Compared with the interview summary, this shows a deeper research workflow: **divide the scope, keep gathering material, and assign explicit reporting and verification tasks**. Goals, tasks, and subagents come from this Harness session's configuration. Copilot and WebIQ still supply model access and search.

<a id="requirements">

</a>

## Easier model access and direct global retrieval

GitHub Copilot supplies callable models that interpret the task and organize the answer. Microsoft Web IQ supplies query-relevant passages from the web. DeepSeek Harness brings models and tools into the conversation and displays the calls and results. Search is not tied to one Copilot model; it can also work with another configured model.

### Copilot: one authorization connects multiple frontier model families

DeepSeek Harness supplies model configuration controls by default, but not your model credentials. DeepSeek and other API providers require their own credentials; custom services may also need an endpoint, protocol, and model list. Copilot offers a simpler route: **use existing GitHub Copilot access to connect models without obtaining a separate API key from each model vendor**.

Install the login plugin, use its sign-in control, complete GitHub authorization, and enable the `github-copilot` provider. You can then pick models in one selector. The current installed catalog includes frontier models such as **GPT-6 Astra and Claude Opus 5.5**, and the article's screenshots show an actual GPT-6 Astra conversation. These names come from the current catalog; access still depends on your Copilot subscription, organization policy, and quota. Installing the plugin neither unlocks every model nor automatically refreshes the catalog with every new release.

“One-click access” is better understood as bringing multiple vendors behind one sign-in entry point, avoiding separate API-key management. GitHub authorization and model enablement in Harness are still required. For interview summaries, complex material analysis, and report writing, keeping model selection and tool calls in Harness is the practical advantage.

### Web IQ: replace default search with a dedicated global retrieval service

The shipped DeepSeek Harness composition selects `deepseek-official` for web search through the **DeepSeek API**. This is not a dedicated search endpoint: retrieval runs inside an auxiliary model request, with that request's latency and token usage. Switching the conversation model to Copilot does not automatically change search, which still needs suitable DeepSeek search credentials. The [DeepSeek search provider](../../../packages/web/web-search-deepseek/README.md) owns the implementation details.

After enabling and selecting WebIQ, the existing `web_search` retrieves results through Microsoft Web IQ without an additional DeepSeek model call for that search path. **Copilot handles analysis; Web IQ handles retrieval.** One conversation can find overseas official announcements, English interviews, and cross-market industry material, then organize, compare, and write about them in Chinese. This replaces the search provider, not the page-fetching tool or the conversation model.

### What are Microsoft Web IQ's performance advantages?

[Microsoft](https://webiq.microsoft.ai/) positions Web IQ as a grounding service for AI agents, emphasizing fewer input tokens, better answers, and lower cost per call. The official site describes these capabilities and metrics:


| Official claim | Relevance to web research |
|---|---|
| Global coverage: `100+ languages and markets` | Find material across languages and markets rather than relying only on Chinese sources. |
| Latency: **164 ms p95**, claimed to be **2.5× faster** than “today's best alternative” | Multi-step tasks repeat retrieval; lower per-search latency can reduce waiting at those steps. |
| Efficiency: prioritize relevant passages and reduce unnecessary context and tokens per query | The model reads less unrelated material; the site says this reduces reasoning time and total answer cost. |
| Quality: combine the open web with licensed and specialized sources, prioritizing relevance, freshness, and authority | Supply citation-ready material for recent events and industry analysis, with sources to check. |


Note: p95 means the 95th-percentile latency, not an average. These figures and comparisons are **Microsoft's published service metrics**, not this article's comparison against DeepSeek search or a guarantee that each request takes 164 ms. Network time, model reasoning, and page fetching still affect the full turn.

The Web IQ service covers web pages, news, images, video, and more; the current DSH plugin supports only the web-search endpoint.

### Who benefits most from this setup?

The benefits are clearest if you already have Copilot access and regularly gather multilingual material, compare interviews, or research industries: less repeated model setup and a connected retrieval-and-analysis workflow. Neither plugin is mandatory for everyone; keep your current DeepSeek model and search if they meet your needs. Web IQ eligibility, a separate key, and quota remain additional requirements, regardless of its performance claims.

Before starting, confirm two requirements: your GitHub account has usable Copilot access, and you have an actual Web IQ service key. Web IQ is limited-access; request access through Microsoft's [application page](https://aka.ms/webiq-access) if you lack a key. Neither a Copilot token nor a DeepSeek API key can replace it. Check each service's usage, quota, and charging rules separately.

The application must already be running with a **Plugins** page; launch instructions are in the [root README](../../../README.md#run). The settings screenshots use the Chinese Web UI, with corresponding controls available in Desktop.

<a id="installation">

</a>

## Quick installation

Both plugins install directly from their GitHub repositories. Under **Plugins → Add plugin**, paste each address below:


| Plugin | Address for **Package name or address** |
|---|---|
| [GitHub Copilot](https://github.com/lujianjun19/dsh-llm-github-copilot) | `https://github.com/lujianjun19/dsh-llm-github-copilot` |
| [Microsoft Web IQ](https://github.com/EdwinDigital/dsh-web-search-microsoft-webiq) | `https://github.com/EdwinDigital/dsh-web-search-microsoft-webiq` |


Remember to **enable** each plugin after installation. GUI installation leaves the bundle disabled; appearing in the list does not mean it is running. If the UI requires a restart, finish ongoing work before restarting that application. Skip installation for a plugin that is already running, and do not insert a duplicate manual `cordis.patch.yml` entry.

<a id="appendix">

</a>

<a id="copilot-auth">

</a>

## Detailed installation and configuration screenshots

The user supplied the three usage screenshots, showing interview research, a search call, and industry research in progress. Unrelated session lists and model context have been cropped out. The following six configuration images were captured through Orca's debugging browser, using Copilot plugin v0.4.9 and WebIQ v0.1.2. Installation images show addresses before submission, not another installation; none of the images contains keys, OAuth tokens, or device codes.

### 1. Copilot repository installation

Paste the GitHub address into the plugin dialog. The registry shown in this example is a local choice, not a required source.

![Add Plugin dialog with the GitHub Copilot repository address](images/github-copilot-webiq/copilot-install.png)

### 2. Copilot authentication status

**Signed in** confirms that a credential is stored. The displayed credential name is not the secret value, and the stored account-model count is not the composer catalog.

![GitHub Copilot settings showing signed-in status without displaying a token](images/github-copilot-webiq/copilot-auth.png)

### 3. Enabled model provider

The Models page lists `github-copilot` separately from the login settings. The missing-key indicator on the unrelated DeepSeek entry does not block Copilot.

![Models settings with the configured github-copilot provider](images/github-copilot-webiq/copilot-provider.png)

### 4. Copilot model picker

The composer offers models under `github-copilot`. The visible model names are examples from the installed catalog, not a guaranteed account entitlement list.

![Composer model picker showing GitHub Copilot catalog entries](images/github-copilot-webiq/copilot-models.png)

### 5. Install the Microsoft Web IQ plugin

Use the WebIQ repository address in the same plugin dialog. Configure the service key after installation, not in this address field.

![Add Plugin dialog with the Microsoft Web IQ repository address](images/github-copilot-webiq/webiq-install.png)

### 6. WebIQ configuration

The detail page shows the search-provider switch, endpoint, stored-key indication, and search parameters.

![Microsoft Web IQ plugin configuration with the provider enabled and a stored-key indication](images/github-copilot-webiq/webiq-config.png)

---

<a id="related-links">

</a>

## References

- [GitHub Copilot plugin repository](https://github.com/lujianjun19/dsh-llm-github-copilot) owns the login plugin's installation and authentication details.
- [Microsoft WebIQ plugin repository](https://github.com/EdwinDigital/dsh-web-search-microsoft-webiq) owns the complete search configuration and service mapping.
- [DSH's built-in pi-ai model management](../../../packages/llm/llm-pi-ai/README.md) owns catalog and credential behavior.
