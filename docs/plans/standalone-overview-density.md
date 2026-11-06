# Standalone overview density and selection visibility

Date: 2026-11-06. Status: implemented and locally validated, including actual-host checks on OpenCode 2.0.29 and 2.1.2; see the [delivery report](../validation/standalone-overview-density-2026-11-06.md). Covers UX-04 and UX-05 from the [TUI UX review](tui-ux-review.md). The investigation and design targets below are retained as the implementation scope.

## Next improvement

Make the standalone dashboard Overview useful for comparing agents, and keep the selected agent's identity visible at narrow sizes. Deliver row density and selection reveal together: shorter rows reduce the problem, but do not by themselves establish correct behavior for small viewports, exceptions, resizing, or long identities.

At investigation, UX-01 and UX-02/UX-03/UX-06 were recorded as delivered; UX-04/UX-05 were the next P1 work. Native keyboard/help (UX-08) has since been [delivered independently](../validation/native-keyboard-help-2026-11-06.md). Sidebar density, terminology cleanup, and chart error recovery remain later increments.

## Investigation evidence

Source inspection and an offline probe of `terminalFixture()` through `TerminalShell.frame()` reproduced the current behavior:

| Geometry | Overview row heights | Observed result                                                                                                                                                                                                  |
| -------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 80×24    | 4 / 4 / 4 lines      | Three sessions consume twelve content lines.                                                                                                                                                                     |
| 40×20    | 9 / 8 / 8 lines      | First session consumes nine lines; the next session is cut off.                                                                                                                                                  |
| 20×12    | 19 / 18 / 18 lines   | Selected root's marker and row identity disappear; only its diagnostic tail remains in the body. The header still says `Selected: build`, which cannot distinguish the fixture's three identically named agents. |

These are current fixture measurements, including its blocked/uncertain compaction states, rather than future layout targets or actual-host validation.

`bun test tests/dashboardterminal.test.ts tests/dashboardview.test.ts tests/dashboardmodels.test.ts` passed **17 tests, 0 failures** during investigation. Existing geometry assertions check frame bounds and status text; they do not require the selected overview row's marker and identity to remain visible.

Relevant implementation findings:

- `src/dashboard/terminalview.ts:overviewRow` emits one diagnostic sentence containing full IDs, performance, age, and four freshness dimensions. `wrapped()` turns it into an unbounded card. `terminalDetail()` also uses that sentence before its complete snapshot field list.
- `src/dashboard/terminal.ts:TerminalShell.frame` computes a selected row's start/end and moves `rowOffset` to reveal its end. A row taller than the viewport can therefore lose its first line. `rowOffset` persists across frames, while `scroll` is reset by selection/history identity changes.
- Overview arrows already select by session ID through the controller. Models has separate behavior for scrolling within tall rows. Compact overview rows can preserve the existing direct session-selection behavior without introducing that additional interaction.
- `headerLines()` preserves shared Guard/connection explanations. Notices and filters also consume the body budget. `mountTerminal()` currently supplies page movement as `height - 4`, regardless of the actual header or row heights.
- `src/tui/panelformat.ts` provides a useful precedent for columns, cards, bounded indentation, and exceptional compaction labels. Its native-panel assumptions, current-route marker, and `Space expands` hint must not be copied into the standalone dashboard.
- `DashboardRow` already supplies occupancy, threshold distance/pressure, freshness, hierarchy, and scalar snapshots. This increment needs no additional transport fields or policy calculation.

## Interaction and layout contract

Keep Overview as the session selection screen. Up/Down and j/k select the adjacent session immediately; Enter or 2 opens its full Details; Escape/1 returns to Overview with that session selected. Keep existing search, filters, location selection, refresh, history, and Models bindings.

Use aligned columns at a proposed content width of **72 cells or more**. Verify that breakpoint with realistic labels before finalizing it. Columns show agent/model identity and hierarchy, execution state, context occupancy, and threshold distance/pressure. A column heading makes clear that Context is capacity occupancy and Threshold is policy pressure. Show prompt tokens/capacity and resolved threshold in Details; keep Overview focused on comparison.

