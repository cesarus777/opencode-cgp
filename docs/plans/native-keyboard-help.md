# Native keyboard access and help

Date: 2026-11-06. Status: implemented; see the [delivery record](../validation/native-keyboard-help-2026-11-06.md) for actual results and limitations. Covers UX-08 from the [TUI UX review](tui-ux-review.md). Delivered independently of [sidebar density](sidebar-density.md) (UX-07), which has since been [implemented and validated](../validation/sidebar-density-2026-11-06.md). The investigation and design contract below are retained as implementation scope.

## Delivered integration adjustment

Actual host verification found that OpenCode 2.0.29 and 2.1.2 accept only built-in command IDs in their `keybinds` configuration. Omitting `bind: false` enables the command's normal binding path, but does not make a custom `keybinds["context-guard.show"]` override usable on those hosts. The implementation therefore uses the public client plugin option `openShortcut`, validated as a nonempty key sequence of at most 128 characters without control characters, and passes it as the existing command's binding. No default binding is installed. The tested opt-in value is `<leader>v`; see [configuration](../configuration.md#native-context-guard-view). Effective shortcut labels still come from the public keymap API.

## Investigation and scope

Add discoverable native-panel help, contextual controls, useful partial-inventory feedback, and verified keyboard access from child routes. Preserve established bindings and native typing, dialogs, navigation, and cancellation behavior.

PageUp/PageDown and Home/End already exist in `src/tui/panel.tsx` and are documented in `docs/configuration.md`. They are not new work for UX-08. The original review describes the interface before UX-01; remaining work must follow current source rather than repeat that historical finding.

| Source                                          | Current behavior                                                                                                                | Proposed change                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/tui/panel.tsx`                             | Focus-scoped commands, Overview/Details/Charts, page navigation, clickable footer actions; no help view.                        | Add local help that preserves session selection and the underlying view.                                         |
| Panel `actions` / `hint`                        | Narrow layouts omit actions; load-more appears in a clipped hint, and chart arrows have different meanings from Details arrows. | Reserve help/close controls and show only actions applicable to the active view.                                 |
| `src/tui/state.ts`                              | `complete()` exposes one boolean; scanning, failure, inventory bounds, and resumable work stay internal.                        | Expose a small reactive read-only inventory-status projection for truthful loading and recovery feedback.        |
| `src/tui/inventory.ts`                          | Tracks discovered sessions, pages, pending branches, and damage; bounded to 100 pages per action and depth 64.                  | Reuse existing facts; do not invent progress percentages or promise complete discovery.                          |
| `src/tui.tsx`                                   | Global named open command has `bind: false`; child-composer contribution is mouse-only.                                         | Verify a configurable keyboard path in the actual child input mode before choosing any default binding.          |
| Pinned `@opencode/plugin/dist/tui/context.d.ts` | Declares command enablement, layer modes/targets, configurable command IDs, `shortcuts`, `commands`, and `mode.current`.        | Use public interfaces and configured shortcut labels, with host verification for dispatch and conflict behavior. |
| `src/dashboard/terminal.ts`, `terminalview.ts`  | Standalone help exists; editor input takes precedence. `l` edits location and brackets inspect history.                         | Document differences; preserve existing standalone behavior and key meanings.                                    |

Baseline: `bun test tests/tuirender.test.tsx tests/tuiinventory.test.ts tests/tuistate.test.ts tests/dashboardterminal.test.ts` passed **23 tests, 0 failures** during planning. This is current-behavior evidence, not validation of the proposal. No new interactive-host check was run. Consult [architecture](../architecture.md), [API investigation](../reconnaissance.md), and [compatibility](../compatibility.md) before implementation.

## Help interaction contract

Add a stable `context-guard.help` command, default `?`, enabled only while the panel is focused. Show help inside the panel's existing scroll viewport, keeping connection/Guard status and help/close actions outside it. Help describes the active surface as “Native OpenCode panel” to distinguish it from standalone dashboard shortcuts.

Help is local UI state layered over the current view, not a new route. Save the source view, selected full session ID, chart metric/window, and source scroll position. `?` toggles help; Escape returns from help; `q` closes the panel as before. Help arrows, PageUp/PageDown, and Home/End scroll help. Enter, Space, chart switches, refresh, and load-more must not act on the hidden source view while help owns input. Reuse a single explicit action/enablement model so keyboard dispatch and mouse footers agree.

On return, retain selection and source position; clamp offsets after resizing or data changes. If the selected session disappeared, retain the existing route/first-row fallback. Route-session changes dismiss help and reset through the normal Overview path. Unfocused panels must not consume `?`, Escape, or navigation keys. Do not add a new non-help Escape behavior without checking the host's existing panel/dialog handling.

Help sections should cover:

- Selection versus the current OpenCode route, `>`/`*` markers, and Enter navigation.
- Overview selection, Details scrolling, Charts session selection versus metric/window controls, and existing page/boundary navigation.
- Branch expansion only where a selected row has hidden descendants; load-more only when inventory is resumable.
- Refresh behavior, including the fact that refresh cannot resume suspended enforcement.
- Existing standalone differences: native `l` loads more, standalone `l` changes location; native brackets change windows, standalone brackets inspect observations; standalone `w` cycles windows.

Render effective configured bindings using `context.keymap.shortcuts(id)` where available through the pinned public API. A disabled/unbound command must not display a fictional default binding; show its action name and configuration/palette route instead. Keep stable IDs for existing commands. Do not change defaults merely to make the two surfaces look alike.

### Footer layout

Generate visible action labels and handlers from a small native presentation action model, shared with help content where practical. Keep handlers and state ownership in the panel; avoid a general command framework or dashboard refactor.

Reserve `? help` and `q close` at normal narrow geometry, then add context actions if they fit. For example, the default labels fit within the 16 content cells of a 20-column panel as `? help q close`. Use cell-aware widths, configured bindings, and measured content width; do not depend on whole-footer clipping to choose actions. Longer custom shortcuts can use additional bounded footer lines or a short action label with full binding information in help. Below usable geometry, retain a bounded fallback rather than claiming every instruction fits.

Overview should advertise selection/open, Details scrolling/back, and Charts metric/session/window controls. Display Space only for an expandable selected row. Display load-more as a clickable action when actionable; omit it for complete inventory. Critical status text must not be traded away to fit extra hints.

## Inventory feedback

Add a renderer-independent status accessor in `state.ts` with scalar facts such as discovered count, node limit, scanning, pending-work count, accumulated page count, damaged/failed state, and whether continuation is actionable. It remains client-local; no monitor RPC schema changes are needed.

Notify at scan start and settlement, with the existing generation checks so an old route's completion cannot overwrite the current route. Preserve one scan at a time, existing cancellation/deadline behavior, and current bounds: 1024 initial nodes, up to 2048 after load-more, depth 64, and 100 list pages per action. Do not expose raw exceptions, sessions, credentials, or response content in status.

Use messages derived from actual facts:

| State                              | Presentation/action                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Scanning                           | “Discovering agents · N found”; load-more temporarily disabled.                                         |
| Pending work below node limit      | “Partial family · load more”; continuation resumes the pending queue.                                   |
| Pending work at initial node limit | Explain the current limit and that load-more can raise it to 2048.                                      |
| Pending work at maximum node limit | Explain the 2048-node bound; do not offer an endless ineffective load-more action.                      |
| Damaged discovery or failed scan   | Explain that family discovery is incomplete; offer existing refresh/rescan, without promising recovery. |
| Complete                           | Show the discovered count with no continuation action.                                                  |

Multiple facts can coexist: a damaged inventory can still have resumable work. Keep both the partial warning and valid continuation. `complete() === false` alone is insufficient to choose the action. Retain last-known rows and selection during discovery. No progress percentage or total-agent estimate is available.

## Child-route keyboard access gate

The pinned declarations establish that public command configuration and mode-aware layers exist; they do not prove a particular binding is reachable or safe inside the host's child composer. Existing renderer tests call handlers directly and test the child contribution with a mouse, so they cannot establish keyboard dispatch safety.

Before selecting a binding, inspect the pinned host's command resolver, child composer mode, dialogs, and default/configured shortcuts. Record exact source/version evidence. Test whether binding the existing stable `context-guard.show` ID gives keyboard access on root, child, and grandchild routes, including active execution and permission input. Prefer that existing configurable command over a duplicate open command. Use the public keymap APIs; do not push the host into a different mode to bypass its composer or install a raw global key listener.

Choose a default shortcut only after demonstrating no conflict with native editing, submission, cancel, leader sequences, or host commands on OpenCode 2.0.29 and 2.1.2. Display the effective shortcut beside the child action. If no safe default is available, retain an unbound configurable command and document the exact tested binding configuration and its limitations. If even a configured command cannot work safely in a supported child mode, record keyboard child access as unresolved; ship independently validated help/feedback as partial UX-08 and do not mark the whole recommendation delivered. Existing mouse and root slash/palette access remain available.

## Implementation sequence

1. Verify child-mode dispatch and shortcut behavior against pinned public host implementation and both supported runtimes; record evidence and choose the keyboard-access contract.
2. Add the small inventory-status projection in `state.ts` with deterministic delayed/completed/failed/resumed scan tests in `tests/tuistate.test.ts` and existing inventory-bound coverage.
3. Add help state/rendering and a native action/label helper, either beside `panelformat.ts` or in a small `panelcontrols.ts` module. Keep selection, scroll restoration, trace collection, and consumer ownership intact.
4. Wire contextual command enablement, narrow footers, configured shortcut labels, and actionable inventory feedback. Integrate verified child entry in `src/tui.tsx` without changing route scope or acquiring monitoring merely to display the action.
5. Extend native renderer and actual-host PTY fixtures. Update README, the native controls table in `docs/configuration.md`, `docs/testing.md`, and compatibility evidence only for behavior delivered. Add a dated validation record and update the review's status, distinguishing partial from complete UX-08.

UX-07 has since been [delivered](../validation/sidebar-density-2026-11-06.md), building on these independent panel/state changes. Its sidebar palette controls and route-family statistics preserve this help and inventory behavior. No policy, scheduler, accounting, lifecycle, telemetry, transport, public RPC, dependency, export, release, or publication changes are planned.

## Acceptance and verification

- At 80×24, 40×20, and 20×12, open/scroll/dismiss help from every view; preserve selected identity, source view/offset, chart metric/window, and visible suspension remedies. Test resize, removal, empty families, Unicode, and long configured shortcuts.
- Keyboard and mouse use the same actionable state. Hidden-view commands do not execute during help; unfocused/disposed panels do not consume keys. Existing page navigation, chart controls, branch expansion, and stable ordering still work.
- Partial inventory distinguishes scan progress, resumable pages, initial/max node bounds, damaged branches, and failures. Repeated load-more during a scan cannot create another scan; obsolete completions cannot publish to a new route. Failure/cap messages never claim completeness or resumed enforcement.
- Help does not acquire another consumer or history poller. Proposed lifecycle: opening help from Charts unmounts chart polling and aborts in-flight reads; returning remounts Charts with the same selection/window and permits its normal initial read. Selection, source scroll, trace collection, and the panel's single monitor consumer persist. Verify abort/timer cleanup and no reads from help navigation.
- Actual keyboard dispatch opens the same panel on root/child/grandchild routes using the verified default or configured binding. Ordinary typing, native shortcuts, permission dialogs, composer submission, and panel close still work. Direct test calls to `command.run()` are insufficient evidence.
- Standalone help, editor precedence, and existing key meanings remain unchanged. Document cross-surface differences instead of silently migrating them.

Start with `bun test tests/tuirender.test.tsx tests/tuistate.test.ts tests/tuiinventory.test.ts tests/dashboardterminal.test.ts`. Extend `tests/fixtures/tui-host.tsx` for rendering/actions and the existing `scripts/fixtures/metrics-tui.py` host driver for real keyboard dispatch, focus restoration, and history cleanup.

After implementation run typecheck, full offline tests, format check, build, and `git diff --check`. Run the opt-in synthetic-provider native host harness on OpenCode 2.0.29 and 2.1.2 with the verified binding and isolated configuration. Preserve scalar privacy checks and report unavailable host checks as skips. Genuine-provider, remote, tmux, and other-platform claims require separate evidence. This planning change needs documentation formatting and link checks only.
