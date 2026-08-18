# Agent Note: Microsoft Web IQ search provider

Status: implemented

English | [中文](2026-08-17-microsoft-webiq-search-provider.zh.md)

## Problem

The web capability has one model-facing `web_search` tool and a provider registry, but the shipped Web profile offers only the DeepSeek search provider. A user who wants Microsoft Web IQ must either replace the tool or compose an integration outside the normal provider, settings, and credentials lifecycles.

A provider package also needs a product configuration path. An API key must never enter a settings response or browser bundle, and adding a second usable provider makes implicit selection ambiguous. The current `dsh-web` service captures its configured provider at startup, so a browser setting cannot select Web IQ for the next search without restarting the application.

## Decision

`@deepseek-ai/dsh-web-search-microsoft-webiq` lives under `packages/web/web-search-microsoft-webiq/`. The package has a Host half that registers search provider `microsoft-webiq` in `ctx.web` and a browser half that contributes its own card to `settings.plugin.item`. Agent calls continue to use the provider-neutral `web_search` tool from `@deepseek-ai/dsh-tool-web`; the package does not register `webiq_search` or another model-facing tool.

The package ships as an installable profile bundle: its manifest declares `dsh.bundle.patch`, so `dsh plugin --profile web add` records the dependency and appends the package's own layer. The shipped composition mounts no Web IQ row, matching the other credential-bearing search providers under `packages/web/`. Installing the package registers Web IQ but does not replace the selected provider: the `web` seam retains `deepseek-official` until the user explicitly selects Web IQ. A standalone composition with no selected provider keeps the existing `ctx.web` rule: exactly one usable provider auto-selects, while multiple usable providers require an explicit choice.

## Provider contract

The provider sends `POST https://api.microsoft.ai/v3/search/web` with `x-apikey` and `content-type: application/json`. The request carries the tool query, the requested result count capped at Web IQ's protocol maximum of 50, `contentFormat: "passage"`, and configurable language, region, maximum passage length, and SafeSearch mode. The package validates Web IQ's 1,000-character query limit before dispatch and forwards the caller's `AbortSignal` to `fetch`.

Each `webResults` item maps `url`, `title`, and query-relevant `content` to one `WebSearchSource`; a non-empty `crawledAt` becomes `publishedAt`, whose existing contract permits provider-supplied crawl timestamps. The provider reports `truncated: false`; `ctx.web` remains responsible for enforcing `WebSearchRequest.maxResults` on the returned source list.

The response parser validates the external JSON fields used by the adapter. A successful response without a `webResults` array, a malformed result item, a redirect, an unparseable body, or a non-success status becomes `WEB_PROVIDER_ERROR`. HTTP diagnostics use Web IQ's `userMessage`, `errorCode`, `retryAfter`, and `traceId` when present without exposing the API key. Caller cancellation remains `WEB_ABORTED` even when it occurs during credential resolution or response parsing.

The provider snapshots all resolved options once at operation entry. A settings update that lands while credential resolution or network I/O is pending therefore affects the next search, never half of the current one.

## Configuration and selection

The Host plugin owns settings namespace `web-search-microsoft-webiq`. Its schema includes a literal secret only for direct Cordis composition, a credential reference defaulting to `MICROSOFT_WEBIQ_API_KEY`, an endpoint defaulting to the Microsoft Web IQ Web Search URL, optional language and region, `maxLength` defaulting to 5,000, and `safeSearch` defaulting to `strict`. Credential resolution checks a configured literal first, then the optional credentials service, then the launch environment. A missing key fails the search with `WEB_PROVIDER_CREDENTIAL_MISSING` and names the reference without returning its value.

`@deepseek-ai/dsh-web` owns settings namespace `web` for `searchProvider` and `fetchProvider`. The service reads the active section at execution time and falls back to the composition entry when no settings service is mounted. Existing environment variables remain fallbacks for absent fields. A committed `searchProvider` change therefore controls the next `web_search` call without interrupting a call already in flight or making Settings a required service.

## Browser configuration

The package's browser half registers a Web IQ card only when `settings.plugin.item` exists. A switch at the top selects Web IQ for `web_search`; switching it off clears the user override instead of naming a replacement, so the composed provider applies again. Below it an API configuration group holds the endpoint and the API key, a search parameter group holds language, region, passage length, and SafeSearch, and one command at the bottom commits both owners: the key crosses the credentials RPC and the rest goes to the settings namespace. Because a single command spans two owners, the card keeps the credential outcome from that command's own return value rather than the shared last-failed marker, which the settings write would otherwise overwrite. The credential reference is a deployment choice in `cordis.yml` and never appears as a field, so configuring the provider never asks a user for an environment variable name. A key inherited from the launch environment is the one layer the process cannot rewrite, so the card disables its password field and names the owning layer instead of accepting a write that could not take effect. Secret literals remain write-only and are blank after every load.

