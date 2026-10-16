# Sidebar description review — 2026-10-16

This pre-fix review found that the sidebar did **not** match [the description](../sidebar-description.md).

Verified the actual `GuardView` using OpenTUI's public `testRender` and Solid preload at 35 and 20 columns, with synthetic reported measurements matching the example's token values and a nested indexer. Captures below omit trailing whitespace and unused terminal rows. Colors were neutralized to inspect readability without color. This is an offline component render, not a live OpenCode terminal certification.

| Requirement                                                    | Finding                                                                                                                                                                                 |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framed CONTEXT GUARD panel and section separators              | Missing; plain diagnostic text.                                                                                                                                                         |
| Main agent, model, execution state together                    | Agent/model appear above; execution state only appears in the repeated family row.                                                                                                      |
| Independent context and compaction bars                        | Both absent. Context percentage appears; compaction percentage does not.                                                                                                                |
| Remaining tokens, measurement confidence/age, compaction phase | Present as verbose diagnostics, including idle phase and armed state.                                                                                                                   |
| SUBAGENTS count and running/completed summary                  | Missing. `Family (5)` includes Main and repeats it.                                                                                                                                     |
| Nested agents with progress bars and execution symbols         | Indentation and ASCII connectors exist; bars and suggested symbols are absent. `RUN`/`DONE` and pressure text remain distinct.                                                          |
| Theme colors and critical emphasis                             | Source uses native theme warning/error colors for pressure. Failed/completed execution states do not get their suggested colors. Color fidelity was not tested by these captures.       |
| Collapse/expand groups and hide completed agents               | Only completed, nonsensitive branches collapse automatically; expansion is supported. General group collapse and hiding completed entries are absent.                                   |
| Sorting and navigation                                         | Pressure-based sibling sorting and session navigation exist. No user sorting toggle or explicit active-first ordering.                                                                  |
| Compact narrow display                                         | Names can disappear: at 20 cells, explore renders as `. RUN 82.0% !! cr...`. The actual sidebar registration hardcodes width 35; the 20-cell capture directly exercises the component.  |
| Statistics footer                                              | Entirely absent. Snapshot RPC exposes neither a total compaction count nor family peaks. Those cannot be faithfully inferred from the latest completion timestamp/current measurements. |
| Reactive refresh, stale data and active compaction             | Implemented in state/formatting code; live refresh and flicker were not evaluated in this static render.                                                                                |

The sidebar also limits itself to seven family rows, then links to the panel. The description's example is illustrative and its status symbols are suggestions. Its own counts are inconsistent: four descendant agents are drawn although the heading says three, and active-subagent counts disagree. These example numbers should not be acceptance criteria.

The simplest alignment would keep detailed diagnostics in the existing expanded panel and give the sidebar a compact presentation: main header, two bars, descendant tree, and footer. General collapse/filter controls and trustworthy aggregate statistics would need additional work beyond formatting. No runtime source was changed during this review.

## Actual output at 35 columns

```text
Context Guard / observe

live / observing
Main / deepseek-flash
112.0k / 500.0k input
22.4% FRESH
Trigger 160000 tokens (>=)
Resolved trigger 160000
Until trigger 48.0k
Compact: idle
armed
reported completed-request
3s ago; fresh
Observe: no admission
Family (5)
* Main RUN 22.4%
112.0k/500.0k input; to 48.0k
 |-explore RUN 82.0% !! crossed
410.0k/500.0k input; to -10.0k
  |-indexer RUN 34.0%
170.0k/500.0k input; to 230.0k
 |-implementor RUN 55.0% ! near
275.0k/500.0k input; to 25.0k
 |-reviewer DONE 14.0%
70.0k/500.0k input; to 330.0k
Open: /context-guard
```

## Actual output at 20 columns

```text
Context Guard /
observe

live / observing
Main /
deepseek-flash
112.0k / 500.0k
input
22.4% FRESH
Trigger 160000
tokens (>=)
Resolved trigger
160000
Until trigger 48.0k
Compact: idle
armed
reported
completed-request
3s ago; fresh
Observe: no
admission
Family (5)
* Main RUN 22.4%
112.0k/500.0k input;
to 48.0k
. RUN 82.0% !! cr...
410.0k/500.0k input;
to -10.0k
  |-ind... RUN 34.0%
170.0k/500.0k input;
to 230.0k
... RUN 55.0% ! near
275.0k/500.0k input;
to 25.0k
 |-rev... DONE 14.0%
70.0k/500.0k input;
to 330.0k
Open: /context-guard
```

## Fix verification

The compact sidebar now uses a rounded native frame, two independent progress bars, a descendants-only tree, execution symbols with separate pressure labels, and an observed-statistics footer. It supports folding, completed-agent filtering, activity/pressure sorting, navigation and allocated-width changes. The expanded diagnostics panel retains its existing presentation.

The checked-in [rendered frame](../../tests/fixtures/sidebar-frame.txt) is the current 39-column reference. `tests/fixtures/sidebar-host.tsx` renders the real component through OpenTUI at 39, 35 and 20 columns, checks that frame, and exercises reactive metrics/session changes, navigation, folding, filters, sorting and cleanup. It uses synthetic data and neutral colors; live host geometry, theme colors and flicker remain outside this offline check. The old captures above document the original defect.

Statistics now project the monitor's existing numeric completion counters and residency peaks through RPC. Unknown/partial aggregates remain `?`; admission never increments the completion counter. Family peak sums explicitly describe separate windows.

Validation after the fix: `bun run typecheck`, `bun test` (94 passes), `bun run format:check`, and `git diff --check` passed. No live-provider or interactive-host run was performed for this change.
