# Consistent threshold and Guard status across terminal surfaces

Date: 2026-11-06. Status: implemented and locally validated; see the [delivery record](../validation/threshold-status-consistency-2026-11-06.md). Delivered after [UX-01](native-panel-overview.md), covering UX-02, UX-03, and UX-06 from the [TUI UX review](tui-ux-review.md).

## Recommendation and evidence

Make the sidebar, native panel, and standalone dashboard answer the same two questions: how close is the measured context to the policy threshold, and what can Guard currently do? This follows the review's delivery order and fixes misleading behavior before the standalone density and scrolling changes (UX-04/UX-05).

Source inspection before this increment confirmed the following gaps:

| Surface/source                                                              | Current behavior                                                                                              | Required change                                                                                                                           |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar `mainSections` in `src/tui/compactformat.ts`                        | Says “48K tokens until compaction”; independently calculates distance even for stale usage.                   | Render threshold distance from the existing row projection; stale values describe the last measurement and have unknown current pressure. |
| Sidebar `agentLines` in the same module                                     | Occupancy bar and percentage appear beside WARNING/CRITICAL without naming their different denominators.      | Label capacity occupancy separately from “Near threshold” / “Threshold reached.”                                                          |
| Native `src/tui/panelformat.ts`                                             | Already separates occupancy and threshold distance, preserves comparison equality, and explains observe mode. | Reuse this behavior across surfaces and consolidate the duplicated short status strings in `panel.tsx`.                                   |
| Native panel header and sidebar notices                                     | Connection and enforcement are independent strings; sidebar shows raw reason codes.                           | Explain connection consequences and Guard behavior without suggesting that reconnect restores enforcement.                                |
| Standalone `overviewRow` / `headerLines` in `src/dashboard/terminalview.ts` | Shows raw pressure and enforcement codes; the long header can clip enforcement on narrow screens.             | Apply the same primary labels and reserve visible space for consequential status. Preserve exact values in Details.                       |

`src/family.ts:metric` already computes occupancy against effective input capacity, pressure against the policy trigger, and signed distance only for fresh measurements. It respects `>` versus `>=` and the existing 90% near-threshold boundary. No policy calculation change is needed.

`MonitorHealth` already supplies enforcement and reason codes. `Connection` distinguishes loading, live, reconnecting, unavailable, and incompatible. Health may be retained after disconnect; native connection state can aggregate multiple location clients while health follows the current session's client. The formatter must not treat those as proof of one globally live, enforceable location.

Investigation baseline: `bun test tests/panelformat.test.ts tests/sidebar.test.ts tests/tuirender.test.tsx tests/dashboardterminal.test.ts` passed **19 tests, 0 failures**. This is evidence for existing behavior, not validation of the proposed change. No new actual-host session or user study was performed.

## Scope

Change presentation helpers, primary status/copy, fixtures, and user documentation. Preserve policy, scheduler, accounting, transport, RPC schemas, selection, subscription ownership, and existing keyboard bindings. Keep detailed diagnostic codes and numeric fields inspectable.

Standalone row density/reachability, sidebar collapse/history defaults, new shortcuts, broad lifecycle terminology work, and chart-error recovery were outside this increment. Row density/reachability has since been [delivered as UX-04/UX-05](../validation/standalone-overview-density-2026-11-06.md); native keyboard/help (UX-08) has also since been [delivered independently](../validation/native-keyboard-help-2026-11-06.md). Sidebar defaults have since been [delivered as UX-07](../validation/sidebar-density-2026-11-06.md); broader terminology and chart-error recovery remain follow-up work. Limited status layout adjustments were necessary here so the new explanation remained visible. No version bump or publication is included.

## Presentation contract

| Observed state                                      | Primary wording/behavior                                                                                                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh usage below trigger                           | “48K tokens below threshold”; add “Near threshold” when the existing pressure projection says near.                                                                                    |
| Fresh usage above trigger                           | “12K tokens over threshold” and “Threshold reached.” Neither phrase promises admission or completion.                                                                                  |
| Exactly at trigger, `>=`                            | “Threshold reached.”                                                                                                                                                                   |
| Exactly at trigger, `>`                             | “At threshold · crossing requires more”; retain the exact operator in Details.                                                                                                         |
| Capacity occupancy                                  | “Context 112K / 500K · 22%”; avoid placing an unlabeled threshold severity beside this percentage.                                                                                     |
| Stale usage                                         | “Last measured 112K / 500K · 22%”; current threshold pressure/distance is unknown. Historical chart levels may remain, visibly held.                                                   |
| Missing or model-invalid usage                      | Unknown tokens/occupancy/pressure; never invent zero or reuse an invalid model's measurement.                                                                                          |
| Live + observing                                    | “Live · Observing”; explain “Guard won't request compaction.” OpenCode native compaction remains available.                                                                            |
| Live + available                                    | “Live · Guard automatic requests enabled”; per-session admission gates still apply.                                                                                                    |
| Disabled                                            | “Guard disabled”; do not imply native OpenCode compaction is disabled.                                                                                                                 |
| Suspended after event-stream gap                    | “Guard suspended · reload required,” including after observation reconnects.                                                                                                           |
| Suspended for persistence failure                   | Explain that safety storage is unavailable and Guard requests are suspended. Safety-storage failures are latched for the instance; repair the unavailable storage and reload.          |
| Loading or absent health                            | “Connecting” / “Guard status unknown”; never infer enforcement from configured mode alone.                                                                                             |
| Reconnecting/unavailable with retained measurements | “Reconnecting” / “Connection unavailable” plus “Showing last received measurements.” Guard status is last known; client disconnection alone does not prove server enforcement stopped. |
| Reconnecting/unavailable without measurements       | State that no measurements are available; do not claim cached data exists.                                                                                                             |
| Incompatible monitor contract                       | “Monitoring unsupported”; retain compatibility context in Details. Do not present it as a transient disconnect.                                                                        |

