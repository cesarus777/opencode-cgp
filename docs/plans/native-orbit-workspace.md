# Orbit layout for the native OpenCode panel

Date: 2026-11-10. Status: implemented; see the [delivery record](../validation/native-orbit-workspace-2026-11-10.md). The design and implementation sequence below record the accepted plan.

## Outcome and scope

Interpret “verbose mode” as the expanded native `/context-guard` panel, including its Overview, Details and Charts views. Apply the approved Orbit design: a persistent session family tree, a clear selected-session identity, separate context and performance panels, and a chart or diagnostic workspace. Keep the compact OpenCode sidebar outside this increment.

Use terminal defaults and standard ANSI slots, with bold headings, dim supporting text and inverse selection. Add no custom theme, palette configuration or dependency. The terminal determines the actual colors. Backgrounds remain unfilled so the plugin fits within the surrounding host panel; do not change the host renderer's global colors.

This is a presentation change. Preserve existing monitoring, inventory bounds, accounting, policy, compaction lifecycle and RPC contracts. Do not import the standalone dashboard controller into the native plugin.

## Current implementation

- `src/tui/panel.tsx` owns view selection, selected session, focus-scoped commands, one acquired monitor consumer, one scroll viewport and the retained-history lifecycle.
- `src/tui/panelview.tsx` renders the family list and a vertically stacked Details view. Details currently puts context history before readable explanations and raw diagnostics.
- `src/tui/panelformat.ts` formats the selected summary and wide/narrow family rows. `statusformat.ts` supplies measurement, threshold, enforcement and lifecycle explanations.
- `state.contextTrace()` supplies bounded recent context history. `HistoryState` separately fetches retained performance history only while Charts is active, and pauses during help.
- `PanelInput.width` is the allocated panel width. The host owns panel/fullscreen presentation; height must come from renderer size callbacks. A wide terminal does not necessarily allocate a wide plugin panel.
- `src/dashboard/presentation.ts` contains the standalone Orbit design. Use it as a visual reference; it also contains dashboard-specific freshness and history assumptions that should not be copied into native state.

## Proposed layout

Illustration only; values and window are examples:

```text
Context Guard                       Live · Observing
Guard won't request compaction
Overview   i Details   c Performance charts

┌ Session family ────┐  build / provider/model       Running
│ >* build          │  Session: ses_…
│    73% · Running  │  ┌ Context ──────────┐ ┌ Performance ────┐
│  ├ explore        │  │ 93.4k / 128k     │ │ ~42.8 live TPS  │
│  │ 24% · Running  │  │ 73% occupied     │ │ ~0.82s TTFT     │
│  └ review         │  │ ━━━━━━━━━┆────   │ │ 38.6 model avg  │
│    41% · Failed   │  │ Trigger 102.4k   │ │ Partial timing  │
│                  │  │ 9.0k below      │ └─────────────────┘
│                  │  └─────────────────┘
│                  │  Compaction idle · 2 completed
│                  │  ┌ Recent context / samples → now ─────┐
│                  │  │ Existing context trace and legend  │
└──────────────────┘  └─────────────────────────────────────┘
↑↓ select   i details   c charts   Enter open   ? help   q close
```

The selected session and the current OpenCode route remain distinct: `>` means selection and `*` means current route. The route still determines family/statistics scope. Selecting a child changes its metric panels without silently navigating OpenCode.

The context panel shows occupied tokens/effective capacity, percent, a capacity bar with the **resolved policy trigger** marker, threshold distance, measurement age and confidence. It must support token, ratio and remaining-token policies; never hardcode an 80% trigger. Keep occupancy and pressure separate.

The performance panel shows live TPS, TTFT, model average and session average with estimate, freshness and partial-coverage qualifiers. Missing or expired performance values must not appear as current rates. Existing rates retain their distinct denominators.

Show compaction state directly beneath the metric panels. Accepted means waiting; an ended event does not prove recovered context. Keep completed counts separate from requests and retain blocked/unconfirmed warnings.

### Content by view

| View     | Wide workspace                                                                                                                      | Existing interaction to retain                                                         |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Overview | Tree, selected-session panels, bounded recent context chart                                                                         | Arrows select; Space folds branches; `l` loads more; Enter opens selected session      |
| Details  | Tree remains visible; right pane scrolls through panels, explanations, exact diagnostic codes, ancestry and route-family statistics | Arrows/page keys scroll; `i` returns to Overview with the same selection               |
| Charts   | Tree remains visible; right pane shows retained performance chart, window, provenance, recovery status and coverage                 | Arrows select sessions; Left/Right changes metric; brackets change window; `c` returns |
| Help     | Readable scrollable help replaces the workspace temporarily                                                                         | Pause retained-history reads; restore source view, selection and scroll when closed    |

Keep native bindings rather than copying standalone `1/2/3/4`, search, location or bucket controls. Build tab/footer labels from effective shortcuts. Preserve existing row click-to-open behavior; view actions remain clickable. Do not introduce a second keyboard focus mode or a new global shortcut.

