# Cookbook: developing a plugin

English | [中文](developing-a-plugin.zh.md)

The ordered route from an idea to a merged or installed plugin. Each step names the document that owns its rules and states the decision that leads into it; the rules themselves stay in their owning documents.

## 1. Decide where the plugin lives

Make this choice first: it fixes the package name, the review path, and which gates apply.

| | In-tree contribution | Out-of-tree plugin |
|---|---|---|
| Location | `packages/<group>/<pkg>/` in this repository | a repository you own |
| Name | `@deepseek-ai/dsh-<name>`, required by release-family discovery and the npm publication baseline | any scope you own |
| Reaches a user through | a shipped bundle's configuration layer | `dsh plugin --profile <name> add <package-or-git-spec>` |
| Must satisfy | every repository gate, plus [packages/AGENTS.md](../../packages/AGENTS.md) | the bundle contract alone |
| Start at | [adding a package](adding-a-package.md) | [packaging and installing a plugin](../user/develop/basic/publish.md) |

Both use the same runtime model and the same extension points. Only packaging and enforcement differ, so the rest of this route applies to either.

## 2. Learn the runtime model

Skip whichever part you already know.

- [Cordis tutorial](../cordis-tutorial/index.md) — seven runnable chapters on the bare Cordis launcher, covering plugins, lifecycle, services, events, configuration, and composition.
- [Your first plugin](../user/develop/basic/index.md) — the same model inside the product, loaded from a `cordis.yml` overlay and driven from the Web UI.
- [Cordis primer](../cordis-primer.md) and [plugins and lifecycle](../user/develop/framework/index.md) — the condensed references to return to once the tutorials are done.

## 3. Choose the plugin shape

[Extension patterns](extension-cookbook.md) is the shape catalog — tool, hook, UI, protocol driver — and its feature-to-mechanism table names the extension point each product feature attaches to. Choose the shape before writing code, because it selects the contract guide in the next step.

That page leaves one decision to you: whether the capability needs replaceable implementations. When it does, split the Service Definition, Service Provider, and Consumer roles as [three-role capability design](../user/develop/practice/index.md) describes, and treat the complete trio as the seam. A Service Provider registers into an existing seam and frequently registers no model-facing tool at all, because the tool belongs to the Consumer.

## 4. Follow the contract guide for that shape

| Shape | Guide |
|---|---|
| Model-callable tool | [adding a tool](adding-a-tool.md), the source of truth for tool definitions |
| LLM adapter | [adding an LLM adapter](adding-an-llm-adapter.md) |
| Web Client chat row | [adding a Conversation Node](adding-a-conversation-node.md) |
| Hook, UI, protocol driver, or Service Provider | [extension patterns](extension-cookbook.md) and the owning [subsystem page](../subsystems/README.md) |

## 5. Create the package

[Adding a package](adding-a-package.md) is the file-by-file checklist: directory layout, manifest invariants, root-configuration registration, topology, role naming, and README obligations. [packages/AGENTS.md](../../packages/AGENTS.md) carries the package rules the gates enforce alongside it, including the export form each plugin kind uses and the `./invariant` companion every package owns.

Two shapes add a second contract. A plugin that contributes its own configuration layer declares `dsh.bundle.patch` and ships that patch file, which makes it installable; [packaging and installing a plugin](../user/develop/basic/publish.md) defines the layer order it lands in. A plugin with both a Host half and a browser half follows [packages/client/AGENTS.md](../../packages/client/AGENTS.md) for the `dsh.client` declaration, the `./client` export, and the shared bundling preset.

## 6. Compose it

A plugin only runs once a configuration entry mounts it. [Plugin configuration](../user/develop/basic/config.md) covers accepting user configuration, and the [Cordis primer](../cordis-primer.md#loader-configuration) covers the entry format, expressions, and patch layering that a bundle or overlay uses.

## 7. Cover the behavior

The [testing policy](../testing.md) owns what a plugin must prove. Read it before writing tests: a product-visible plugin needs a real-composition test rather than a hand-built context, and a model- or user-visible behavior change needs a keyless snapshot through a runnable example in the same change.

## 8. Verify

Run the package checklist's [verification commands](adding-a-package.md#5-verify), then the checks your shape adds: the snapshot suite for transcript-visible output, the web suite for a browser half, and the opt-in real-API suite for an external provider. [Pre-push checks](../../.agents/skills/dsh-pre-push-checks/SKILL.md) selects the smallest set that covers the diff.
