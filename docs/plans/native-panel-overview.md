# Native Context Guard panel: overview before diagnostics

Date: 2026-11-06. Status: implemented and locally validated; see the [delivery record](../validation/native-panel-overview-2026-11-06.md). Implements UX-01 from the [TUI UX review](tui-ux-review.md).

## Problem and outcome

Before this change, opening `/context-guard` rendered a context history chart, expanded route-session diagnostics, and optional inspected-child diagnostics before the family list. The user's first comparison task required scrolling past information that is useful mainly during investigation.

The new default should show a compact selected-session summary and the family list immediately. Details and charts remain reachable with existing `i` and `c` actions. Selection must refer to the same session across views, while the OpenCode route continues to define the family scope.

## First increment

Change only the native `/context-guard` panel and its supporting presentation helpers, renderer fixtures, and documentation. Keep the sidebar's current appearance, standalone dashboard, monitoring policy, accounting, compaction lifecycle, RPC contracts, and inventory bounds intact.

Include accurate threshold and mode wording in the new summary. Broader copy changes, a sidebar redesign, new global shortcuts, model analytics, and standalone row fixes remain separate review items.

## Proposed interaction contract

Use an explicit panel view state: `overview`, `details`, or `charts`. Default to Overview on opening and on route-session changes. Keep the selected session ID separately from the route-session ID; do not use a row index as identity.

| Action     | Overview                                     | Details                                                | Charts                                       |
| ---------- | -------------------------------------------- | ------------------------------------------------------ | -------------------------------------------- |
| Up/Down    | Select previous/next family member           | Scroll details; use Overview to select another session | Keep existing previous/next session behavior |
| i          | Open selected-session Details                | Return to Overview                                     | Open selected-session Details                |
| c          | Open selected-session performance Charts     | Open selected-session performance Charts               | Return to Overview                           |
| Enter      | Close panel and navigate to selected session | Same                                                   | Same                                         |
| q          | Close panel                                  | Close panel                                            | Close panel                                  |
| r          | Refresh snapshots/inventory                  | Same                                                   | Same, plus chart refresh                     |
| Space      | Expand selected hidden completed descendants | Inactive                                               | Inactive                                     |
| l          | Load more family when incomplete             | Inactive                                               | Inactive                                     |
| Left/Right | Inactive                                     | Inactive                                               | Keep existing metric navigation              |
| [ / ]      | Inactive                                     | Inactive                                               | Keep existing time-window navigation         |

Add PageUp/PageDown and Home/End for the active scrollable content through the installed public renderer API. In Overview, page navigation should move selection and reveal it. In Details/Charts it should scroll content without changing selection. Footer hints must describe the active mode; document that Details uses arrows for scrolling. Keep commands enabled only while the panel is focused.

Retain existing click-to-open session behavior in the family list. Make Details and Charts visibly labeled actions with mouse handlers as well as keyboard hints. Closing or navigating must return control through the host's existing panel/router APIs.

When a selected row disappears after refresh/eviction, fall back to the route session if present, then the first available family member. If no rows remain, show an empty/loading state and disable session actions. Preserve selection when only values, order, or snapshot availability change. Preserve the existing frozen navigation order until explicit refresh or focus loss.

## Layout and information contract

Keep status and summary outside the family scroll viewport. The footer remains outside the active scroll viewport in every mode. Switching views resets the active content scroll position; returning to Overview reveals the same selected row.

The Overview header should contain panel identity, connection/enforcement status, and any critical health exception. Critical warnings must remain visible in every view; exact reason codes can live in Details. Avoid rendering blank placeholder lines for absent notices.

The selected-session summary contains:

- Agent/model identity, execution state, and a clear current-session marker when applicable.
- Prompt tokens / effective input capacity and occupancy percentage.
- Configured resolved threshold and signed distance, labeled “below threshold” or “over threshold”; at equality respect the existing `>` versus `>=` comparison.
- Measurement confidence and age; stale values explicitly say “Last measured,” with current pressure unknown.
- Non-idle compaction state, especially blocked or uncertain, without equating acceptance or an ended event with verified recovery.

Overview rows contain identity/hierarchy, execution state, occupancy, threshold pressure/distance, and exceptional freshness/compaction indicators. Omit throughput blocks, cumulative totals, raw provenance, policy definitions, and full IDs from ordinary rows. Keep full IDs available in Details to distinguish repeated agent names.

At usable content widths of at least 72 cells, use aligned columns. Below that width, use compact cards with identity first and metrics second; add an exception line only when needed. Treat 72 cells as a proposed breakpoint to verify with representative values, not a terminal-width guarantee. Use existing grapheme-aware cell measurement, clipping, and wrapping.

At 80×24 and 40×20 with normal short-name fixtures, target at most eight header/summary lines and two footer lines, leaving multiple family rows visible. Long identities must not consume unbounded fixed-header space: clip them in Overview and expose full text in Details. At very small sizes, reduce the summary to selected identity and occupancy, preserve critical status and close/details access, and allow other content to scroll. Derive height budgets from measured viewport size rather than assuming `PanelInput` supplies terminal height.