Below the breakpoint, use a two-line card: identity and execution state first, occupancy and threshold second. Allow **one additional exception line** at either width. Ordinary rows are one line wide or two lines narrow; exception rows are at most two lines wide or three lines narrow. Never wrap a long diagnostic sentence to build an overview card.

Illustrative wide layout, with example values:

```text
Agent / model                  State    Context  Threshold
> build / synthetic/alpha      RUNNING      70%  100 below
  Completion unconfirmed · automatic retry suppressed
  └ explore / synthetic/beta   RUNNING      82%  20 over · Threshold reached
```

Use existing cell-aware clipping and sanitization. Clip agent/model text to its allocated cells; preserve the selection marker before indentation. Cap indentation by available identity space so deeply nested agents still have a readable name. Full identifiers and models remain in Details. For repeated or clipped identities, reserve room for a short session-ID discriminator, unique within the visible inventory where space permits; at very small sizes, a visible row position plus Enter-to-Details provides disambiguation without promising globally unique abbreviations.

The exception line prioritizes failed/interrupted execution, unresolved compaction, and stale/missing/invalid usage. Reuse existing lifecycle wording and preserve accepted-versus-completed distinctions. Combine only what fits; indicate additional diagnostics with `+N` and expose them in Details. Inventory/live freshness exceptions must remain discoverable even when performance is omitted from Overview. Normal performance and its freshness breakdown belong in Details.

Retained occupancy must say `Last measured` when stale; threshold pressure stays unknown. Approximate measurements retain their estimate indicator. Unknown values stay unknown. Use existing `thresholdDistance`/`pressureLabel` semantics, including equality for `>` versus `>=`; a threshold crossing must not imply scheduled compaction. At constrained widths, use explicit short text such as `Threshold ?` rather than clipping a conclusion into an ambiguous number.

## Viewport and selection rules

Compute the row viewport from actual header, notices, optional column heading, and footer heights. Reserve critical Guard/connection explanations and quit/details access before allocating optional inventory/location text. Preserve UX-06's suspended/reload and last-known status behavior. Cap ordinary notices and filter summaries in Overview, with an overflow hint and complete text in Details; do not clip away required recovery instructions to gain density.

Reveal the **start** of the selected row first. When the full bounded row fits, reveal it completely. When the available viewport is smaller than a normal card, derive a reduced card from the available height: two lines retain identity plus compact occupancy/threshold information, and one line retains the selection marker and identity. Remaining information is accessible via Details. The overview must never substitute a row's tail for its identity.

Track the selected session ID and row ranges rather than a frontend index. Recompute ranges after width/height changes or exception changes. Clamp/reset the overview offset after location changes, filtering, empty results, and selection removal using the controller's existing selection fallback. Returning from Details/history/help reveals the selected row. Do not introduce new sorting or selection fallback policy.

PageUp/PageDown should move by the number of session rows in the measured viewport, with at least one-session progress, rather than by `height - 4` sessions. Home/End continue selecting the first/last session. Editing text keeps precedence over navigation shortcuts.

At 80×24 and 40×20, target all three existing fixture identities visible at once, including their bounded exception lines. At 20×12, require the selected row marker and distinguishing identity, retained critical status, and details/quit access. At dimensions too small to fit status, identity, and footer together, provide a bounded minimal fallback; document this geometry limit instead of claiming complete usability at one cell.

## Implementation sequence

