# Threshold and Guard status consistency validation — 2026-11-06

Implements UX-02, UX-03, and UX-06 from the [TUI UX review](../plans/tui-ux-review.md), following the [implementation plan](../plans/threshold-status-consistency.md).

## Delivered behavior

The native sidebar, `/context-guard` panel, and standalone terminal dashboard use shared presentation helpers in `src/tui/statusformat.ts`. Tokens below/over the policy threshold describe a measurement, without promising compaction. Capacity occupancy and threshold pressure have separate labels. “Near threshold” and “Threshold reached” replace the sidebar's WARNING/CRITICAL wording. Strict equality says that crossing requires more; inclusive equality says the threshold is reached. Existing policy boundaries are unchanged.

Stale sidebar measurements no longer produce a current threshold distance or pressure percentage. Occupancy remains visible as “Last measured,” and held context-chart history retains its existing behavior. Native Details uses the same threshold wording and retains diagnostic policy, comparison, provenance, and lifecycle fields. Standalone Details retains every snapshot field, including exact policy and lifecycle codes.

Connection labels explain loading, reconnecting, unavailable, and unsupported monitoring. Disconnected clients identify last-known Guard health and distinguish retained measurements from absent measurements. Client connection loss does not imply that server enforcement stopped. Reconnection does not clear suspension. Event-stream gaps require reload; latched safety-storage failures explain repair and reload. Unknown suspension reasons point to Details. Monitoring-capacity and model-limit warnings remain visible with plain language; exact reason codes remain in Details.

Native short status strings share the same reason handling as wide status. Standalone status has dedicated header space, with selected identity in the short-height header and help/quit retained in the narrow footer. Below usable status geometry, a bounded minimal header preserves the existing Models scrolling behavior. The sidebar golden frame was intentionally updated for the new wording.

No policy, scheduler, accounting, RPC, transport, subscription, dependency, export, or entry boundary changed. The shared compact token formatter moved to `src/tui/quantity.ts` to avoid circular presentation imports; its existing sidebar export is retained. No version bump or publication is included.

## Offline results

- `bun test`: **209 passed, 0 failed**, across 29 files on Bun **1.1.34**.
- `bun run typecheck`: passed with strict settings.
- `bun run build`: passed for server, core, RPC, CLI, compiled Solid TUI, and declarations.
- `bun run format:check`: passed.
- `git diff --check`: passed.

Shared-helper tests cover the existing 90% near boundary, strict/inclusive equality, over-threshold distance, occupancy with a different denominator, stale and missing pressure, every connection state, absent health, observe/available/disabled enforcement, specific and combined suspension reasons, unknown reasons, and persistent suspension through reconnect.

Native renderer coverage includes event-gap and safety-storage suspension during reconnect and after live recovery at 80×24, 40×20, and 20×12. Selected identity, reload/repair consequences, close access, and consumer cleanup remain reachable. Existing view transitions, chart geometry, selection identity, and sidebar theme/control tests pass. Sidebar formatting covers stale/invalid/missing quantities and cell widths 16/20/35/80; narrow renderer checks allow the longer threshold labels to wrap.

Dashboard coverage checks status and reload visibility across Overview, Details, History, and Models at 80×24, 40×20, and 20×12, including last-known data during reconnect and unchanged single-stream ownership. The full suite caught a one-column Models reachability regression from an overly broad minimal-screen fallback; the bounded header was corrected, and the existing complete-row scrolling test passes again.

## Actual host results

Standalone command:

```sh
GUARD_DASHBOARD_HOST=1 GUARD_DASHBOARD_BUN=/tmp/guard-terminal-runtime/node_modules/@oven/bun-linux-x64/bin/bun bun scripts/dashboard-terminal-live.ts
```

Passed on isolated authenticated **OpenCode 2.1.2**, using **Bun 1.3.11** for the built terminal CLI. The synthetic-provider smoke passed populated root/concurrent-child metrics, all metrics/windows, navigation, resize, stale measurements after interruption, authenticated restart recovery, privacy checks, and terminal restoration. Native OpenCode ran in a separate PTY and remained alive after dashboard exit. The interruption assertion was updated to the new “Last measured” wording. Initial sandbox execution could not open its loopback listener; the approved rerun passed.

Native command:

```sh
GUARD_SYNTHETIC_TUI=1 bun scripts/metrics-server-live.ts
```

The isolated **OpenCode 2.1.2** host passed actual PTY slash entry, chart/window/arrow controls, refresh, panel close/toggle polling cleanup, and continued monitoring. Actual 180/80-column context-chart checks passed held context, child activity, lower reported usage, and manual compaction. The surrounding server smoke also passed the three RPCs, hierarchy/model changes, history ownership/bounds, restart/retention behavior, disabled history, and scalar privacy canaries. Child compaction completed, execution continued, and the child subsequently succeeded. Injected offline states establish the detailed suspension-message matrix; this host smoke establishes integration rather than every failure remedy.

## Remaining boundaries

No new interactive OpenCode 2.0.29, genuine-provider, cross-machine remote, tmux, Neovim-terminal, or other-platform certification is claimed. The pinned 2.0.29 SDK remains the compile baseline. Browser checks and registry-dependent package installation were not run for this presentation change; exports and dependency boundaries are unchanged.

At this increment's delivery, standalone overview density and tall-row scrolling (UX-04/UX-05), sidebar collapse/history defaults, additional keyboard access, broader lifecycle terminology, and chart-error recovery remained follow-up work. UX-04/UX-05 have since been [implemented and validated](standalone-overview-density-2026-11-06.md). Sidebar density (UX-07) has since been [implemented and validated](sidebar-density-2026-11-06.md), following its [implementation plan](../plans/sidebar-density.md). Native keyboard/help (UX-08), [plain-language terminology (UX-09)](plain-language-terminology-2026-11-07.md), and [chart recovery (UX-10)](chart-failure-recovery-2026-11-07.md) have also been delivered. This status increment added fixed selected identity in short standalone headers; the later overview increment addresses row density and reachability.
