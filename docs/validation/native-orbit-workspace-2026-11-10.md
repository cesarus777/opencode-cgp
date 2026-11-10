# Native Orbit workspace — 2026-11-10

Implements the [accepted native panel plan](../plans/native-orbit-workspace.md).

## Delivered behavior

The expanded `/context-guard` panel uses a family rail beside selected-session context/performance panels when allocation reaches 110 content columns and 28 usable rows after padding. Smaller or shorter allocations retain the compact presentation. The breakpoint uses the panel's measured allocation, not the whole terminal size.

Overview adds the existing local context trace beneath the metric panels. Details scrolls through those panels, context history, readable explanations, diagnostic codes, ancestry and route-family statistics. Charts keeps the family rail and uses the right pane for the existing retained performance view. Recent context remains observation-order history; it is not a retained TPS timeline.

The family rail and active content have separate scroll viewports. Selection follows full session identity; `>` and `*` distinguish selection and current route. Existing native keys, click-to-open rows, branch folding, load-more and focus gating remain. Help temporarily replaces the workspace, pauses/aborts history work, and restores content/tree scroll state. Resizing and view changes retain one monitor consumer.

The default actual-host split panel is too narrow for this workspace even in a 180-column terminal. The new **fullscreen** footer action calls the public `PanelInput.toggleFullscreen()` API; **split** returns to the host panel. An unbound, focus-scoped **Toggle Context Guard fullscreen** palette action exposes the same operation. No default key or global binding is added.

The panel uses default terminal foreground and ANSI cyan/green/yellow/red slots, with bold headings, dim supporting text and inverse selection. Native boxes remain unfilled; host renderer colors and compact sidebar styling are untouched. Execution, occupancy and threshold pressure retain separate labels and styling. No custom theme or palette settings are introduced.

Per-session server timing determines performance freshness independently of context age. Stale/disconnected/future-dated performance readings have their displayed current rates masked without modifying the stored snapshot, context measurement or accounting. The existing expiry timer also schedules performance expiry. Threshold bars use effective capacity and resolved policy triggers, preserve overflow text, and never invent missing values. Admission, completion counts and compaction recovery remain distinct.

## Offline validation

- `bun run typecheck`: passed.
- `bun run format:check`: passed.
- `bun run build`: passed; server, core, RPC, CLI, Solid TUI and declarations.
- `git diff --check`: passed.
- Bun 1.3.11: `bun test --timeout 15000`: **258 passed, 0 failed**, across 35 files. The longer per-test timeout accommodates the existing slow Models viewport test.

Four new pure formatter tests cover allocated geometry, inclusive/strict policy equality, trigger placement, stale/invalid/missing context, overflow, performance freshness boundaries, clock validity, independent context/performance freshness, non-mutating rate masking, Unicode/control sanitization and selection markers.

The public Solid renderer fixture additionally covers 120×40 and 180×50 workspaces, exact width/height boundaries, 80×24/40×20/20×12 fallbacks, constrained panel allocation in a wider host, large windowed families, terminal color intents, inverse selection, fullscreen dispatch, help gating, independent scroll/reveal behavior, diagnostic reachability, route-family scope, stale performance, retained-history reuse and consumer cleanup. The fixture still runs under the installed Bun 1.1.34 preload; the full suite uses Bun 1.3.11. Existing sidebar frame and context continuity tests pass.

A native-renderer screenshot with synthetic scalar data is retained locally at `.artifacts/native-orbit.png`; actual colors follow terminal settings.

## Host validation

The existing isolated synthetic-provider harness was extended to click **fullscreen**, assert that the actual host displays **Session family** and the metric workspace, and verify that this adds no retained-history reads. Each host uses separate scalar chart artifact directories through the validation-only `GUARD_NATIVE_ARTIFACT_DIR` environment variable.

Both final built-host runs exited successfully:

| Host                                | Result                               | Local evidence                                                                 |
| ----------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------ |
| OpenCode 2.0.29, pinned CLI package | PASS, 29 synthetic provider requests | `.artifacts/native-orbit-029.log`, `.artifacts/native-orbit-029/context-*.png` |
| OpenCode 2.1.2, installed CLI       | PASS, 29 synthetic provider requests | `.artifacts/native-orbit-212.log`, `.artifacts/native-orbit-212/context-*.png` |

Commands use `GUARD_SYNTHETIC_TUI=1 bun scripts/metrics-server-live.ts`, with `GUARD_SYNTHETIC_BINARY` selecting the pinned 2.0.29 binary and `GUARD_NATIVE_ARTIFACT_DIR` separating host captures. Loopback/PTY execution used the approved host environment.

The actual PTYs exercised fullscreen entry and the workspace, native slash/keyboard entry on root/child/grandchild routes, help/selection continuity, chart metric/windows, refresh and retry, polling cancellation, context plateaus during pauses/permission waits, lower reported usage, manual compaction, and sidebar/panel trace continuity at 180/80 terminal columns. The surrounding harness passed bounded RPC/history/privacy checks, restart retention, disabled recording, and plugin-caused child compaction followed by continuation and execution success. Each run cleaned up its isolated servers and temporary project/config/data/state.

These checks exercise synthetic provider responses and local Linux x64 PTYs; they do not establish genuine-provider accounting, cross-machine HTTPS, other platforms, tmux or Neovim compatibility. Registry-dependent package installation was not repeated for this presentation change.