1. **Add compact overview formatting.** In `src/dashboard/terminalview.ts`, add pure heading/row helpers accepting width, selection, and any identity discriminator. Return already-sized lines. Reuse shared status and width primitives. Retain the existing complete diagnostic summary for Details, renaming `overviewRow` if helpful and migrating its callers/tests together. Keep raw snapshot fields and full scalar diagnostics available.
2. **Implement selection reveal and height budgets.** In `src/dashboard/terminal.ts`, replace wrapped diagnostic rows with bounded row blocks and measured row ranges. Handle the reduced-card fallback, heading/notices allocation, and offset reset/clamping. Keep shared screen scroll state separate from overview offset. Add contextual Overview footer text with Enter/2, arrows, help, and quit; narrow widths must retain a visible details action.
3. **Align keyboard paging with the layout.** Use the latest measured overview viewport for page movement, safely falling back before the first frame. Preserve editor priority, direct arrow selection, controller identity ownership, and Models/history behavior. Resize/redraw should use cached state, without new requests.
4. **Extend behavioral validation.** Add formatter cases and shell/native-renderer scenarios below. Update assertions that currently treat the verbose `overviewRow` sentence as Overview; keep the complete Detail diagnostic contract tested independently. Adjust the standalone PTY fixture only where its old text assumptions change.
5. **Document delivery.** Update README standalone behavior/help and `docs/testing.md`; update architecture only if presentation ownership changes. Add a dated delivery record with actual density/visibility measurements and host results or explicit skips, then mark UX-04/UX-05 delivered in the review.

The implementation adds no SDK/dependency change, RPC change, extra subscription, telemetry field, lifecycle change, version bump, or publication. Final layout choices and measured results are recorded in the delivery report.

## Acceptance and validation

| Scenario                            | Required evidence                                                                                                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing three-session fixture      | At 80×24 and 40×20, all three row identities are visible with bounded row heights; at 20×12, the selected row marker and distinguishing identity are visible.                                |
| Keyboard inspection                 | Select each child, open Details, read full ID/model/diagnostics, return, and retain the selected session and visible row identity.                                                           |
| Small viewport and exceptions       | One- and two-line row budgets show identity first; large notices or compaction exceptions cannot push the selected identity into an invisible row tail.                                      |
| Live updates and resize             | Preserve selection across value changes, reordering, exception changes, and wide/narrow resize; no stale offsets or blank selected viewport.                                                 |
| Filtering, location, removal, empty | Offset is clamped/rebased; fallback follows the controller; empty results show an actionable message without a phantom selection.                                                            |
| Unicode and repeated identities     | CJK, emoji, long models/IDs, duplicate agent names, and deep nesting respect cell bounds and preserve markers and meaningful identity. Full values remain inspectable.                       |
| Threshold and stale usage           | Below/near/reached/equality, missing/invalid, estimated, and stale states remain distinct; stale occupancy is labeled and pressure unknown.                                                  |
| Health and compaction               | Observe, disconnected, suspended/storage/reload states retain accurate consequences. Accepted, running, blocked, awaiting measurement, and uncertain states never imply verified completion. |
| Navigation and large inventory      | Arrows, paging, Home/End and repeated resize can reach every session in a bounded inventory; editors consume typed shortcut characters; help/history/Models regressions pass.                |
| Request and lifecycle behavior      | Presentation-only resizing/navigation does not add monitor streams or history/analytics reads. Existing terminal cleanup and failure tests still pass.                                       |

During implementation, run focused tests first:

```sh
bun test tests/dashboardterminal.test.ts tests/dashboardview.test.ts tests/dashboardmodels.test.ts tests/statusformat.test.ts
```

After implementation, run `bun run typecheck`, `bun test`, and `bun run format:check`. Extend the public native-renderer test to assert visible selected row content, not only frame dimensions. Use fixture counters to distinguish legitimate screen-entry reads from local redraw/navigation.

Run the existing opt-in synthetic-provider dashboard PTY harness on supported OpenCode 2.0.29 and 2.1.2, including 80×24, 40×20, 20×12, child inspection, and resize. Record actual results separately from these targets; report unavailable host checks as skips. Run build/package validation if the implementation changes bundling, exports, or dependency boundaries. Preserve existing scalar-only privacy checks and terminal restoration coverage.
