# Plain-language terminology validation

Date: 2026-11-07. Implements UX-09 from the [TUI UX review](../plans/tui-ux-review.md), following the [implementation plan](../plans/plain-language-terminology.md).

## Delivered behavior

Native sidebar/panel summaries use “Provider reported” and “Estimated,” with age and “out of date” qualifiers. Unknown and unusable readings remain distinct. Details explains measurement scope separately from source and confidence, preserving last-completed versus prepared request meaning. Stored policy decisions are labeled as recorded decisions so a stale snapshot does not imply current pressure.

Shared lifecycle wording distinguishes requesting, accepted/waiting, running, ended/checking reduction, suppressed retries, and unconfirmed completion. Idle means no request is in progress, not success or permission to compact. Native exception rows wrap critical explanations; standalone overview uses concise lifecycle variants in bounded cards, with full explanations in Details.

Native and standalone Details lead with readable context/lifecycle explanations, then expose exact diagnostic codes and accounting. Native diagnostics retain phase, armed state, blocked/policy/health reasons, confidence, freshness, scope, provenance, limits, cooldown and cumulative scope. Standalone retains full IDs and every snapshot field, including unavailable fields. TPS/TTFT and incomplete timing coverage are explained alongside performance values. Recognized reasons get explanations; unknown reasons retain their sanitized code without invented recovery instructions.

Sidebar and panel context legends use “Dim = last known context” and “┄ threshold.” Held geometry, trace collection, compaction verification and accounting remain unchanged. Lifecycle formatting lives in renderer-free `statusformat.ts` and remains available through its existing `panelformat.ts` entry point, avoiding a cycle through `format.ts`.

No policy, scheduler, accounting, persistence, telemetry allowlist, transport/RPC schema, public export, dependency, version or publication changes are included. UX-10 chart error classification, stale-result behavior and retry remain separate work.

## Offline evidence

| Outer sidebar width | Default rendered lines   | Existing target                                            |
| ------------------- | ------------------------ | ---------------------------------------------------------- |
| 39 columns          | 22                       | At most 28                                                 |
| 35 columns          | 23                       | At most 34                                                 |
| 20 columns          | Wrapped fallback checked | Identity, context/threshold meanings and controls retained |

The renderer measures the same ordinary four-descendant fixture, including border, status and controls. Exceptions and larger families can use additional lines. Native panel and standalone renderer coverage includes 80×24, 40×20 and 20×12 layouts. Native paging reaches both readable measurement explanations and exact scope diagnostics; help/back, child selection, route-family scope and cleanup remain covered.

New semantic checks exercise confidence/scope combinations, stale estimates, model-mismatch/future-timestamp invalidation, all seven lifecycle phases, narrow accepted/ended/uncertain messages, blocked-reason explanations and unknown-code sanitization. Standalone assertions retain every snapshot path and verify that readable explanations precede diagnostics and explain performance terms.

- `bun test`: **222 passed, 0 failed**, across 30 files on Bun 1.1.34.
- `bun run typecheck`: passed.
- `bun run build`: passed for server/core/RPC/CLI, compiled Solid TUI and declarations.
- Repository formatting and `git diff --check`: passed.

An earlier suite run timed out in the unchanged Models viewport test while host harnesses were also running; the subsequent full suite passed. No specific cause was established. An added native renderer assertion initially assumed a single-line phrase; it now checks the same words across wrapping without weakening diagnostic reachability checks.

## Actual-host evidence

The standalone synthetic-provider PTY harness passed on OpenCode **2.1.2 and 2.0.29** using the built CLI and Bun terminal runtime. It covers authenticated connection, root/concurrent children, Details/diagnostic access, history metrics/windows, resizing, Models, restart recovery, privacy and terminal restoration. The 2.0.29 run additionally checks the visible TPS/TTFT glossary and labeled diagnostics.

The native synthetic-provider harness passed on **OpenCode 2.0.29 and 2.1.2**, including slash/keyboard entry, root/child/grandchild access, help/back, chart metrics/windows, polling cleanup, continued monitoring, and 180/80-column chart continuity through pauses, permissions, child activity, lower readings and confirmed compaction. Server checks cover all three RPCs, hierarchy/model changes, history bounds/ownership, restart/retention, disabled history and privacy canaries. Child compaction ended, execution continued through tools, and the task succeeded.

Two earlier 2.1.2 native attempts passed navigation/help/polling but did not complete the context-chart sequence: one lacked chart geometry at the lower-reading capture, and one lacked the expected root percentage after child activity. Builds were regenerated during those runs; no causal link to the failures was established. The harness now waits for scalar chart geometry before capture and reports only approved UI-presence markers on failure. Plateau, held-value and confirmed-drop assertions remain intact. The final 2.1.2 rerun against the unchanged build passed the complete harness, including the chart sequence and child compaction/continued execution. No source change to chart collection or geometry was needed.

Reproduction:

```sh
bun run build
GUARD_SYNTHETIC_TUI=1 bun scripts/metrics-server-live.ts
GUARD_SYNTHETIC_TUI=1 GUARD_SYNTHETIC_BINARY=/tmp/guard-terminal-host-2029/node_modules/@opencode/cli-linux-x64/bin/opencode bun scripts/metrics-server-live.ts
GUARD_DASHBOARD_HOST=1 GUARD_DASHBOARD_BUN=/tmp/guard-terminal-runtime/node_modules/@oven/bun-linux-x64/bin/bun bun scripts/dashboard-terminal-live.ts
GUARD_DASHBOARD_HOST=1 GUARD_DASHBOARD_BUN=/tmp/guard-terminal-runtime/node_modules/@oven/bun-linux-x64/bin/bun GUARD_DASHBOARD_BINARY=/tmp/guard-terminal-host-2029/node_modules/@opencode/cli-linux-x64/bin/opencode bun scripts/dashboard-terminal-live.ts
```

The paths describe this environment's available host/runtime installations. Host harnesses require loopback listeners and PTYs; sandbox listener failures were rerun with approval.

## Boundaries

These are synthetic-provider checks, not genuine-provider accounting/reclaim certification. Remote clients, other platforms, tmux/Neovim and long-running behavior remain outside this increment's evidence. Sidebar visibility/allocation remains host-controlled. Tiny viewports cannot show every explanation simultaneously; full diagnostics remain scrollable. No distribution boundary changed, so registry-dependent package installation validation was not required.
