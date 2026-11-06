# Context Guard TUI UX review

Date: 2026-11-06. Status: recommendations documented; UX-01 is implemented with [validation evidence](../validation/native-panel-overview-2026-11-06.md). Its [implementation plan](native-panel-overview.md) records the scope. UX-02, UX-03, and UX-06 are also implemented with [validation evidence](../validation/threshold-status-consistency-2026-11-06.md). UX-04/UX-05 are implemented with [standalone overview validation](../validation/standalone-overview-density-2026-11-06.md); the remaining recommendations are follow-up work.

## Scope and evidence

Review covers the native sidebar, OpenCode `/context-guard` panel, standalone `context-guard dashboard tui`, keyboard handlers, renderer fixtures, and repository compatibility documentation. Findings describe the interface before UX-01 was implemented. They come from source inspection and offline rendering, rather than a new interactive OpenCode host session or user study. Subsequent implementation and actual-host evidence are recorded separately in the delivery report linked above.

During the review, `bun test tests/tuirender.test.tsx tests/sidebar.test.ts tests/dashboardterminal.test.ts` passed all 15 tests. Standalone fixture frames were inspected at 80×24, 40×20, and 20×12. These results establish existing behavior, not validation of the proposed design.

The default interface should answer three questions immediately:

1. How full is this session's context?
2. Which agent needs attention?
3. What will Context Guard do?

Preserve the existing distinctions between execution status, occupancy, policy pressure, measurement freshness, connection health, and compaction lifecycle. Preserve nested relationships, textual status indicators, focus-scoped commands, stable panel selection order, bounded data, and read-only monitoring.

## Prioritized recommendations

P1 denotes the first usability work; P2 denotes follow-up improvements. IDs are stable references for implementation plans.

| ID    | Priority | Finding                                                                                                                       | Recommendation                                                                                                                                                                                |
| ----- | -------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UX-01 | P1       | The native panel places a context chart and extensive policy diagnostics before the family list.                              | Open with a compact selected-session summary and agent list. Put detailed policy, provenance, limits, counters, and charts behind explicit views.                                             |
| UX-02 | P1       | “48K tokens until compaction” implies a scheduled outcome, including in observe mode.                                         | Say “48K tokens below threshold”; explain the current mode separately. Threshold crossing is neither admission nor completion.                                                                |
| UX-03 | P1       | Agent percentages describe effective input capacity, but WARNING/CRITICAL describes policy threshold proximity.               | Label capacity occupancy and threshold pressure separately. Prefer “Near threshold” and “Threshold reached.”                                                                                  |
| UX-04 | P1       | Standalone overview rows expose a long diagnostic sentence; three fixture sessions occupy twelve content lines at 80 columns. | Use aligned columns at wide widths and compact cards at narrow widths. Move full IDs, freshness breakdowns, and performance details into inspection.                                          |
| UX-05 | P1       | At 20×12, standalone overview scrolling shows the selected row's tail while hiding its identity and selection marker.         | Keep identity visible; cap overview row height or allow scrolling within a tall row before changing selection, as the Models list does.                                                       |
| UX-06 | P1       | Connection, freshness, and enforcement state lack a concise explanation of their consequences.                                | Keep a persistent status such as “Live · Observing,” “Disconnected · showing saved measurements,” or “Automatic compaction suspended · reload required,” chosen from actual state and reason. |
| UX-07 | P2       | The four-descendant sidebar fixture is roughly 65 lines tall before other OpenCode sidebar content.                           | Put identity first, use a compact occupancy bar by default, make history expandable, shorten agent rows, group completed branches, and move detailed statistics into the panel.               |
| UX-08 | P2       | Keyboard behavior differs across surfaces and some actions are difficult to discover.                                         | Add native-panel help and page navigation, use contextual footers, provide keyboard child-route access, and review conflicting keys across surfaces.                                          |
| UX-09 | P2       | Raw lifecycle and accounting terminology requires users to understand implementation concepts.                                | Translate primary labels into plain language; retain exact codes under Details.                                                                                                               |
| UX-10 | P2       | Chart failures use a generic message suggesting unsupported server history, including for temporary failures.                 | Distinguish unsupported capability from transient failure, preserve clearly marked stale results where available, and provide an accurate retry action.                                       |

## Native panel hierarchy

Illustrative target; numbers are examples, not a policy calculation:

```text
Context Guard                         Live · Observe
Guard will not request compaction in this mode.

Selected: build · deepseek-flash
Context 112K / 500K · 22%
Threshold 160K · 48K below
Last request measured 3s ago

Agents                 State    Context  Threshold
> build                Running      22%  48K below
  ▾ explore            Running      82%  Reached
    indexer            Running      34%  Below
  implementor          Running      55%  Near
  reviewer             Completed    14%  Below

↑↓ select   i details   c charts   Enter open   q close
```

