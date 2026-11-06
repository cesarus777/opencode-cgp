# Compact sidebar defaults

Date: 2026-11-06. Status: implemented; see the [delivery record](../validation/sidebar-density-2026-11-06.md) for validation and limitations. The investigation and targets below record the implementation scope. Covers UX-07 from the [TUI UX review](tui-ux-review.md), after the delivered [standalone overview increment](standalone-overview-density.md).

## Original recommendation and investigation

The investigation selected sidebar density next. UX-01 through UX-06 already had delivery records linked from the review; UX-07 was next in its delivery order. Native keyboard/help (UX-08) has since been [delivered independently](../validation/native-keyboard-help-2026-11-06.md); broader terminology (UX-09) has since been [delivered](../validation/plain-language-terminology-2026-11-07.md). Chart-error recovery (UX-10) remains the next increment. Preserve the delivered panel help, inventory feedback, optional keyboard entry, and existing page navigation when implementing this sidebar plan.

The sidebar should answer which session is running, its context occupancy, which descendant needs attention, and what Guard can do. Default to a short summary and descendant tree; make history optional and move performance and aggregate diagnostics into panel Details.

| Source                                     | Current evidence                                                                                                                                              | Implementation consequence                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/tui/compactformat.ts`, `mainSections` | Optional performance precedes identity; the current-session history chart is always emitted.                                                                  | Put identity first and use a capacity occupancy bar by default, with explicit history disclosure.   |
| `tests/fixtures/sidebar-frame.txt`         | Four descendants occupy 63 lines at 39 columns, without optional performance or exceptional compaction.                                                       | Measure the same fixture before/after; the review's approximate 65 lines is not a precise baseline. |
| `src/tui/compact.tsx`                      | Descendants get a heading, optional performance, bar, token totals, threshold, execution line, optional lifecycle, and blank separator. Panel access is last. | Use two ordinary lines per descendant, remove separators, and move panel access above the tree.     |
| `subagentTree` in `compactformat.ts`       | Descendant scope, active-first sibling sorting, folding, cycle/depth bounds, and preservation of completed parents with visible children already exist.       | Extend the existing projection and preserve full-ID actions and hierarchy.                          |
| `src/tui/compact.tsx`                      | Completed entries start visible; hiding completed leaves does not inspect lifecycle exceptions.                                                               | Introduce conservative completed grouping and preserve existing palette command IDs.                |
| `src/tui/panelview.tsx`, `PanelDetails`    | Performance and context history are inspectable; sidebar aggregate statistics are absent.                                                                     | Add explicitly scoped family statistics to Details before removing sidebar statistics.              |
| `compact.tsx` and `state.ts`               | A shared bounded context trace is derived independently of retained performance history.                                                                      | Keep collecting while the graph is hidden, without extra consumers or history requests.             |
| `scripts/fixtures/metrics-tui.py`          | Host checks expect an always-visible sidebar graph and fixed chart-row geometry.                                                                              | Expand history explicitly before capture and preserve trace-continuity assertions.                  |

Investigation validation: `bun test tests/sidebar.test.ts tests/tuirender.test.tsx tests/statusformat.test.ts` passed **12 tests, 0 failures**. This establishes the current baseline, not validation of this proposal. No new actual-host session was run. Existing restrictions remain in [compatibility](../compatibility.md): sidebar placement is host-controlled and normally absent on child routes.

## Implementation readiness review

Before implementation, rechecked after UX-08 on 2026-11-06 at commit `ca4c31c`. The next increment was UX-07: the reviewed default frame still had **63 lines at 39 columns**, and `compact.tsx` still rendered history, descendant diagnostics, and statistics before panel access. At that point UX-09 and UX-10 were separate follow-ups; UX-09 has since been delivered. Reuse `compactionLabel` from `panelformat.ts` for sidebar exceptions rather than introducing another lifecycle translation.

The refreshed baseline command, `bun test tests/sidebar.test.ts tests/tuirender.test.tsx tests/statusformat.test.ts tests/tuistate.test.ts`, passed **17 tests, 0 failures**. This is evidence for the current implementation only. That planning update included no implementation or new actual-host validation; subsequent results are in the delivery record.

Resolve these details as part of the first implementation step:

- **Discovery controls grouping.** Pass `state.inventoryStatus()` into the sidebar projection. Automatic completed grouping is enabled only when discovery is complete, not scanning, and neither failed nor damaged. Otherwise keep discovered completed rows visible and label counts as partial. This avoids treating an undiscovered active child as an absent child. A change in discovery status must reveal affected rows without requiring a click.
- **Traversal limits are uncertainty.** Deduplicate by full session ID and keep the existing depth/node bounds. A cycle, omitted descendants (`row.hidden`), or a traversal cutoff makes the affected branch ineligible for automatic grouping; do not infer that its subtree completed normally. Return grouping counts and fold attention metadata from the same bounded projection, independent of the visible-row list.
- **Widths mean outer rendered columns.** The current sidebar subtracts four cells for borders/padding: 39, 35, and 20 outer columns leave 35, 31, and 16 content cells before descendant indentation. Budget identity, disclosure, and pressure text against the remaining cells, using `cells` rather than string length. At 35 columns a compact second line such as `Ctx 82% · Threshold reached` fits a top-level row; `Ctx 34% · Threshold below` fits the fixture's nested child. Use full wording when it fits, and bounded wrapping when deeper nesting or exceptions require it. The two-line target applies to the ordinary fixture, not arbitrary identities, depths, or exception messages.
- **Details receives a separate family scope.** Add a memo in `panel.tsx` using `state.rows([], true)` and route-descendant projection. Pass route ID, scoped rows, and inventory completeness explicitly into `PanelDetails`; retain selected-session rows for its existing ancestry and diagnostic rendering. Do not derive family statistics from `rows(order())`, selected-session descendants, or sidebar visibility. Label the family section with its route identity and partial state so inspecting a child cannot silently change the aggregate's meaning.
- **Host checks follow disclosure state.** `metrics-tui.py` currently waits for `70% used`/`50% used`/`10% used` and captures an always-mounted sidebar chart. Expand sidebar history before those checks and again after any remount that resets disclosure. Preserve the existing plateau, lower-reading, and post-compaction assertions; a default occupancy bar cannot satisfy chart-continuity evidence.

## Current-session summary and history

Render identity and execution first, then measured tokens/capacity and one capacity occupancy bar. Keep threshold distance separate using `thresholdDistance`; include “Near threshold” or “Threshold reached” when relevant. Keep confidence, measurement age, stale/unknown qualifiers, and `~` for estimates. Above-capacity usage retains its actual textual percentage while the bar clips visually.

Retain connection and Guard consequences from `statusformat.ts`, including last-known health, reload/repair remedies, and unverified runtime notices. Density targets must not remove these messages. Stale occupancy says “Last measured”; stale or invalid usage cannot produce current pressure. Non-idle compaction stays explicit using existing `compactionLabel` wording, preserving the difference between admission and completion.

Place `Open: /context-guard` immediately after summary/status and before descendants. Add `History: show` there; expanding changes it to `History: hide` and inserts the existing capacity-scaled chart, threshold, and held-value explanation. Do not duplicate summary values or restore throughput diagnostics. The bar represents measured usage; held values remain graph-only.

History starts collapsed on mount and resets on route-session changes. Branch folding retains its current route-reset behavior. Sort and completed-group preferences remain local to the mounted sidebar as today; no persisted setting is needed. Add a palette command such as `context-guard.history` with no global binding, following existing public command registration. Mouse and palette actions share state.

Keep trace derivation outside conditional chart mounting. Measurements arriving while collapsed must survive expansion, panel/sidebar transitions, lower reported usage, and confirmed compaction. Existing model/capacity reset rules remain intact.

## Descendants and completed grouping

Use two ordinary lines per descendant at normal sidebar widths:

1. Tree disclosure, execution symbol, and clipped identity, with space reserved for the name before indentation. Preserve separate execution and pressure colors.
2. Explicit context occupancy percentage and threshold pressure. Remove repeated token totals, throughput, status words, full-width bars, and blank row separators.

Use cell-aware formatting from `format.ts`. At 20 terminal columns allow additional bounded lines to preserve identity and the meanings of context and threshold. Failed execution retains a textual label as well as its symbol. Stale/unknown usage, interruption, and non-idle compaction add exception text and may exceed the ordinary row budget. Important exceptions wrap or use meaningful short forms rather than disappearing under clipping. Full IDs, models, and lifecycle explanations remain in Details.

Default to a collapsed `Completed (N)` control for eligible completed descendants. Compute eligibility bottom-up: a row and all descendants must be completed, have fresh known normal pressure, have a monitored snapshot with idle compaction, and have no interruption. All others remain visible. In particular:

- Completed parents with running, idle, failed, unknown, stale, near/reached-threshold, interrupted, or non-idle-compaction descendants retain the ancestry needed to show them.
- Completed rows with accepted, running, awaiting-measurement, blocked, or uncertain compaction remain visible.
- Grouped rows that become active or need attention appear automatically without expansion.

Apply this eligibility only when discovery is trustworthy, as defined above. Hide the completed-group control when no rows qualify; do not show an actionable `Completed (0)`. Manual branch folding remains independent of completed-group disclosure.

`N` counts grouped session identities, not branch roots. Expansion restores them at original tree positions and sibling order rather than flattening or duplicating branches. Eligible descendants under visible parents still count. Totals and statistics always use all discovered descendants, independent of grouping/folding. Partial inventories retain a partial marker and cannot imply complete counts.

Adapt `context-guard.completed` to toggle this group, preserving the command ID and updating its title and mouse label. Keep pressure/activity sorting and manual group controls. Automatic grouping never hides attention rows; explicit folding may hide children, but its parent must indicate hidden count and attention. Extend existing bounded traversal rather than introducing an unbounded recursive walk.

Illustrative normal state at 39 columns; this is a target sketch, not a rendered result:

```text
Main · deepseek-flash       RUNNING
Context                112K / 500K
██████░░░░░░░░░░░░░░░░░░░░░ 22%
48K tokens below threshold
Reported · measured 3s ago
Live
Observing · Guard won't request
compaction
Open: /context-guard
History: show
SUBAGENTS (4) · 3 running
▾ ● explore
  Context 82% · Threshold reached
  └ ● indexer
    Context 34% · Below threshold