Connection, measurement freshness, enforcement, execution, and compaction lifecycle remain independent facts. A live stream does not make an old measurement fresh. A client refresh/reconnect never changes server suspension. Keep accepted, running, ended-but-checking, blocked, and uncertain states distinct through the existing compaction labels; broad lifecycle-copy changes are UX-09.

Use known reason codes for specific explanations and a generic “Guard suspended · see Details” for unrecognized codes. Preserve all exact codes in diagnostics. Multiple reasons must not hide a persistent suspension behind a less consequential notice.

At ordinary widths, status should fit in the current header budget. At narrow widths, use a short connection line and a short Guard consequence line, prioritizing suspension/recovery and close/help access. Do not clip the consequence off the end of a title. At 20×12 preserve these essentials and selected identity; details may scroll. Sizes below the usable geometry may retain the current minimal fallback.

## Implementation sequence (completed)

1. **Create shared presentation helpers.** Add a renderer-free module such as `src/tui/statusformat.ts` for threshold distance, pressure labels, and Guard/connection messages. Accept existing typed row/health/connection facts plus an explicit retained-measurement flag. Return semantic text/priority rather than terminal geometry. Move or delegate `thresholdDistance` and `panelStatus` from `panelformat.ts`; preserve import compatibility where useful. Keep common helpers independent of `compactformat.ts` to avoid a cycle when the sidebar consumes them; extract the small token formatter if needed.
2. **Fix sidebar threshold semantics.** Replace the independent `remaining` calculation with the shared fresh-row distance. Label capacity and threshold separately in main and agent sections. Mark stale quantities as last measured and retain existing held-chart behavior. Keep chart geometry, performance fields, tree ordering, and section controls intact. Review any affected `format.ts` diagnostic labels without deleting exact operators, phases, or policy fields.
3. **Unify native status.** Use the shared messages in `compact.tsx` notices and `panel.tsx` headers, replacing duplicate narrow strings. Preserve fixed critical status in Overview, Details, and Charts and the UX-01 height budget. Keep the current state ownership and aggregated connection behavior; use conservative wording when connection and health describe different scopes rather than claiming location-wide certainty.
4. **Apply standalone wording.** Update `overviewRow` and `headerLines` with the same threshold/occupancy/status meaning. Use `DashboardRow` inventory/live/performance stale flags independently; do not collapse them into measurement age. Keep `snapshotFields` and raw detail values intact. Adjust only header budgeting in `TerminalShell.frame` as needed; leave the known tall-row reachability issue explicitly assigned to UX-05.
5. **Validate and document.** Update sidebar golden frames intentionally, extend existing panel/dashboard renderer scenarios, and update README and compatibility wording for status consequences. Record actual results in a dated delivery report and then mark UX-02/UX-03/UX-06 delivered in the review.

Steps 1–4 were delivered together. The [delivery record](../validation/threshold-status-consistency-2026-11-06.md) records the final behavior, checks, and remaining boundaries.

## Acceptance and checks

Extend the existing formatting and renderer tests around observable behavior:

- Below/near/over threshold, strict and inclusive equality, and occupancy far from the threshold percentage all produce separate, accurate labels. Existing 90% pressure boundaries remain unchanged.
- Stale measurements keep occupancy and held charts while distance/pressure become unknown; missing/invalid measurements remain unknown and estimates remain labeled.
- Observe, available, disabled, suspended, absent health, unsupported monitoring, and disconnected states render their actual consequences. Cover retained versus absent data and a disconnect/reconnect that keeps suspension visible.
- Accepted/ended/uncertain compaction remains distinguishable from completion/recovery; exact codes and complete scalar details remain inspectable.
- At 80×24, 40×20, and 20×12, critical status, selected identity, and essential controls remain visible across native panel modes and standalone screens. Check sidebar widths 16/20/35, CJK/emoji, and long reasons using cell-aware wrapping.
- Native view switches and dashboard redraws preserve selection and the existing one-consumer/one-stream behavior. Status formatting does not issue reads or mutate enforcement.

Run targeted tests during implementation:

```sh
bun test tests/panelformat.test.ts tests/sidebar.test.ts tests/tuirender.test.tsx tests/dashboardterminal.test.ts
bun run typecheck
bun test
bun run format:check
git diff --check
```

Run the full offline suite separately from compilation-heavy live jobs. If shared-state/transport code becomes necessary, first reassess scope and include its focused regressions. Package validation is needed if exports, dependency loading, or entry boundaries change.

Use the repository's existing opt-in synthetic-provider harnesses for native and standalone PTY status/resize checks; inspect their current controls in `docs/testing.md` before execution. Reuse supported installed hosts and record exact versions. Mocked state transitions establish the message matrix; an actual host smoke establishes integration and geometry. Report unavailable live checks as skipped, and do not claim new 2.0.29, genuine-provider, remote, or terminal-environment certification from local offline results.

The next increment, UX-04/UX-05, was implemented together: compact standalone overview rows and selected identity preserved through narrow scrolling. See the [implementation plan](standalone-overview-density.md) and [delivery record](../validation/standalone-overview-density-2026-11-06.md). The verbose `overviewRow` helper referenced in this historical plan is now `diagnosticRow`, retained for Details; Overview uses bounded `overviewRowLines`.
