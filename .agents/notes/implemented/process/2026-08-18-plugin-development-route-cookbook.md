# Agent Note: the plugin development route lives in the cookbook

Status: implemented

English | [中文](2026-08-18-plugin-development-route-cookbook.zh.md)

## Problem

Plugin authoring guidance is spread across three document sets with different audiences and different runtimes: the [Cordis tutorial](../../../../docs/cordis-tutorial/index.md) teaches the framework on the bare launcher, [user/develop](../../../../docs/user/develop/basic/index.md) teaches harness plugins driven from the Web UI, and the [cookbook](../../../../docs/cookbook/adding-a-package.md) holds contributor checklists. Each set states its own scope and links its neighbours pairwise, but no document orders them into one path.

Two decisions that determine everything downstream are stated nowhere as decisions: whether the plugin lives in this repository or outside it, and which plugin shape it takes. An author who chooses the first one implicitly discovers the obligations it carries — the enforced package scope, the workspace gates, the release family — only by tripping them after the package already exists.

## Decision

[docs/cookbook/developing-a-plugin.md](../../../../docs/cookbook/developing-a-plugin.md) is the ordered route from an idea to a merged or installed plugin. It is a routing document: each step names the document that owns its rules and states the decision that leads into it, and it restates none of their content. The [tier taxonomy](../../../../docs/AGENTS.md) keeps every rule in one home, so this page carries only the sequence and the forks between steps.

It owns the two forks nothing else states. The first is location: an in-tree package under the `@deepseek-ai/dsh-` scope that release-family discovery and the npm publication baseline require, against an out-of-tree bundle installed with `dsh plugin add`, which is subject to the bundle contract alone. The second is the seam question the shape catalog leaves open: whether the capability needs replaceable implementations, which selects the three-role split.

The page sits in `cookbook/` because it is a contributor how-to ending in numbered verification, and it publishes to the website's Cookbook section as that section's entry page.

## Alternatives considered

**Expand `extension-cookbook.md` into the complete guide.** Rejected because that page's subject is the shape catalog and the feature-to-mechanism map. Adding location, packaging, testing, and verification steps would widen a reference into the mixed form the documentation standard requires splitting.

**Write a self-contained guide that restates the rules.** Rejected because the documentation standard gives each fact one home, and its slop checklist hunts the same rule stated in more than one place. A copy of the package checklist, the tool contract, and the gate list would drift away from the owners that gates already keep current.

**Put the route under `docs/user/develop/`.** Rejected because that path is the product-facing tutorial series published for plugin users, while this route also covers repository contribution, workspace gates, and pre-push check selection — contributor procedure the user tier excludes.

**Leave the route implicit.** Rejected because the existing cross-links run only pairwise between neighbouring documents. No entry states the order or the two forks, so an author meets the in-tree obligations after writing the package rather than before choosing where it lives.

## Consequences

An author has one entry point, and every rule stays in the document its gate keeps current. The cost is one more page that must keep pointing at the right owners: a document that moves or is renamed updates this route in the same change, which `verify-md-links` catches. The page is bilingual and published, so it carries the pairing record and site registration that every published pair owes.