The card listens for `credentials/updated` and reads both settings scopes through framework-owned snapshot hooks. It renders no trace when the Host does not expose the provider namespace. It uses package-local presentation code and theme tokens; it does not import another Client Plugin's components or reach a client context from a component.

The Host settings API explicitly exposes `web-search-microsoft-webiq` and `web`. This allowlist change is required because a plugin registering a settings namespace does not automatically grant browser access to it.

## Package integration

The package declares `dsh.bundle.patch` and `dsh.client`, emits Host, invariant, and browser entries, and is added to the Host and Client TypeScript aggregates. The CLI depends on the package so any profile resolves it from the installation, while the installed bundle layer contributes the single Host row; client module discovery loads the browser half from that Host row, so the integration remains in one package directory.

The package README documents configuration, credential precedence, selection behavior, errors, and the unchanged model experience. Provider tests cover request construction, response mapping, malformed responses, HTTP diagnostics, missing credentials, and cancellation. Browser tests cover credential status, write-only key behavior, default selection, save failure, and disposal. Existing `dsh-web` tests cover settings attachment, live selection, and fallback when Settings detaches.

## Alternatives considered

**Register a dedicated `webiq_search` tool.** Rejected because it duplicates the provider-neutral `web_search` schema and presentation, exposes provider choice to the model, and bypasses the selection rules owned by `ctx.web`.

**Use the Web IQ MCP server.** Rejected for the shipped Web capability because an MCP tool would again create a second model-facing search tool and would not participate in `ctx.web` provider selection. Users may still compose the MCP server independently for Web IQ's broader image, video, news, and Browse tools.

**Put Web IQ fields in the existing DeepSeek card.** Rejected because it makes a central Client Plugin own another provider's settings and prevents the provider package from carrying its own Host and browser lifecycles.

**Select Web IQ as soon as it is installed.** Rejected because installation must not silently change an existing deployment's search backend. Explicit selection also prevents a credential-less installation from replacing a working provider.

**Ship Web IQ as a base composition row.** Rejected because the row would then exist without installation, and the same id inserted by the package's own bundle layer would collide with it, leaving `dsh plugin --profile web add` unusable. The other credential-bearing providers under `packages/web/` are likewise absent from the base composition.

**Publish the package under its author's own npm scope while keeping it in this workspace.** Rejected because the single `@deepseek-ai/` scope is a workspace invariant the tooling enforces: release-family discovery and the npm publication baseline throw on any other scope under `packages/`, while the license, cordis-peer, and module-graph gates select packages by that prefix and would silently stop covering the package. An author scope belongs to an out-of-tree plugin repository, which the installable bundle format already supports; authorship inside this workspace is carried by the manifest `author` field.

**Require a restart after changing the default provider.** Rejected because provider resolution already occurs per operation. Reading a settings-backed provider id at the same point preserves in-flight calls and makes the next operation reflect the committed choice.

## Verification

- The `dsh-web` focused suite passes 22 tests, including live provider selection and fallback when Settings detaches.
- The Web IQ Host suites pass 24 keyless tests for request construction, protocol limits, external response validation, credentials, cancellation, settings layering, lifecycle, and the invariant companion. The real API probe remains opt-in through `MICROSOFT_WEBIQ_API_KEY`.
- The browser controller and card/registration suites pass 22 tests for write-only credentials, stale-read suppression, non-secret settings, default selection, delayed slot declaration, failed-draft retention, URL validation, and disposal.
- ApiProxy passes 32 configuration tests with `web` and `web-search-microsoft-webiq` exposed while arbitrary namespaces remain hidden. The base bundle passes its two composition tests with `deepseek-official` unchanged as the selected provider.
- The Host, Client, and Web production builds complete. The keyless plugin-configuration Playwright file passes seven scenarios, including an empty password control and a persisted explicit Web IQ selection; the full GUI suite passes 3,762 tests with one existing skip.

## Consequences

One browser card writes two settings namespaces plus a credential, so these operations are not atomic. The controller reads each owner after settlement, keeps values the Host did not accept, and reports the failed action instead of claiming success.

Web IQ passages can be large even with a result cap. Configurable `maxLength`, defaulting to 5,000, bounds each source before the existing tool output limits apply.

A configurable endpoint permits a deployment proxy and determines where the key is sent. The card identifies the endpoint, HTTPS is required, and one operation snapshot binds the resolved key and endpoint before dispatch.

The settings allowlist still requires a central Host edit for every configurable plugin. This implementation retains that existing policy rather than redesigning settings exposure authority as part of one provider addition.