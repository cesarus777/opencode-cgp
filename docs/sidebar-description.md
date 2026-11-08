# Context Guard — Terminal TUI Sidebar Description

The native sidebar shows the route session's context occupancy, Guard status, and discovered descendants. Identity comes first, followed by measured tokens/capacity, one occupancy bar, threshold distance, and measurement confidence/age. `Open: /context-guard` appears before the agent tree.

## Default layout

The current offline renderer fixture at 39 columns:

```text
╭─ CONTEXT GUARD ─────────────────────╮
│ Main · deepseek-flash       RUNNING │
│ Context                 112K / 500K │
│ ███████░░░░░░░░░░░░░░░░░░░░░░░░ 22% │
│ 48K tokens below threshold          │
│ Provider reported · measured 3s ago │
│ Live                                │
│ Observing · Guard won't request     │
│ compaction                          │
│ Open: /context-guard                │
│ History: hide                       │
│ 100%│                             │ │
│     │                             │ │
│     │                             │ │
│     │                             │ │
│     │                             │ │
│     │┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│ │
│     │                            ▇│ │
│   0%│                            █│ │
│     └─────────────────────────────┘ │
│ Recent samples → now · ┄ threshold  │
│ Dim = last known context            │
│ Policy threshold 160K · 70% of      │
│ threshold                           │
│ SUBAGENTS (4) · 3 running           │
│ ▾ ● explore                         │
│  ████████████████████████░░░░░ 82%  │
│  Context 82% · Threshold reached    │
│   └─ ● indexer                      │
│    █████████░░░░░░░░░░░░░░░░░░ 34%  │
│    Context 34% · Below threshold    │
│ ● implementor                       │
│  ████████████████░░░░░░░░░░░░░ 55%  │
│  Context 55% · Near threshold       │
│ Completed (1): show                 │
│ Sort: pressure                      │
│ Collapse groups                     │
╰─────────────────────────────────────╯
```

Without performance data, the same fixture occupies 38 rendered lines at 39 columns and 40 at 35 columns, including borders and controls. Exceptional statuses and narrow layouts can use more lines. The host controls sidebar placement and may omit it on narrow or child routes; the existing panel and optional keyboard entry remain available.

## History and diagnostics

The primary session’s live context chart starts visible. Click `History: hide` to collapse it, `History: show` to restore it, or use **Show or hide sidebar context history** in the command palette (`context-guard.history`, no default shortcut). The expanded chart uses effective input capacity, a separate threshold line labeled “┄ threshold,” and dimmed retained values labeled “Dim = last known context.” History resets to visible on route changes and remounts; the bounded shared trace continues collecting while collapsed and survives sidebar/panel transitions. Model/capacity changes reset the trace. Disclosure creates no additional monitor consumer or retained-history reads.

The occupancy bar always represents the measured value. Held values apply only to the history graph. Summaries say “Provider reported” or “Estimated,” with age; estimates also retain `~`. Stale usage says “Last measured” and “out of date,” with unknown current threshold pressure. Missing measurements say “Usage unknown”; unusable measurements say “Usage unavailable.” Above-capacity percentages remain textual even though the bar clips visually. Crossing a threshold does not promise compaction. Non-idle compaction and interruptions remain explicit. Accepted requests say “waiting to start”; ended compaction says “checking context reduction.” Unconfirmed completion retains automatic retry suppression.

The main agent and each subagent display Live TPS, Avg model, Avg session, and TTFT when performance data is available. The native panel agent rows show the same metrics. Waiting requests, estimated streaming rates, and partial timing coverage are labeled; narrow layouts wrap the metrics. Panel Details explains measurement scope, lifecycle states and TPS/TTFT before labeled diagnostic codes and accounting. Exact confidence, scope, provenance, phase and reason codes remain inspectable. **Route family statistics** there includes the route session and all discovered descendants, regardless of selection, grouping, or folding. Its route identity and partial state are labeled; independent peak sums are not a combined context window or lifetime total.

## Agent tree and controls

Ordinary descendants show execution and context information followed by available performance metrics: execution symbol and identity, a horizontal capacity occupancy bar, then context occupancy and threshold pressure. Narrow widths use compact wording or wrapping. Failed/unknown execution, stale/missing usage, interruptions, and unresolved compaction add explicit exception text. Repeated names still navigate using full session IDs. Colors supplement labels and symbols:

- `●` running; `✓` completed; `✕` failed; `◌` idle/unknown.
- Threshold pressure remains separate: below, near, reached, or unknown. A running symbol can be green while pressure text is red.

Completed subtrees start grouped under `Completed (N): show`. Eligibility requires trustworthy completed discovery, fresh known normal pressure, monitored idle compaction, and no interruption throughout the subtree. Incomplete, scanning, failed, or damaged discovery disables automatic grouping. Completed parents retain active or attention-bearing descendants. Live updates reveal newly active or exceptional rows automatically. Expansion restores original tree positions; `N` counts sessions rather than branch roots. A zero-count control is omitted.

Click an identity to navigate. Click a branch disclosure to fold it; folded branches show hidden counts and whether descendants need attention. Manual folding is independent of completed grouping. `Sort: pressure` / `Sort: activity` preserves hierarchy and prioritizes active sibling branches. The existing palette IDs `context-guard.completed`, `context-guard.sort`, and `context-guard.groups` remain supported. Folding resets with the route; sort/completed disclosure preferences last for the mounted sidebar.

Connection and Guard messages remain visible, including last-known measurements/status, suspension, storage repair, and reload instructions. Reconnecting or expanding history cannot resume suspended enforcement. Monitoring is read-only and retains existing bounds, privacy, and disposal behavior.

See [configuration](configuration.md#native-context-guard-view), the [implementation plan](plans/sidebar-density.md), [sidebar validation](validation/sidebar-density-2026-11-06.md), and [terminology delivery](validation/plain-language-terminology-2026-11-07.md).