Selecting an agent should update a summary in a predictable place. Current session and selected session need distinct markers: the panel's family scope follows the OpenCode route, while inspection follows selection. The current implementation keeps route-session details at the top and appends inspected-child details, making these relationships harder to follow.

## Sidebar follow-up

Keep identity before throughput metrics; performance lines currently precede identity when present. Default to a small occupancy display and make the history chart expandable. Aim for one or two lines per agent, adding explicit exceptions for stale data, failure, or unresolved compaction.

Group completed agents under “Completed (N)” without hiding active descendants of completed parents. Keep family statistics and throughput details available in the panel. Place Open Context Guard near the summary so users need not scroll through the whole tree to find it.

## Keyboard follow-up

Add `?` help to the native panel and explicit page navigation for long content. Show only relevant footer actions and preserve essential actions at narrow widths. Show Load more when inventory is partial, with feedback about progress or the discovery bound.

Review existing conflicts before choosing a shared convention: `l` means load more in the panel and location in the dashboard; brackets change the window in the panel and select observations in the dashboard. Preserve documented bindings until a migration is specified.

The native child-composer action currently uses a mouse handler. Provide keyboard access through verified public host APIs, accounting for child routes where normal slash/palette shortcuts are hidden. Do not assume the host permits a new global shortcut in every input mode.

## Suggested copy

| Existing wording           | Suggested primary wording                               |
| -------------------------- | ------------------------------------------------------- |
| Observe: no admission      | Observe mode · Guard won't request compaction           |
| accepted                   | Compaction request accepted · waiting to start          |
| awaiting_measurement       | Compaction ended · checking context reduction           |
| uncertain                  | Completion unconfirmed · automatic retry suppressed     |
| muted held                 | Last known context                                      |
| reported completed-request | Provider-reported usage from the last completed request |

Retain exact lifecycle codes in Details. Stale usage should say “Last measured” and must not imply a current pressure decision. Mode descriptions concern Guard; OpenCode can still compact through its native workflows. A UI refresh or reconnect must not suggest that suspended enforcement has resumed.

## Source map

| Area                            | Sources                                                                                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native command and child access | [src/tui.tsx](../../src/tui.tsx)                                                                                                                           |
| Panel controls and scrolling    | [src/tui/panel.tsx](../../src/tui/panel.tsx)                                                                                                               |
| Expanded layout and inspection  | [src/tui/panelview.tsx](../../src/tui/panelview.tsx), [src/tui/panelformat.ts](../../src/tui/panelformat.ts), [src/tui/format.ts](../../src/tui/format.ts) |
| Compact sidebar and wording     | [src/tui/compact.tsx](../../src/tui/compact.tsx), [src/tui/compactformat.ts](../../src/tui/compactformat.ts)                                               |
| Native performance charts       | [src/tui/charts.tsx](../../src/tui/charts.tsx)                                                                                                             |
| Standalone layout and controls  | [src/dashboard/terminalview.ts](../../src/dashboard/terminalview.ts), [src/dashboard/terminal.ts](../../src/dashboard/terminal.ts)                         |
| Reviewed sidebar frame          | [tests/fixtures/sidebar-frame.txt](../../tests/fixtures/sidebar-frame.txt)                                                                                 |
| Recovery and host limitations   | [docs/compatibility.md](../compatibility.md)                                                                                                               |

## Delivery order and evaluation

Implement UX-01 first, with only the copy and status changes needed to make its new summary accurate. Follow with consistent status/copy treatment across surfaces (UX-02, UX-03, UX-06), standalone density and row reachability (UX-04, UX-05), then sidebar, keyboard, terminology, and chart-error work.

UX-01 and the [consistent threshold and Guard status increment](threshold-status-consistency.md) (UX-02, UX-03, UX-06) are delivered. See the [status delivery record](../validation/threshold-status-consistency-2026-11-06.md) for implementation and validation evidence. UX-04/UX-05, standalone row density and reachability, are also delivered; their [implementation plan](standalone-overview-density.md) records the reproduced geometry, interaction contract, and acceptance checks, with measured results in the [delivery report](../validation/standalone-overview-density-2026-11-06.md). Sidebar density (UX-07) is next in the recommended order, followed by keyboard, terminology, and chart-error work.

The [proposed sidebar density plan](sidebar-density.md) records current source evidence, compact defaults, safe completed grouping, diagnostics relocation, and acceptance checks for UX-07. Implementation has not started.

Evaluate keyboard-only tasks at 80×24 and 40×20: identify the nearest-threshold agent, explain Guard's current behavior, inspect a child, view its charts, and return without losing selection. Include stale, unknown, observe, suspended, and uncertain states. Check narrow fallback at 20×12, long names, CJK/emoji, deep nesting, and large families. Record actual results separately from design targets.
