# 0.6.0 release validation

Date: 2026-11-10. Status: candidate preparation; publication is not yet confirmed.

## Scope and documentation audit

Release 0.6.0 enables textual preservation by default for manual, native automatic and Guard-requested compactions, including observe mode. It protects the original request and latest complete exchange verbatim, summarizes intermediate work, and retains native instructions and continuation. It adds independent exact-text and provider-token-target checks, persistent scalar warnings, bounded native fallback and an explicit opt-out. See [configuration](../configuration.md#compaction-preservation-and-verification) and [preservation validation](compaction-preservation.md).

The audit covers README migration/default behavior, changelog, configuration/examples, architecture, SDK compatibility, sidebar/grouping descriptions, testing instructions, release guidance and relative Markdown file links. Historical plans and validation reports retain their original results; the initial API investigation links to current host evidence. Monitor v1/v2 gain optional verification data; older clients with closed schemas should update alongside the server. No dependencies change, and `bun install --ignore-scripts` reports no lockfile changes.

The candidate is `0.6.0`, with intended tag `v0.6.0`. Before preparation, npm reported `latest: 0.5.0`, with no 0.6.0 in its published version list. The remote `master` matched local parent `2529c30fa60b545713b779552238e99a93842cdc`, and the proposed release tag was absent.

## Validation

Implementation checks passed on Bun 1.1.34: formatting, strict typecheck, **279 offline tests across 36 files**, build, diff checks and clean-package validation. The packed artifact passed **72 allowlisted files**, clean installation, public exports, installed adapter behaviors, native TUI initialization/rendering/shared Solid state/click/disposal and consumer declaration compilation. Optional installed-host dashboard PTY checks were explicitly skipped rather than counted as passes.

The built implementation passed the dedicated synthetic-provider preservation harness on actual **OpenCode 2.0.29** and **OpenCode 2.1.2**, using Bun 1.3.11: repeated exact Unicode/multiline preservation, native checkpoint metadata, restart, assembled-context checks, custom compaction during a tool turn with native continuation, below/above-target provider readings and generation-failure/native fallback warnings. Diagnostic journals excluded the private content canary.

The final versioned `0.6.0` candidate passed `bun run validate`: formatting, strict typecheck, 279 tests and clean-package validation with 72 allowlisted files. All relative Markdown file-link targets across 54 documents exist; `git diff --check` passes. No dependency or lockfile changes were required. CI uses pinned Node 22.14.0/npm 11.21.0/Bun 1.1.34; local package verification uses Node 26.11.1/npm 12.2.0. Genuine-provider behavior, remote deployments, other platforms/versions, semantic summary correctness and Superpowers coexistence remain unverified. The generation endpoint is experimental.

## Publication

Not yet confirmed. The tag workflow stages with npm OIDC/provenance and the `latest` tag. A successful staging workflow is not public publication; maintainer 2FA approval and public registry verification are separate required steps. This record will be updated with the commit, tag, workflow and registry evidence as those steps finish.
