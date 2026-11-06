# Native keyboard access and help validation

Date: 2026-11-06. Implements UX-08 from the [TUI UX review](../plans/tui-ux-review.md), following the [implementation plan](../plans/native-keyboard-help.md). Sidebar density (UX-07) remains proposed; these independent panel/state changes do not change sidebar defaults.

## Delivered behavior

The native panel exposes scrollable help with `?`, returning through `?` or Escape to the same view, selected session, chart metric/window, and source scroll position. Help owns navigation and disables commands for the hidden view. Enter cannot navigate out of help. Guard/connection consequences and close access remain outside its viewport. Selection removal uses the existing fallback; route changes dismiss help. Commands remain focus-scoped.

Help unmounts retained-history Charts, aborting pending reads and stopping polling. Returning to Charts permits its normal initial read for the same session/window. The panel retains one monitor consumer and continues collecting bounded context traces. Details scroll restoration, remapped/unbound shortcut labels, long bindings, Unicode, empty families, route changes, removal, and narrow help geometry have offline coverage.

Footer actions use effective shortcuts from the public host keymap, reserve help/close at ordinary narrow geometry, and fit complete clickable targets within measured cell widths. Long essential bindings fall back to action names; full shortcut strings remain in help. Actionable load-more is prioritized ahead of optional inspection/chart controls. Existing page navigation and native/standalone binding meanings are preserved.

Native inventory status now reports discovered count, scanning, pages, pending branches, damage/failure, current node limit, and continuation eligibility. Overview distinguishes discovery, resumable work, failed/damaged discovery, and the maximum node bound. Help contains full diagnostics when narrow header text is clipped. Load-more is disabled during scans and when 2048 discovered nodes prevent growth. Retained rows survive rescans; generation-checked settlement cannot publish to an obsolete route. The pre-existing shadowed scan-failure reset was corrected so route recovery clears the old route's failure flag.

## Public host API evidence

The pinned SDK declares `Context.options`, command binding/layer APIs, and `keymap.shortcuts`. The implementation uses these existing public boundaries without changing composer modes or installing raw keyboard listeners.

Source inspected:

- OpenCode 2.0.29 baseline commit [`4397ee44` keymap resolver](https://github.com/anomalyco/opencode/blob/4397ee44d038a5f17bf6ac161431673d93e563b5/packages/tui/src/context/keymap.tsx): `bind: false` bypasses configured bindings; omitted bindings have no default; global layers opt out of the base-mode requirement.
- The same commit's [keybind schema/parser](https://github.com/anomalyco/opencode/blob/4397ee44d038a5f17bf6ac161431673d93e563b5/packages/tui/src/config/keybind.ts) accepts only built-in command IDs, and its [client plugin schema](https://github.com/anomalyco/opencode/blob/4397ee44d038a5f17bf6ac161431673d93e563b5/packages/tui/src/config/index.tsx) accepts plugin options. The [child composer](https://github.com/anomalyco/opencode/blob/4397ee44d038a5f17bf6ac161431673d93e563b5/packages/tui/src/routes/session/composer/index.tsx) pushes its own input mode.
- OpenCode 2.1.2 commit [`a517687f` keymap](https://github.com/anomalyco/opencode/blob/a517687fde98a7329ada3ae644a01a9fc6c4e99e/packages/tui/src/context/keymap.tsx) and [keybind schema/parser](https://github.com/anomalyco/opencode/blob/a517687fde98a7329ada3ae644a01a9fc6c4e99e/packages/tui/src/config/keybind.ts) retain those binding constraints.

The first host attempt confirmed that a custom `keybinds["context-guard.show"]` override is ineffective. Delivery therefore uses the client plugin option `openShortcut`, passed to the same stable command ID, with `<leader>v` as the tested opt-in value. It remains unbound by default. Validation rejects empty, control-containing, non-string, or over-128-character options before registration; the host parses binding syntax. Child action text displays the effective shortcut. Full registration examples are in [configuration](../configuration.md#native-context-guard-view).

## Offline results

- `bun test`: **216 passed, 0 failed**, across 30 files on Bun 1.1.34.
- Strict `bun run typecheck`: passed.
- `bun run build`: passed for server, core, RPC, CLI, compiled Solid TUI, and declarations.
- Repository `bun run format:check` and `git diff --check`: passed.

Renderer cases include 80×24, 40×20, and 20×12 with suspension/reconnect messages, help scroll boundaries, selected identity, and help/close controls. Details returns to the captured source frame after a help round trip. A held chart request is aborted when help opens; hidden refresh/chart/open/branch commands do not execute. Returning preserves session/metric/window and does not reacquire the consumer. The renderer subprocess timeout is 15 seconds to accommodate the expanded geometry/interaction matrix; the fixture completes in approximately six seconds.

State tests cover delayed discovery, duplicate continuation suppression, resumable node-capped inventory, failed branches, fatal discovery recovery, route reset, and late obsolete results. Pure feedback/footer tests cover initial and maximum node bounds, damaged-but-resumable work, complete inventory, failed rescans, cell widths, and essential-action priority. Existing standalone editor/navigation behavior passes unchanged.

## Actual host results

OpenCode **2.0.29 and 2.1.2** passed the native PTY checks in the isolated synthetic-provider harness. Real keys exercise normal prompt typing without invoking panel help, slash entry, help scrolling/Escape return, chart-help round trips, suppression of hidden-view refresh, and chart polling cancellation. The configured leader sequence opens the panel on root, child, and grandchild routes; inspecting full session IDs verifies route identity. The child action remains available and native navigation returns to the root.

The surrounding checks pass streaming metrics, independent hierarchy/model changes, three RPCs, retained-history bounds/ownership, restart recovery, disabled history, scalar privacy canaries, 180/80-column context-chart continuity through child activity and lower readings, manual compaction, and completed child compaction followed by continued execution and success.

The initial sandbox invocation could not bind its loopback listener; host checks require local loopback and PTY access. One subsequent cancellation assertion raced the proxy delay setup. The harness now synchronizes on a cumulative delayed-request counter before changing views and waits for cancellation evidence, while retaining the actual abort and polling-stop assertions.

Reproduction:

```sh
bun run build
GUARD_SYNTHETIC_TUI=1 bun scripts/metrics-server-live.ts
GUARD_SYNTHETIC_TUI=1 GUARD_SYNTHETIC_BINARY=/absolute/path/to/opencode-2.0.29 bun scripts/metrics-server-live.ts
```

## Boundaries

The shortcut is opt-in because users can have conflicting bindings. The PTY check does not certify every custom shortcut, permission/dialog combination, terminal multiplexer, other platform, or cross-machine client. Permission-wait and resumed child activity are exercised by the surrounding synthetic workload; the keyboard-entry checks specifically establish root/child/grandchild access and normal prompt/help separation. No genuine-provider certification is claimed.

No policy, accounting, scheduler, compaction lifecycle, RPC schema, telemetry allowlist, dependency, or export boundary changed. No version bump, package publication, or registry-dependent package installation check is included. The package renderer fixture was updated for the public shortcut-label read. Tiny terminals below usable status/identity/control geometry retain existing practical limits.
