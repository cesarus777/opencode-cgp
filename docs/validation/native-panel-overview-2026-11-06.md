# Native panel overview validation — 2026-11-06

Implements UX-01 from the [TUI UX review](../plans/tui-ux-review.md), following the [native panel plan](../plans/native-panel-overview.md).

## Delivered behavior

`/context-guard` opens Overview with a fixed selected-session summary and a nested family list. Wide content uses aligned State, Context, and Threshold columns; narrow content uses compact cards. Small panel heights reduce the summary. Diagnostics and the context-history chart appear in Details (`i`); retained performance Charts remain available with `c`. Footer actions support clicks as well as keys.

Selection follows session identity through view switches and value/order changes. Removing the selected row falls back to the route session, then the first available family member. Empty families cannot navigate. The route continues to define family scope; `>` marks selection and `*` marks the current OpenCode session.

Up/Down selects in Overview/Charts and scrolls in Details. PageUp/PageDown and Home/End move family selection in Overview and scroll content in Details/Charts. Refresh retains its existing state ports; load-more is active only for incomplete inventory in Overview. Critical Guard status remains outside the scroll viewport. Stale occupancy says last measured; pressure stays unknown. Threshold distance does not promise compaction, and accepted/uncertain states retain their lifecycle meaning.

The panel owns one consumer across all views. Context traces continue updating through the existing bounded store without requiring the chart to be mounted. The sidebar frame, server contracts, policy, accounting, and compaction lifecycle are unchanged.

## Offline results

- `bun run typecheck`: passed with strict TypeScript settings.
- `bun test`: **205 passed, 0 failed**, across 28 files.
- `bun run format:check`: passed.
- `bun run build`: passed; server, core, RPC, CLI, compiled Solid TUI, and declarations emitted.
- `git diff --check`: passed.

Formatting tests cover separate occupancy/threshold quantities, inclusive and strict equality, stale/invalid/missing data, estimates, wide rows and narrow cards, deep/long CJK/emoji identities, and admission/uncertainty labels.

The public native renderer fixture covers default Overview without diagnostic charts, explicit root/child Details, scroll-to-end reachability and chart geometry, chart selection/window/metric behavior, mouse footer actions, identity preservation/removal fallback, empty navigation, partial inventory, persistent suspension warnings, focus scoping, and consumer cleanup. It checks 80×24, 40×20, and 20×12 geometry plus a 150-row family with the selected row visible after windowing. Repeated view changes do not reacquire the panel consumer. The unchanged sidebar golden frame and shared-state transport tests pass.

## Actual host results

Executed:

```sh
GUARD_SYNTHETIC_TUI=1 bun scripts/metrics-server-live.ts
```

The disposable authenticated **OpenCode 2.1.2** host and synthetic provider completed successfully. Actual PTY checks passed slash entry, performance chart controls and window labels, family selection, refresh, abort/polling cleanup on view switch/close, and continued monitoring. The driver now expands completed branches in Overview and opens Details before inspecting context charts.

Actual 180/80-column context-chart checks passed held/lower measurements, child activity/permission waits, manual compaction, and trace continuity through panel/sidebar transitions. The surrounding harness also passed all three RPCs, history bounds/ownership, disabled history, privacy canaries, and completed child compaction followed by continuation and execution success. These checks exercised a synthetic provider, not genuine-provider accounting.

No new interactive certification is claimed for OpenCode 2.0.29, cross-machine remote clients, tmux, Neovim terminals, or other platforms. The pinned 2.0.29 SDK remains the compile baseline; earlier host evidence remains separate. Browser report validation and registry-dependent package installation were not run for this presentation change.
