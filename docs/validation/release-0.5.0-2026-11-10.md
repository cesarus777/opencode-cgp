# 0.5.0 release validation

Date: 2026-11-10. Status: published on npm as `0.5.0`, with `latest` pointing to `0.5.0`. Maintainer 2FA approval completed and public registry metadata was verified.

## Scope and documentation audit

Release 0.5.0 adds Orbit workspaces to the standalone terminal and expanded native panel, terminal-default/ANSI styling, native fullscreen/split controls, and independent performance freshness masking. Compact layouts, the native sidebar, SDK versions, RPC contracts, accounting and compaction policy remain compatible. The [native delivery record](native-orbit-workspace-2026-11-10.md) documents geometry, controls, lifecycle and supported-host evidence.

The documentation audit covers README installation/version examples and both interfaces; configuration's native/standalone geometry, metric placement and styling; architecture and renderer-loading boundaries; compatibility; sidebar/panel descriptions; testing; release instructions; changelog; and repository commit guidance. Earlier plans/reports retain historical evidence, with annotations where Orbit supersedes their layout. CLI dashboard help describes the workspace. Relative documentation links are checked before commit.

The candidate version is `0.5.0`, with tag `v0.5.0`. Before preparation, npm reported `latest: 0.4.3` and no published `0.5.0`; the remote branch matched local parent `97bbf48`. `bun install --ignore-scripts` found no dependency or binary-lockfile changes.

## Validation

- Initial implementation: 258 offline tests passed on Bun 1.3.11, with typecheck, formatting, build and diff checks. The native renderer fixture runs through the public Solid preload on Bun 1.1.34.
- Native built-host synthetic-provider PTYs passed on OpenCode 2.0.29 and 2.1.2: fullscreen workspace entry, root/child/grandchild access, help/selection continuity, chart metric/windows/retry/cancellation, context continuity, sidebar preservation, privacy and compaction followed by continued execution. Each host completed 29 synthetic provider requests and cleaned up disposable resources.
- The existing exhaustive Models viewport test now has an explicit 15-second per-test timeout. Its one-cell case formats thousands of scroll steps and exceeded the default five seconds locally. Assertions and workload are unchanged; the standard CI command can run the complete test without a global timeout override.
- The standalone PTY driver scrolls to diagnostics below the new metric panels before checking snapshot fields. This preserves full-field reachability checks against the new layout.

The final versioned candidate passed formatting, strict typecheck, **258 tests across 35 files on Bun 1.1.34 using the standard `bun test` command**, build and diff checks. All 52 Markdown files had valid relative file-link targets. No dependency or lockfile changes were required.

Clean-package verification passed with Node 26.11.1/npm 12.2.0: **69 allowlisted files**, isolated installation, server/core/RPC and all exports, installed adapter behavior, packed native TUI initialization/rendering/reactivity/click/disposal, dashboard unsupported-runtime preflight/terminal restoration, and strict consumer declarations. The first sandbox run failed npm DNS resolution; rerunning the package check with registry access passed. The optional installed interactive dashboard/host probes were explicitly skipped because Bun 1.1.34 and their opt-in flags were not configured for that package run; they are distinct from the built-checkout checks below.

The versioned built standalone CLI also passed the authenticated synthetic-provider PTY harness on **OpenCode 2.1.2**, with terminal runtime **Bun 1.3.11**: selected full model identities, complete diagnostics, root/concurrent-child metrics, all chart metrics/windows, history fault/retry, Models, resize, server restart, privacy canaries, continued native-client operation, signal shutdown and terminal restoration. The family rail deliberately clips model identities, so the driver selects rows to inspect complete models instead of assuming they fit in the rail or relying on child ordering.

Optional host skips are distinct from passes. Synthetic-provider checks do not certify genuine-provider accounting, cross-machine HTTPS, other platforms, tmux or Neovim. CI and staging use their pinned Node 22.14.0/npm 11.21.0 toolchain and require separate workflow results before publication.

## Publication

Release commit: `c75c423b2abb7a9c5fc93a6f655217aa218275e7`; annotated tag: `v0.5.0`. The reviewed implementation, documentation and version metadata were pushed atomically to `master` and the release tag.

- [CI](https://github.com/cesarus777/opencode-cgp/actions/runs/42728725323): passed the pinned Node 22.14.0/npm 11.21.0/Bun 1.1.34 validation and package checks.
- [Stage npm package](https://github.com/cesarus777/opencode-cgp/actions/runs/42728725388): passed all checks and staged `0.5.0` through npm OIDC with provenance and the intended `latest` tag.
- The intermediate staging state was recorded in follow-up commit `f7f7b38`; the public registry still reported `latest: 0.4.3` at that point.
- Maintainer 2FA approval: completed on npmjs.com. The registry then confirmed version `0.5.0`, `latest: 0.5.0`, and `gitHead: c75c423b2abb7a9c5fc93a6f655217aa218275e7`, matching the annotated release tag.
- Public artifact SHA-1: `62119dda2d0dee2418c541c3e1e64c12d49072cd`. npm exposes an SLSA provenance v1 attestation for this version.

Publication was marked complete only after maintainer approval and public-registry verification; successful staging alone was not treated as deployment. See [release instructions](../releasing.md#release) and [npm's approval documentation](https://docs.npmjs.com/staged-publishing/#approve-a-staged-package). No credentials or OTPs are retained.
