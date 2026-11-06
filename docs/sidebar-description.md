# Context Guard — Terminal TUI Sidebar Description

A compact, real-time context monitoring panel integrated into the native OpenCode terminal sidebar. It displays context-window usage for the current session and its discovered subagents, including nested subagents, with progress bars, execution status, and compaction information.

## Visual layout

```text
╭─ CONTEXT GUARD ─────────────────────╮
│ Main · deepseek-flash       RUNNING │
│                                     │
│ Context                 112K / 500K │
│ 100%│                             │ │
│     │                             │ │
│     │                             │ │
│     │                             │ │
│     │                             │ │
│     │┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│ │
│     │                            ▇│ │
│   0%│                            █│ │
│     └─────────────────────────────┘ │
│ muted held · last known context     │
│ 22% used · recent samples → now     │
│                                     │
│ Policy threshold        112K / 160K │
│ 70% of threshold · ┄ trigger        │
│ 48K tokens below threshold          │
│                                     │
│ Measurement: reported · 3s ago      │
│ Live                                │
│ Observing · Guard won't request     │
│ compaction                          │
│                                     │
│ ── SUBAGENTS (4) ────────────────── │
│ 3 running · 1 completed             │
│                                     │
│ ▾ ● explore                     82% │
│  ████████████████████████░░░░░ 82%  │
│  Context 410K / 500K                │
│  Threshold reached                  │
│  RUNNING                            │
│                                     │
│   └─ ● indexer                  34% │
│    █████████░░░░░░░░░░░░░░░░░░ 34%  │
│    Context 170K / 500K              │
│    Below threshold                  │
│    RUNNING                          │
│                                     │
│ ● implementor                   55% │
│  ████████████████░░░░░░░░░░░░░ 55%  │
│  Context 275K / 500K                │
│  Near threshold                     │
│  RUNNING                            │
│                                     │
│ ✓ reviewer                      14% │
│  ████░░░░░░░░░░░░░░░░░░░░░░░░░ 14%  │
│  Context 70K / 500K                 │
│  Below threshold                    │
│  COMPLETED                          │
│                                     │
│ Hide completed                      │
│ Sort: pressure                      │
│ Collapse groups                     │
│                                     │
│ ── STATISTICS ───────────────────── │
│ Compactions                       4 │
│ Active subagents                  3 │
│ Family peaks (sum)               1M │
│ Observed · separate windows         │
│ Open: /context-guard                │
╰─────────────────────────────────────╯
```

_Illustrative values from the current offline sidebar renderer fixture; optional performance lines appear when available._

## Main session section

The top section shows the current OpenCode session, its agent name, model, and execution state.

A capacity-scaled context chart and separate threshold text represent:

- **Context occupancy:** Current prompt tokens relative to the model's effective input capacity.
- **Threshold pressure:** Fresh prompt tokens relative to the configured policy threshold.

Below the chart, threshold distance says tokens below/over threshold; it does not promise compaction. Measurement confidence, age, and active compaction phase remain visible. Stale values say “Last measured,” keep occupancy, and have unknown current threshold pressure and distance.

## Subagents section

A compact tree lists the current session's discovered descendants within the inventory bounds, including nested descendants.

Each entry contains the agent name, running/completed/failed status, context usage percentage, a horizontal progress bar, and used/available tokens.

Agent rows label threshold pressure separately as “Below threshold,” “Near threshold,” “Threshold reached,” or unknown. Active subagents are shown first where possible, while parent-child relationships remain visible through indentation and tree connectors.

Execution status indicators:

- ● Green — running
- ✓ Muted — completed
- ✕ Red — failed
- ◌ Gray — idle or unknown

Row and progress-bar colors indicate threshold pressure separately from execution symbols. A green running symbol can appear in a red row labeled “Threshold reached.” Near pressure begins at 90% of a positive trigger; reached respects the configured inclusive or strict comparison.

## Behavior

The sidebar updates reactively as agents execute. Context measurements, session status, and compaction progress refresh without manually reopening the panel.

The interface supports:

- Collapsing and expanding nested subagent groups.
- Navigating to an agent's session, if supported by the host TUI.
- Optional sorting by context pressure.
- Compact display for narrow terminal widths.
- Hiding completed subagents.
- Clear stale-data and connection indicators, with last-known Guard status during client disconnection.
- Showing active compaction states such as requesting, running, awaiting measurement, and uncertain.

Progress bars use terminal-native characters and OpenCode theme colors. The display should minimize redraws, avoid flickering, and remain readable without color support.

## Statistics footer

The bottom section shows aggregate diagnostic information: observed completed compactions, number of active subagents, and the sum of observed family prompt peaks where available.

Family-wide statistics must not imply that independent subagents share a single context window.

## Design principles

The panel should feel like a native OpenCode sidebar component rather than an external dashboard. It should be dense, minimal, readable, keyboard-friendly, and optimized for developers running multiple concurrent coding agents.

The sidebar emphasizes: **which agent is running, how much context it is using, and which agent is closest to its compaction threshold.**

The sidebar is read-only and must never interfere with Context Guard's context management or compaction logic.

## Implementation details

The sidebar uses a rounded native border and adapts to its allocated width. Narrow rows keep the agent name in the heading and the percentage on the progress bar. Long labels and model names wrap. The `/context-guard` panel opens Overview with a compact selected-session summary and family list. Press **i** for the selected session's Details, including its context chart, full policy/accounting fields and transport reasons; press **c** for retained performance Charts. Returning to Overview keeps selection. See [panel controls](configuration.md#native-context-guard-view) and the [overview validation](validation/native-panel-overview-2026-11-06.md). Threshold and connection wording is covered by the [status consistency validation](validation/threshold-status-consistency-2026-11-06.md).

Click a disclosure arrow to fold or unfold a subagent branch; click an agent name to open its session. The controls below the tree toggle completed-agent visibility, pressure/activity sorting, and all groups. These actions are also available through the command palette while the sidebar is mounted. Running branches sort first; pressure sorting orders sibling branches by their highest measured pressure. Filters and folding do not change counts or statistics.

Statistics show observed completed compactions, active descendants, and the sum of each family member's observed prompt peak. The peak sum is not a simultaneous family maximum or a shared capacity. Peaks cover monitor residency; counts use the monitor's retained lifecycle counters. Unknown statistics are shown as `?`, including when inventory is incomplete or a family member is unmonitored. Update both server and TUI packages together: the closed RPC schema now includes optional numeric peak and completion-count fields.

The example shows four descendants: three running and one completed, with three active subagents. The implementation derives these counts from the actual descendants, including nested agents, and excludes Main from the subagent count.

Color indicators use the active OpenCode theme: green for healthy pressure and running execution, yellow near the configured threshold, red for crossed thresholds or failed execution, and muted for stale/unknown pressure and completed status. Execution symbols retain their own status color when an agent is under critical pressure. The main context chart uses normal text for current readings, muted held/stale readings, and a warning-colored threshold; subagent progress bars follow threshold pressure. Text labels remain available without color.

Connection and Guard behavior are separate facts. Observe mode explains that Guard will not request compaction. Disconnected clients show whether last-received measurements are retained and identify Guard health as last known; they do not claim server enforcement stopped. Event-stream suspension requires reload even after observation reconnects. Safety-storage suspension requires repair and reload. Exact reason codes remain inspectable in panel Details.
