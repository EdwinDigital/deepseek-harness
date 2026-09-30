# Agent Note: Microsoft Web IQ search provider

Status: implemented

English | [中文](2026-08-17-microsoft-webiq-search-provider.zh.md)

## Problem

The web capability has one model-facing `web_search` tool and a provider registry, but the shipped Web profile offers only the DeepSeek search provider. A user who wants Microsoft Web IQ must either replace the tool or compose an integration outside the normal provider, settings, and credentials lifecycles.

A provider package also needs a product configuration path. An API key must never enter a settings response or browser bundle, and adding a second usable provider makes implicit selection ambiguous. A provider choice captured only at startup cannot let the user select a different provider for the next search without restarting the application.

## Decision

Web IQ ships from its own repository as `@edwindigital/dsh-web-search-microsoft-webiq`, not from `packages/web/`. It is the worked proof that a search provider needs no presence here: `dsh plugin --profile web add` records the dependency and appends the package's own `dsh.bundle.patch` layer, harness packages resolve as peer dependencies from the running installation, and the browser half reaches the client module table through the installed Host row.

Agent calls keep using the provider-neutral `web_search` tool from `@deepseek-ai/dsh-tool-web`; no second model-facing tool exists. An installed provider bundle registers alongside DeepSeek without replacing it — the `web` seam retains `deepseek-official` until a user explicitly selects another provider. A standalone composition with no selected provider keeps the existing `ctx.web` rule: exactly one usable provider auto-selects, while multiple usable providers require an explicit choice.

This repository keeps only the change an out-of-tree bundle cannot make for itself.

## Live provider selection

`@deepseek-ai/dsh-web` declares `searchProvider` and `fetchProvider` as `.volatile()` Config fields. Settings derives their namespace from the profile entry id, which is `web` in the base profile. The service reads each reference at operation entry, with environment variables as fallbacks for absent values. A committed change controls the next call without remounting the service or interrupting work already in flight. Loader owns the references, so Settings is not a required service and detaching it does not revert the profile configuration.

## Browser exposure for out-of-tree namespaces

Settings derives editable forms from active Loader entries and their volatile Config fields. An out-of-tree plugin serves its browser half from its root package row and registers its page through `ctx.configForms.whileServed` and `plugins.item`. The [live configuration guide](../../../../docs/cookbook/adding-a-settings-card.md) owns the form and browser-delivery interfaces; no provider-specific Host allowlist or central settings card is required.

External bundles must target the installed Harness version's configuration and client APIs. Their pages receive a form state and revisioned `form.mutate` operations from the page owner.

## Alternatives considered

**Register a dedicated `webiq_search` tool.** Rejected because it duplicates the provider-neutral `web_search` schema and presentation, exposes provider choice to the model, and bypasses the selection rules owned by `ctx.web`.

**Use the Web IQ MCP server.** Rejected for the shipped Web capability because an MCP tool would again create a second model-facing search tool and would not participate in `ctx.web` provider selection. Users may still compose the MCP server independently for Web IQ's broader image, video, news, and Browse tools.

**Put Web IQ fields in the existing DeepSeek card.** Rejected because it makes a central Client Plugin own another provider's settings and prevents the provider package from carrying its own Host and browser lifecycles.

**Select Web IQ as soon as it is installed.** Rejected because installation must not silently change an existing deployment's search backend. Explicit selection also prevents a credential-less installation from replacing a working provider.

**Keep the package under `packages/web/` in the `@deepseek-ai/` scope.** Rejected because the scope is a workspace invariant the tooling enforces: release-family discovery and the npm publication baseline throw on any other scope under `packages/`, while the license, cordis-peer, and module-graph gates select packages by that prefix and would silently stop covering a renamed package. A third-party author scope belongs to a separate repository, which the installable bundle format already supports.

**Ship Web IQ as a base composition row.** Rejected because the row would then exist without installation, and the same id inserted by the package's own bundle layer would collide with it, leaving `dsh plugin --profile web add` unusable. The other credential-bearing providers under `packages/web/` are likewise absent from the base composition.

**Require a restart after changing the default provider.** Rejected because provider resolution already occurs per operation. Reading a settings-backed provider id at the same point preserves in-flight calls and makes the next operation reflect the committed choice.

## Verification

- The `dsh-web` focused suite covers live search and fetch selection through the same volatile-reference update primitive used by Loader.
- The base bundle explicitly selects `deepseek-official` for search and `http` for fetch.
- The external provider repository owns installation and browser-page verification against its target Harness version; the in-tree suite does not verify an installed third-party bundle.

## Consequences

The plugin-configuration Playwright scenario covers shipped plugins. Third-party installation and card behavior need verification in the provider's own repository.

One browser card writes two settings namespaces plus a credential, so those operations are not atomic. That constraint now lives with the provider, but any future in-tree card spanning two owners inherits it: read each owner after settlement, keep values the Host did not accept, and report the failed action rather than claiming success.