Details contains the selected session's full diagnostics, ancestry, accounting explanation, and context-history chart. Preserve context-chart held/reset semantics. Charts continues to mean the existing retained performance-history view; label it accordingly so users can distinguish it from the context chart in Details.

## Implementation approach

1. Add panel-specific formatting helpers in `src/tui/panelformat.ts` for compact summary and family rows. Reuse `GuardRow`, existing computed metrics, and grapheme-aware primitives. Do not change shared `rowLines`/`detailLines` semantics solely to shorten Overview.
2. Make `GuardPanel` own one acquired state consumer for its route-session lifetime. Before this change, `GuardView` owned acquisition and remained mounted while charts were visible. Replacing that view without moving ownership would stop updates or cause repeated acquisition on view switches. Keep sidebar ownership independent and reference-counted through the existing state service.
3. Extract native panel presentation into `src/tui/panelview.tsx`, with Overview and Details renderers receiving rows and selected identity. Keep `GuardView` as the sidebar entry or a compatibility wrapper as needed. Remove the old expanded branch only after migrating its callers and preserving diagnostic fields.
4. Replace `showCharts` and appended `inspectId` behavior with explicit view state. Keep metric/window/refresh controls, stable row order, selection reveal, and bounded row windows. Reset scroll deliberately on view changes; restore Overview around the selected identity.
5. Maintain bounded context-trace updates while Overview is active, without drawing its chart. Inspect `ContextTraceStore` and state update ownership before wiring this: chart data is updated through `state.contextTrace(row)`, not automatically by merely receiving a snapshot. Avoid adding another subscription, unbounded trace retention, or per-render network work.
6. Implement scroll commands and measured responsive layout using existing public OpenTUI APIs. Installed declarations expose `ScrollBoxRenderable.scrollBy`; verify exact method and viewport contracts before coding. Preserve frame-callback cleanup and selected-row reveal through resize.
7. Update the native renderer fixture, README Native TUI section, configuration controls, and architecture description to reflect the final interaction contract. Leave historical validation reports unchanged; add a delivery record for new evidence.

## Acceptance and validation

| Scenario                                  | Required result                                                                                                                                      |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open with measured root and children      | Overview shows selected-session quantities and family rows before any diagnostic chart; no raw policy/provenance/cumulative block precedes the list. |
| Select child, inspect, return             | Summary and Details identify that child; returning preserves selection and family position; current-route marker remains distinct.                   |
| Inspect current root                      | Details opens explicitly for the root instead of having no visible inspection effect.                                                                |
| Switch Details/Charts/Overview repeatedly | One panel consumer remains acquired, no additional monitor subscription appears, and closing releases it.                                            |
| Live values, reorder, removal, refresh    | Selection follows session identity; disappearance uses the documented fallback; refresh updates visible state.                                       |
| Stale, missing, model-invalid usage       | Unknown stays unknown; stale occupancy is labeled last measured; no stale current threshold decision is fabricated.                                  |
| Observe, suspended, blocked, uncertain    | Visible mode/state accurately explains behavior; refresh never implies enforcement recovery.                                                         |
| 80×24 and 40×20                           | Normal fixtures meet the density target; footer and selected row remain visible; diagnostic content is reachable by keyboard.                        |
| 20×12, long IDs, CJK/emoji, deep ancestry | No prompt overlap or unreachable content; selected identity and close/details access survive constrained layout.                                     |
| Large family and resize                   | Preserve bounded row rendering, stable order, selected-row visibility, and cleanup.                                                                  |
| Existing sidebar and performance charts   | Sidebar frame remains unchanged; context-chart reset/held behavior, chart metrics/windows, navigation, and cancellation still pass.                  |

Add meaningful behavior tests for panel formatting and extend the public native renderer fixture for view transitions, scroll reachability, height limits, selection identity, and consumer cleanup. Replace the fixture's assumption that a context chart appears on initial open with an assertion that it appears in Details. Do not remove chart geometry coverage.

Run targeted panel/sidebar/chart/state tests during implementation, then `bun run typecheck`, `bun test`, and `bun run format:check`. Use the repository's isolated synthetic-provider live TUI harness where available for actual slash entry, child-route access, focus return, and resizing. Record unavailable live checks as skipped, not passed. Packaging checks become necessary if entry boundaries or exports change.

## Work checklist

- [x] Document the review and first recommendation.
- [x] Inspect current panel layout, selection, consumer ownership, and renderer fixtures.
- [x] Specify proposed views, layout, state transitions, and acceptance criteria.
- [x] Implement panel summary/row formatting and responsive budget.
- [x] Move panel consumer ownership and preserve context-trace updates.
- [x] Implement Overview/Details/Charts and scroll/navigation behavior.
- [x] Update renderer coverage and user documentation.
- [x] Run checks and record actual host validation or explicit skips.
