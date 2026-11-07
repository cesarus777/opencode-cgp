# Native chart continuity through help

Date: 2026-11-07. Status: implemented and verified offline after UX-01 through UX-10.

## Finding

The [TUI UX review](tui-ux-review.md) asks users to inspect a child, view its charts, and return without losing selection. All ten numbered recommendations are delivered, but [UX-10 validation](../validation/chart-failure-recovery-2026-11-07.md#limits) records one remaining interruption: opening native help destroys the mounted chart and its retained result. In `src/tui/panel.tsx`, Charts renders under `!help()`; in `src/tui/charts.tsx`, each mount creates a new `HistoryState` and disposes it on unmount. Returning from help therefore starts a new read and shows loading, even if the same session and window had a usable chart.

## Next improvement

Keep the matching chart visible immediately after closing help. Help must pause chart polling and cancel an in-flight read; it must not silently keep a network consumer active behind the help screen. The retained result must remain labeled with its original range and load time until a new read succeeds. An explicit `r` refresh may start a new read after help closes. Changing session, owning location, or window must discard the old result before showing the new query.

This is a narrow native-panel interaction fix. It needs no RPC, archive, policy, or public configuration change.

## Implementation plan

1. Move the chart request controller's lifetime from the conditional `HistoryCharts` child to the panel's Charts view lifetime, or retain a bounded controller/view pair in the panel and pass it to a presentation-only chart component. Keep one controller for the active chart query. Do not make the transport or history cache global.
2. Add an explicit pause/resume operation to `HistoryState`: pause clears its timer and aborts its active read while retaining only a successful matching result; resume schedules or starts one read according to the existing polling cadence. Guard late settlements with the existing generation checks. Keep disposal for panel close or departure from Charts.
3. Make help toggle pause/resume without clearing selected session, metric, window, scroll position, or the matching chart result. Preserve the existing help layout and keybindings. Keep query changes authoritative even while help is open so a changed location cannot reveal another location's chart on return.
4. Add deterministic state tests for success → help → return, an in-flight read interrupted by help, late success/failure after pause, query change during help, repeated help toggles, manual refresh, and panel disposal. Extend the native renderer fixture to assert immediate retained chart and no extra active monitor/history reader while help is shown.
5. Run focused history/native renderer tests, typecheck, format check, then the offline suite. Validate the interaction in a synthetic-provider OpenCode 2.0.29 and 2.1.2 PTY at 80×24 and 20×12. Record request counts, visible status, selection, privacy, and terminal restoration. Update configuration/help documentation only if visible wording or controls change.

## Acceptance criteria

- Closing help on the same Charts query shows its last successful plot immediately, with the original range and receipt time; no loading flash replaces it.
- Help has no background chart polling or active chart read. A late response cannot overwrite the retained view.
- Session, location, or window changes never show a mismatched plot. Metric and width changes continue to reuse the same result.
- Existing retry/failure labels, one-read serialization, selection, and keyboard controls still behave as documented.

Browser delivery remains separate stage-4 work in the [standalone dashboard plan](standalone-dashboard.md); it is a larger new surface rather than this focused UX follow-up.

## Delivery check

The panel now owns a single history controller and passes its view to the chart renderer. Help pauses its timer and aborts an active read while keeping the matching result; returning resumes the cadence without an immediate replacement of a usable plot. The controller remains bounded to one panel and is disposed with that panel. The offline suite passes 234 tests; typecheck, build, formatting, and diff checks pass. Synthetic-provider native PTY checks passed on OpenCode 2.0.29 and 2.1.2 during 0.4.1 preparation; see the [release record](../validation/release-0.4.1-2026-11-07.md).