● implementor
  Context 55% · Near threshold
Completed (1): show
Sort: pressure
Collapse groups
```

Large active families can still exceed the host sidebar height; early panel access leads to the existing scrollable family view. A separate sidebar viewport and changes to host child-route visibility are outside scope.

## Diagnostics relocation

Keep per-session performance in panel Details, including estimate and partial-coverage labels. Add `Route family statistics` there, separate from the selected session's diagnostics. Scope it to the route session and descendants, including grouped/folded rows, regardless of selected child.

Use `state.rows([], true)` and the existing descendant traversal to obtain the complete discovered scope. Do not sum panel display rows, which may collapse completed branches. Pass route ID and inventory completeness explicitly to Details. Reuse or extract the current presentation-only statistics formatter. Keep observed compaction counts, active-descendant counts, family peak sums, unknown/partial `?` values, and “Observed · separate windows.” Removing sidebar statistics must preserve access to these values.

## Implementation sequence

1. Extend pure tree projection and compact summary/descendant formatters in `compactformat.ts`. Test grouping eligibility, grouped counts, fold metadata, and narrow formatting; retain existing shared measurement/threshold calculations.
2. Add route-scoped statistics through `panel.tsx`/`panelview.tsx`, testing child selection, collapsed branches, and partial data. Preserve performance fields and exact diagnostic codes.
3. Wire compact defaults, history disclosure, completed grouping, and early panel access in `compact.tsx`. Preserve the single `GuardView` consumer, trace collection, routing, sort behavior, theme semantics, and disposal.
4. Update default renderer assertions and golden frame. Test expanded history separately, preserving held/lower readings and confirmed-compaction continuity. Update host fixture assumptions before integration validation.
5. Update README, `docs/sidebar-description.md`, and native-view/chart sections of `docs/configuration.md` for delivered defaults and controls. Write a separate validation report and mark UX-07 delivered only after evidence exists.

The first reviewable increment is the pure projection/formatting change with tests for incomplete discovery, attention-bearing completed branches, grouping counts, and the 35/39-column fixture budgets. Keep the existing rendered defaults until route-family statistics are available in Details; then switch defaults and update the golden frame together. Treat the full sequence as one UX-07 delivery rather than marking the formatting increment complete as the user-facing improvement.

This is presentation and local UI state work. No policy, scheduler, accounting, telemetry allowlist, transport, RPC schema, dependency, export, version bump, or publication changes are required. Use public APIs already present; any additional host API requires checking pinned public declarations and implementation first.

## Acceptance and validation

| Area                  | Required evidence                                                                                                                                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Density               | Same ordinary fixture: target at most 28 rendered lines at 39 columns and 34 at 35 columns, including border, status, controls, and collapsed completed count. Record measured results separately from targets.                                                       |
| Identity and controls | Identity precedes metrics; panel access precedes descendants. Ordinary rows use two lines at 35/39 columns; inspect 20-column fallback separately. Colors supplement text/symbols.                                                                                    |
| Grouping              | Mixed completed/active ancestry, stale/unmonitored rows, failure, interruption, and every non-idle phase stay reachable. Incomplete/scanning/failed/damaged discovery disables automatic grouping. Expansion restores hierarchy; live updates ungroup attention rows. |
| Scope and bounds      | Child scoping, repeated/Unicode names, deep nesting, cycles, large families, partial inventory, deletion, and grouping transitions retain identity-based actions and bounded traversal.                                                                               |
| Sorting and folding   | Active-first sibling sorting is preserved; folding indicates hidden attention. Filtering/folding cannot change aggregate scope or totals. Existing palette IDs work.                                                                                                  |
| Measurements          | Fresh/stale/missing/invalid/estimated usage, over-capacity values, separate capacity/threshold denominators, strict/inclusive equality, and unknown pressure retain their meanings.                                                                                   |
| Critical status       | Observe, reconnect, retained/absent measurements, event-gap suspension, and storage repair/reload remain explicit. Disclosure/reconnect cannot resume enforcement.                                                                                                    |
| Trace and resources   | Collapsed history collects samples; expansion and remounts retain continuity and reset correctly on model/capacity changes. Disclosure adds no consumer, monitor stream, or retained-history reads.                                                                   |
| Diagnostics           | All performance and aggregate values remain inspectable. Child selection cannot change labeled route-family scope; partial values and independent-window qualifiers remain intact.                                                                                    |

Start with `bun test tests/sidebar.test.ts tests/tuirender.test.tsx tests/statusformat.test.ts tests/tuistate.test.ts`. Extend `tests/fixtures/sidebar-host.tsx` for default/expanded frames, palette/mouse controls, route changes, reactive eligibility, theme colors, and consumer cleanup. Extend panel renderer coverage for aggregate scope and reachability. Use observable behavior assertions rather than tests mirroring formatter internals.

After implementation run `bun run typecheck`, `bun test`, `bun run format:check`, `bun run build`, and `git diff --check`. The original planning change needed documentation formatting/diff checks; completed implementation validation is recorded in the delivery record.

Run the opt-in `GUARD_SYNTHETIC_TUI=1 bun scripts/metrics-server-live.ts` harness with explicit history expansion on OpenCode 2.0.29 and 2.1.2 where available. Check root sidebar allocation, 180/80-column chart continuity, narrow panel access, navigation, polling cancellation, and continued monitoring after panel close. The host controls narrow/child-route sidebar placement; record actual behavior. Report unavailable runs as skips and distinguish synthetic-provider checks from genuine-provider evidence. Preserve scalar privacy checks. Package installation checks are needed only if distribution boundaries change.
