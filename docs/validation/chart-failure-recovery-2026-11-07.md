# Chart failure and recovery validation

Date: 2026-11-07. Implements UX-10 from the [TUI UX review](../plans/tui-ux-review.md); see the [implementation plan](../plans/chart-failure-recovery.md) for investigation and acceptance criteria.

## Delivered behavior

Native performance Charts and standalone session History distinguish unavailable history registration, timeout, incompatible output, rejected input, and generic read failure. Only structured missing-RPC codes imply missing registration; HTTP 404/503 and arbitrary message text do not. Messages contain fixed approved wording and never expose server errors. Disabled recording and empty history remain successful, distinct outcomes.

Native Charts retains one matching successful response during manual/background refresh and failure, showing **Showing previous results** with the UTC time of the last successful load. Its original range stays attached to the plot. Owning location, full session identity, or window changes clear mismatched data immediately. Metric and width changes reuse data. A single active request, one coalesced pending retry, generation checks, and cleanup prevent obsolete settlements from changing the current query. Native missing/incompatible/rejected services and disabled recording have no polling timer; **r** or remount checks again. Empty history and retryable failures poll five seconds after settlement. The secondary footer leads with **r refresh** at narrow widths.

Standalone History retains its existing serialized queue, 16-entry cache, and periodic refresh. Its immutable projection adds an approved failure reason and successful receipt time. Both surfaces share recovery wording. Standalone disabled recording hides plots and exact observations; initial failure no longer claims empty retained history or stale cached results without a response. Chart recovery does not change monitoring, enforcement, or compaction completion semantics.

## Offline evidence

`bun test` passed **233 tests, 0 failed, across 32 files**. The original 40-test investigation baseline is recorded separately in the plan.

Strict type checking, repository formatting, the production build (including Solid TUI and declarations), and `git diff --check` also passed.

- Shared boundary tests cover both missing-RPC codes, input/output/internal errors, HTTP-status ambiguity, timeout, schema validation, and foreign-session series. Actual SDK-shaped connection responses and native owning-location reads verify normalization at both adapters. Private-message canaries are absent from normalized errors and rendered/projected output.
- Deterministic native state tests cover retained range/receipt time, transient failure and polling recovery, rapid refresh coalescing, disabled/empty results, paused capability polling, explicit retry, ownership/window changes, A → B → A late success/failure, deadline versus navigation cancellation, and disposal.
- Dashboard controller tests preserve original cached range/receipt time through all approved failures and clear reason/data correctly on selection/recovery. Existing serialization, location, filters, and cleanup coverage remains in place.
- The public Solid renderer fixture exercises native failure/retry and scroll controls at **80×24, 40×20, and 20×12**, including visible refresh hints, privacy, help cancellation, preserved identity, and one monitor consumer. Terminal formatting tests put recovery/stale status before plots at 20/40/80 columns, retain chart bounds, and suppress phantom chart/sample output for initial failure or disabled recording. Existing terminal frame bounds and keyboard tests pass.

Focused reproduction:

```sh
bun test tests/historyclient.test.ts tests/historystate.test.ts tests/tuistate.test.ts tests/tuirender.test.tsx tests/dashboardconnection.test.ts tests/dashboardcontroller.test.ts tests/dashboardterminal.test.ts
bun run typecheck
bun run format:check
bun run build
```

## Actual-host synthetic-provider evidence

Native PTY harnesses passed on **OpenCode 2.1.2 and 2.0.29**. Their disposable proxies inject missing history registration, one HTTP 503, and a delayed read exceeding the deadline. Checks verify accurate error text, retained-result labels, last-loaded timestamp, and successful keyboard retry. Missing history capability pauses native polling. Existing navigation, help, continued monitoring, hierarchy, chart continuity, disabled-history, privacy, and synthetic compaction/continued-execution checks also pass.

The standalone PTY harness passed on **OpenCode 2.1.2 and 2.0.29**, using the built CLI and Bun 1.3 runtime. It exercises the same three history failures and successful retries, plus populated root/children, all metrics/windows, 80×24/40×20/20×12 overview layouts, Models, restart recovery, privacy, independent native client, and terminal restoration.

An initial standalone 2.1.2 attempt failed its read-count assertion: the harness previously counted history only when the RPC ID appeared in the body, omitting URL-addressed requests. Correct URL counting exposed a periodic refresh during metric navigation. The corrected harness accounts for production inventory refreshes when comparing request counts; deterministic offline tests continue asserting no presentation-triggered reads. The subsequent complete 2.1.2 run passed with no product change for that failure.

Reproduction in this environment:

```sh
bun run build
GUARD_SYNTHETIC_TUI=1 bun scripts/metrics-server-live.ts
GUARD_SYNTHETIC_TUI=1 GUARD_SYNTHETIC_BINARY=/tmp/guard-terminal-host-2029/node_modules/@opencode/cli-linux-x64/bin/opencode bun scripts/metrics-server-live.ts
GUARD_DASHBOARD_HOST=1 GUARD_DASHBOARD_BUN=/tmp/guard-terminal-runtime/node_modules/@oven/bun-linux-x64/bin/bun bun scripts/dashboard-terminal-live.ts
GUARD_DASHBOARD_HOST=1 GUARD_DASHBOARD_BUN=/tmp/guard-terminal-runtime/node_modules/@oven/bun-linux-x64/bin/bun GUARD_DASHBOARD_BINARY=/tmp/guard-terminal-host-2029/node_modules/@opencode/cli-linux-x64/bin/opencode bun scripts/dashboard-terminal-live.ts
```

Harnesses need loopback listeners and PTYs; sandbox listener failures were rerun with approval. Fault controls exist only in disposable test proxies. Raw native session screens are not retained as failure diagnostics.

## Limits

Synthetic-provider and fault-injected evidence does not certify genuine-provider accounting, cross-machine remote routing, other platforms, tmux/Neovim, or long-running behavior. Tiny terminals require scrolling to read every remedy; retry/help/close stay accessible. At this delivery, native help/close discarded the mounted chart's retained result and returning loaded afresh. A later [chart-help continuity change](../plans/native-chart-help-continuity.md) retains a matching result through help; closing the panel still discards it. No RPC/archive/dependency/export or release contract changed; registry-dependent package installation validation was not rerun for this increment.