The Overview chart is **recent context**, not retained TPS. Label that distinction prominently. Rendering it uses the existing context trace and adds no history RPC or polling. Retained performance stays behind `c`; if a matching cached plot is displayed outside Charts later, that is a separate increment.

## Responsive behavior

Start with a workspace breakpoint of **110 allocated content cells × 28 measured usable rows**, after panel padding. Verify it with native fixtures before fixing the final constants.

| Available geometry | Layout                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Wide and tall      | Family rail around 26–32 cells; remaining space holds context/performance side by side and the active lower pane                 |
| Medium             | One column; selected metrics collapse to short labeled lines; Overview preserves useful family-list space; Details/Charts scroll |
| Narrow or short    | Existing compact list/cards and explicit Details/Charts views; selected identity, critical status and help/close take priority   |

Persistent header/status and footer stay outside scrollable content. Bound long identifiers in the fixed area and expose full identities in Details. Keep the selected tree row visible through live updates, resizing and branch folding. A large family must not render every row; retain bounded visible windows and measure paging from actual row heights.

## Implementation sequence

1. **Separate layout decisions from lifecycle.** Add a small pure native layout helper that returns geometry and content budgets from allocated width/height. Keep `GuardPanel` as the only owner of selection, the monitor consumer and `HistoryState`. Identify separate tree/content scroll refs and preserve existing frame-callback cleanup.
2. **Build native metric components.** Add `src/tui/workspace.tsx` for the tree rail, context/performance panels and view composition. Use Solid/OpenTUI boxes and text spans, existing sanitized grapheme-aware formatters, and `GuardRow`. Reuse context-chart and status semantics. Extract a shared presentation helper only where both frontends truly use the same data; do not reuse dashboard-specific row contracts or string-frame rendering.
3. **Apply terminal-native styling.** Use `RGBA.defaultForeground()` for text and standard indexed ANSI slots for cyan headings, green execution/normal pressure, yellow attention and red failures/reached thresholds. Use bold/dim/inverse attributes. Avoid RGB literals, custom fills and palette detection. Style execution and pressure independently; all important states also have text labels. Verify these APIs against the installed public OpenTUI declarations before wiring them.
4. **Compose the wide workspace.** Render the tree alongside the active content. Keep Overview's selected summary predictable, move verbose diagnostics below its panels in Details, and give Charts the right pane width. Route selection-reveal callbacks to the tree and scroll commands to the appropriate content viewport. Preserve narrow layouts and native open/fold/load-more behavior.
5. **Preserve view continuity.** Help must capture and restore the active scroll state, pause/abort chart reads, and retain matching plots. Route changes reset to Overview; selected-row removal falls back to route session, then first available row. Refresh/focus behavior keeps its existing stable-order contract. View switches and resize never reacquire a monitor consumer or start duplicate subscriptions.
6. **Validate and document.** Extend native formatter/renderer fixtures and real-host PTY expectations where the presentation intentionally changes. Update native controls/layout documentation and add a dated delivery record with actual tested host versions and limitations.

## Acceptance checks

- Context/performance values refer to the selected full session ID; current-route markers and family statistics retain route scope.
- Stale context remains explicitly last measured, with pressure unknown. Invalid/missing values remain unknown; no fabricated zero or live rate appears.
- Inclusive and strict threshold equality, changed models, absent capacity, estimated usage, blocked/accepted/running/unconfirmed compaction and suspended Guard remain distinguishable.
- Critical enforcement/reconnect/storage messages remain visible across views and include the existing remedies. Connection recovery does not imply enforcement resumed.
- Tree selection survives reorder, disappearance, branch folding and resize; long CJK/emoji names stay within cell budgets. Full diagnostics and final accounting lines remain reachable.
- Test wide 120×40 and 180×50 allocations, breakpoint boundaries, and 80×24, 40×20 and 20×12 fallbacks. Include constrained panel allocation inside a much wider host.
- Verify default color intents and ANSI slots, bold/dim/inverse attributes, and readable state labels without color. Check both light and dark terminal backgrounds without adding application themes.
- Repeated Overview/Details/Charts/help transitions retain one monitor consumer, bounded context traces and the existing history read/cancellation budget. Closing removes renderer callbacks and releases consumers.

Extend `tests/tuirender.test.tsx`, `tests/fixtures/tui-host.tsx`, `tests/statusformat.test.ts`, and state/history tests only where behavior changes. Run focused native tests, typecheck, formatting, the full offline suite and build. Use the existing isolated `GUARD_SYNTHETIC_TUI=1` host harness for OpenCode 2.0.29 and 2.1.2 when available; report skipped or unsupported probes separately from passes. Host validation must preserve the compact sidebar and native session/composer workflows.

Completion means the native panel has the approved Orbit hierarchy, accurate responsive content and native controls, with no new theme support or backend work. The delivered panel also exposes a fullscreen/split footer action through the host’s existing `PanelInput.toggleFullscreen()` API, with an unbound palette command. Actual host checks showed that the default split panel is too narrow for the workspace even in a wide terminal; this action makes the allocated workspace accessible without installing a shortcut.
