# Context Guard — Terminal TUI Sidebar Description

A compact, real-time context monitoring panel integrated into the native OpenCode terminal sidebar. It displays context-window usage for the current session and all its subagents, including nested subagents, with progress bars, execution status, and compaction information.

## Visual layout

```text
╭─ CONTEXT GUARD ─────────────────────╮
│                                    │
│  Main · deepseek-flash      RUNNING │
│                                    │
│  Context               112K / 500K │
│  █████░░░░░░░░░░░░░░░░        22%  │
│                                    │
│  Compact threshold      112K / 160K│
│  ██████████████░░░░░░        70%   │
│  48K tokens until compaction       │
│                                    │
│  Measurement: reported · 3s ago   │
│                                    │
│  ── SUBAGENTS (3) ──────────────── │
│  2 running · 1 completed           │
│                                    │
│  ● explore                  82%    │
│    ████████████████░░░░            │
│    410K / 500K · CRITICAL          │
│    └─ ● indexer             34%    │
│         ███████░░░░░░░░░░░░         │
│         170K / 500K                │
│                                    │
│  ● implementor              55%    │
│    ███████████░░░░░░░░░            │
│    275K / 500K · WARNING           │
│                                    │
│  ✓ reviewer                 14%    │
│    ███░░░░░░░░░░░░░░░░            │
│    70K / 500K · COMPLETED          │
│                                    │
│  ── STATISTICS ─────────────────── │
│  Compactions                    4  │
│  Active subagents               3  │
│  Family peak usage           856K  │
╰────────────────────────────────────╯
```

_All values are illustrative._

## Main session section

The top section shows the current OpenCode session, its agent name, model, and execution state.

Two independent progress bars represent:

- **Context occupancy:** Current prompt tokens relative to the model's effective input capacity.
- **Compaction proximity:** Current prompt tokens relative to the configured compaction threshold.

Below the bars, display the remaining tokens before compaction, measurement confidence, measurement age, and active compaction phase when applicable.

## Subagents section

A compact tree lists every subagent belonging to the current session, including nested descendants.

Each entry contains the agent name, running/completed/failed status, context usage percentage, a horizontal progress bar, and used/available tokens.

Subagents with critical context pressure are visually emphasized. Active subagents are shown first where possible, while parent-child relationships remain visible through indentation and tree connectors.

Suggested status indicators:

- ● Green — running
- ● Yellow — approaching threshold
- ● Red — critical context pressure
- ✓ Muted — completed
- ✕ Red — failed
- ◌ Gray — idle or unknown

Context-pressure indicators must be distinct from execution-status indicators. A running agent can simultaneously be in a critical context state.

## Behavior

The sidebar updates reactively as agents execute. Context measurements, session status, and compaction progress refresh without manually reopening the panel.

The interface supports:

- Collapsing and expanding nested subagent groups.
- Navigating to an agent's session, if supported by the host TUI.
- Optional sorting by context pressure.
- Compact display for narrow terminal widths.
- Hiding completed subagents.
- Clear stale-data indicators.
- Showing active compaction states such as requesting, running, awaiting measurement, and uncertain.

Progress bars use terminal-native characters and OpenCode theme colors. The display should minimize redraws, avoid flickering, and remain readable without color support.

## Statistics footer

The bottom section shows aggregate diagnostic information: total compactions, number of active subagents, and peak or cumulative family token usage where available.

Family-wide statistics must not imply that independent subagents share a single context window.

## Design principles

The panel should feel like a native OpenCode sidebar component rather than an external dashboard. It should be dense, minimal, readable, keyboard-friendly, and optimized for developers running multiple concurrent coding agents.

The most important information is always visible: **which agent is running, how much context it is using, and which agent is closest to its compaction threshold.**

The sidebar is read-only and must never interfere with Context Guard's context management or compaction logic.

## Implementation details

The sidebar uses a rounded native border and adapts to its allocated width. Narrow rows keep the agent name in the heading and the percentage on the progress bar. Long labels and model names wrap. The expanded `/context-guard` panel retains detailed policy and transport diagnostics.

Click a disclosure arrow to fold or unfold a subagent branch; click an agent name to open its session. The controls below the tree toggle completed-agent visibility, pressure/activity sorting, and all groups. These actions are also available through the command palette while the sidebar is mounted. Running branches sort first; pressure sorting orders sibling branches by their highest measured pressure. Filters and folding do not change counts or statistics.

Statistics show observed completed compactions, active descendants, and the sum of each family member's observed prompt peak. The peak sum is not a simultaneous family maximum or a shared capacity. Peaks cover monitor residency; counts use the monitor's retained lifecycle counters. Unknown statistics are shown as `?`, including when inventory is incomplete or a family member is unmonitored. Update both server and TUI packages together: the closed RPC schema now includes optional numeric peak and completion-count fields.

The sketch's counts are illustrative: its four drawn descendants imply three running and one completed, with three active subagents. The implementation derives these counts from the actual descendants, including nested agents, and excludes Main from the subagent count.
