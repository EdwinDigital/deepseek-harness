# Agent Note: Microsoft Web IQ search provider

Status: implemented

English | [中文](2026-08-17-microsoft-webiq-search-provider.zh.md)

## Problem

The web capability has one model-facing `web_search` tool and a provider registry, but the shipped Web profile offers only the DeepSeek search provider. A user who wants Microsoft Web IQ must either replace the tool or compose an integration outside the normal provider, settings, and credentials lifecycles.

A provider package also needs a product configuration path. An API key must never enter a settings response or browser bundle, and adding a second usable provider makes implicit selection ambiguous. The `dsh-web` service captured its configured provider at startup, so a browser setting could not select a different provider for the next search without restarting the application.

## Decision

Web IQ ships from its own repository as `@edwindigital/dsh-web-search-microsoft-webiq`, not from `packages/web/`. It is the worked proof that a search provider needs no presence here: `dsh plugin --profile web add` records the dependency and appends the package's own `dsh.bundle.patch` layer, harness packages resolve as peer dependencies from the running installation, and the browser half reaches the client module table through the installed Host row.

Agent calls keep using the provider-neutral `web_search` tool from `@deepseek-ai/dsh-tool-web`; no second model-facing tool exists. An installed provider bundle registers alongside DeepSeek without replacing it — the `web` seam retains `deepseek-official` until a user explicitly selects another provider. A standalone composition with no selected provider keeps the existing `ctx.web` rule: exactly one usable provider auto-selects, while multiple usable providers require an explicit choice.

This repository keeps only the change an out-of-tree bundle cannot make for itself.

## Live provider selection

`@deepseek-ai/dsh-web` owns settings namespace `web` for `searchProvider` and `fetchProvider`, and reads the active section at execution time rather than at startup, falling back to the composition entry when no settings service is mounted. Existing environment variables remain fallbacks for absent fields. A committed `searchProvider` change therefore controls the next `web_search` call without interrupting a call already in flight and without making Settings a required service.

## Browser exposure for out-of-tree namespaces

Serving the card once required an entry in a hardcoded `WEB_SETTINGS_NAMESPACES` allowlist in `@deepseek-ai/dsh-apiproxy`, which made every third-party configuration surface cost an upstream change. That allowlist is retired: the proxy serves whatever `ctx.settings.describe()` returns, and `settings.plugin.item` is keyed by the namespace a card edits. An out-of-tree plugin now reaches the configuration page on its own registrations, so this repository holds nothing on the provider's behalf.

The keyed slot is what an external card registers against; a card still using the earlier `id`/`order` list form is not dispatched.

## Alternatives considered

**Register a dedicated `webiq_search` tool.** Rejected because it duplicates the provider-neutral `web_search` schema and presentation, exposes provider choice to the model, and bypasses the selection rules owned by `ctx.web`.

**Use the Web IQ MCP server.** Rejected for the shipped Web capability because an MCP tool would again create a second model-facing search tool and would not participate in `ctx.web` provider selection. Users may still compose the MCP server independently for Web IQ's broader image, video, news, and Browse tools.

**Put Web IQ fields in the existing DeepSeek card.** Rejected because it makes a central Client Plugin own another provider's settings and prevents the provider package from carrying its own Host and browser lifecycles.

**Select Web IQ as soon as it is installed.** Rejected because installation must not silently change an existing deployment's search backend. Explicit selection also prevents a credential-less installation from replacing a working provider.

**Keep the package under `packages/web/` in the `@deepseek-ai/` scope.** Rejected because the scope is a workspace invariant the tooling enforces: release-family discovery and the npm publication baseline throw on any other scope under `packages/`, while the license, cordis-peer, and module-graph gates select packages by that prefix and would silently stop covering a renamed package. A third-party author scope belongs to a separate repository, which the installable bundle format already supports.

**Ship Web IQ as a base composition row.** Rejected because the row would then exist without installation, and the same id inserted by the package's own bundle layer would collide with it, leaving `dsh plugin --profile web add` unusable. The other credential-bearing providers under `packages/web/` are likewise absent from the base composition.

**Require a restart after changing the default provider.** Rejected because provider resolution already occurs per operation. Reading a settings-backed provider id at the same point preserves in-flight calls and makes the next operation reflect the committed choice.

## Verification

- The `dsh-web` focused suite passes 22 tests, including live provider selection and fallback when Settings detaches.
- The base bundle passes its two composition tests with `deepseek-official` unchanged as the selected provider.
- Installing the external bundle into a scratch `DSH_HOME` records it in `dsh.profile.bundles` and mounts its row in the composed configuration, with its card reachable in the Plugins settings page.

## Consequences

The plugin-configuration Playwright scenario no longer covers an installed third-party card, because no in-tree package produces one. The cards it asserts are the shipped ones; third-party card behavior is verified in the provider's own repository.

One browser card writes two settings namespaces plus a credential, so those operations are not atomic. That constraint now lives with the provider, but any future in-tree card spanning two owners inherits it: read each owner after settlement, keep values the Host did not accept, and report the failed action rather than claiming success.
