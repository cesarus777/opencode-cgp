# 0.4.1 release candidate validation

Date: 2026-11-07. Historical candidate record: the checks below preceded release. Subsequent registry verification on 2026-11-08 confirms `0.4.1` is public and tagged `v0.4.1`. The pending-release statements below describe the original candidate checkpoint.

The candidate includes the nine UI/UX commits after `v0.4.0`: native panel overview, shared threshold and Guard wording, compact standalone overview, native keyboard help and inventory feedback, compact sidebar, plain-language terminology, history failure recovery, and chart continuity through help. The registry reported `0.4.0` as `latest` before preparation. The manifest and changelog now identify `0.4.1`; `bun install` found no dependency changes, and the existing binary lockfile remained unchanged.

## Checks

- `bun test`: 234 passed, 0 failed across 32 files.
- `bun run typecheck`, `bun run build`, `bun run format:check`, and `git diff --check`: passed.
- `bun run test:package`: passed clean pack/install, 64-file allowlist, public exports, server/core/RPC imports without renderer peers, installed native TUI, and consumer declarations. A second run with Bun 1.3.11 passed the installed standalone renderer check. The optional installed dashboard live PTY remained skipped because its explicit host flags were not set.
- `GUARD_SYNTHETIC_TUI=1 bun scripts/metrics-server-live.ts`: passed on OpenCode 2.1.2 and, with `GUARD_SYNTHETIC_BINARY`, on 2.0.29. Both exercised native chart controls, keyboard help, history failure/retry, polling cleanup, context traces, disabled history, RPC bounds/privacy, and child compaction after tools followed by continuation and success.

The package check's first Bun 1.3.11 attempt hit sandbox DNS failure (`EAI_AGAIN`) during npm installation; the approved rerun with registry access passed. The 2.0.29 host check's first sandbox attempt could not bind a local listener; the approved rerun passed. These are environment failures, not product test failures.

## Release boundary

The host checks use a synthetic provider. Genuine-provider accounting, remote routing, other platforms, and long-running terminal behavior remain outside this validation. The GitHub tag workflow, npm trusted-publisher stage, and 2FA approval have not run. The next authorized release action is to tag the final candidate commit as `v0.4.1` and push that tag; the workflow stages the package for separate npm approval.
