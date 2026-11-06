# Compact sidebar defaults validation

Date: 2026-11-06. Implements UX-07 from the [TUI UX review](../plans/tui-ux-review.md), following the [implementation plan](../plans/sidebar-density.md).

## Delivered behavior

The sidebar opens with identity/execution, measured context tokens/capacity, one occupancy bar, threshold distance, measurement confidence/age, and existing Guard/connection consequences. Panel access precedes descendants. History starts collapsed and can be toggled with its mouse action or the unbound `context-guard.history` palette command. Route changes/remounts reset disclosure; bounded shared traces continue collecting while collapsed. Ordinary descendants use identity and a separate context/threshold line; narrow widths abbreviate or wrap. Failed/unknown execution, stale/unknown measurements, interruptions and non-idle compaction remain explicit.

Completed grouping requires completed trustworthy discovery and fresh known normal pressure, monitored idle compaction, and no interruption throughout a subtree. Scanning, incomplete, failed or damaged discovery reveals completed rows. Cycles, missing descendants and depth/node cutoffs prevent affected branches from qualifying. Counts use session identities and expansion preserves hierarchy. Live attention states ungroup automatically. Manual folding remains separate and reports hidden count/attention. Existing completed/sort/group palette IDs remain available.

Throughput stays in selected-session Details. Route family statistics now appears there with route identity and partial state, using unfolded route-descendant rows rather than selected-session or displayed rows. Compaction counts, active descendant counts, independent peak sums and unavailable values retain their original semantics. No policy, scheduler, accounting, snapshot/RPC contract, telemetry allowlist, dependency, export, version, or publication changes are included.

## Offline evidence

| Outer width | Previous fixture | New default fixture      | Target                                                     |
| ----------- | ---------------- | ------------------------ | ---------------------------------------------------------- |
| 39 columns  | 63 lines         | 22 lines                 | At most 28                                                 |
| 35 columns  | Not remeasured   | 22 lines                 | At most 34                                                 |
| 20 columns  | Not remeasured   | Wrapped fallback checked | Identity, threshold meanings, actions and borders retained |

Measurements include borders, status, controls and the collapsed completed count. They describe the ordinary four-descendant renderer fixture; exception messages and larger families can occupy more lines.

- `bun test`: **220 passed, 0 failed**, across 30 files on Bun 1.1.34.
- `bun run typecheck`: passed.
- `bun run build`: passed for server/core/RPC/CLI, compiled Solid TUI and declarations.
- Repository formatting and `git diff --check`: passed.

Added coverage includes all non-idle lifecycle phases, stale/missing/invalid/unmonitored values, failed/unknown/idle execution, interrupted completion, grouped hierarchy/counts, duplicate IDs, bounded cycles/depth, discovery gating, narrow Unicode formatting, reactive eligibility, mouse/palette disclosure, early panel navigation and consumer cleanup. The renderer records trace collection before disclosure without invoking an update from its assertion, then checks earlier samples and the confirmed-compaction drop after expansion. The panel fixture supplies an omitted completed descendant only to unfolded reads and verifies unchanged route-family totals when inspecting a child, plus partial totals and existing help/scroll restoration.

## Actual-host validation

OpenCode **2.0.29 and 2.1.2** both passed the complete isolated synthetic-provider harness against the rebuilt `dist` artifact. Actual keys exercise slash entry, charts/windows/arrows, help and selection restoration, configured child/grandchild entry, polling cancellation, and continued monitoring. Sidebar History is expanded through its mouse control. Scalar chart captures at 180/80 terminal columns retain the pause/permission plateau, child activity, lower reported reading, and confirmed-compaction drop across panel/sidebar transitions.

The surrounding server checks pass all three RPCs, independent hierarchy/model changes, history bounds/ownership, restart/retention, disabled history, and privacy canaries. Child compaction ends, execution continues through further tools, and the native task succeeds. These checks use synthetic usage rather than a genuine provider. Completed-group edge cases and family-statistics scope are established by offline tests, not every state in the host workload.

Reproduction:

```sh
bun run build
GUARD_SYNTHETIC_TUI=1 bun scripts/metrics-server-live.ts
GUARD_SYNTHETIC_TUI=1 GUARD_SYNTHETIC_BINARY=/tmp/guard-terminal-host-2029/node_modules/@opencode/cli-linux-x64/bin/opencode bun scripts/metrics-server-live.ts
```

The default host was `opencode` 2.1.2; the explicit binary was 2.0.29. Host checks require local loopback and PTY access. The 2.0.29 sandbox invocation could not bind its listener and was rerun with approval.

The PTY fixture explicitly expands History through its existing mouse action before scalar chart capture and after remount. The initial 2.1.2 run exposed a wrapped history legend: “muted held” split across lines. The legend now wraps independently from the observation-order line. An initial 2.0.29 run stopped during an existing chart-toggle check before sidebar-history checks; a fresh run against the rebuilt artifact passed. No specific cause for that first toggle failure was established.

## Boundaries

Sidebar allocation and visibility remain host-controlled, including narrow and child routes. Large active families can exceed the sidebar; the panel link is deliberately placed before the tree. Synthetic-provider runs do not certify genuine-provider accounting/reclaim, cross-machine clients, other platforms, tmux or Neovim. Existing keyboard/help, inventory feedback and optional child-route shortcut behavior remain in scope for regression checks. No registry-dependent package check is required because distribution boundaries did not change.
