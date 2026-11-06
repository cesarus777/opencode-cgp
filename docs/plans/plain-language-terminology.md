# Plain-language lifecycle and measurement labels

Date: 2026-11-06. Status: implemented; validation is recorded in the [delivery report](../validation/plain-language-terminology-2026-11-07.md). Covers UX-09 from the [TUI UX review](tui-ux-review.md), following delivered sidebar density (UX-07) and keyboard/help (UX-08).

## Recommendation

UX-09 follows delivered UX-01 through UX-08. The original recommendation was to finish primary vocabulary before changing chart failure/recovery behavior; UX-10 remains the next open item. This is a bounded presentation increment across the native sidebar, native panel, and standalone session dashboard.

Users should be able to explain where a context measurement came from, whether it is usable, and what a compaction state means without interpreting internal codes. Keep exact values in labeled diagnostics for troubleshooting. Preserve the compact layouts, threshold semantics, controls, and selected-session behavior already delivered.

## Investigation and baseline

These pre-implementation findings came from source and offline tests, not a new interactive host session or user study. The original investigation and implementation sequence below are retained as scope; delivered behavior and subsequent host evidence are recorded in the delivery report.

| Source                          | Current evidence                                                                                                                                                   | Implementation consequence                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `src/tui/panelformat.ts`        | `compactionLabel` already translates every non-idle phase and is shared across surfaces. `panelSummary` still prints raw confidence and freshness.                 | Refine the existing lifecycle helper and share measurement wording; avoid separate phase dictionaries per surface. |
| `src/tui/compactformat.ts`      | Summary prints `reported`/`approximate`; history says “muted held · last known context” and “┄ trigger.”                                                           | Use readable confidence and legends without adding default sidebar diagnostics.                                    |
| `src/tui/panelview.tsx`         | Context legend says “┄ trigger · muted held.” Details calls `detailLines(..., true)` and appends raw health reasons.                                               | Align legends; put readable explanations before labeled exact codes.                                               |
| `src/tui/format.ts`             | Details displays raw phase, `armed`/`disarmed`, scope and provenance. Performance uses TPS, TTFT and `partial`.                                                    | Separate explanation from diagnostics and explain performance terms in Details.                                    |
| `src/dashboard/terminalview.ts` | Overview already uses `compactionLabel`. Detail starts with a long diagnostic sentence, then lists every `snapshotFields` path.                                    | Lead Detail with a readable summary; retain complete diagnostics afterward.                                        |
| `src/types.ts`, `src/family.ts` | Confidence, provenance, scope, freshness and execution are distinct. Invalid freshness includes model mismatch or future timestamps.                               | Do not equate estimated with stale or infer a specific cause from invalid freshness.                               |
| `src/scheduler.ts`              | Acceptance precedes execution; ended precedes reclaim verification. Idle can be disarmed; blocked reclaim states can rearm after a sufficiently low fresh reading. | Avoid implying completion, guaranteed eligibility or permanent suppression.                                        |
| `src/tui/charts.tsx`            | All history errors suggest missing server capability; refresh resets the result.                                                                                   | Confirmed UX-10 gap; error classification, retention, polling and retry belong to a separate increment.            |

Call-site search found `rowLines` used only by tests; native rows use `panelRowLines`/compact formatters. Avoid treating the legacy helper as the primary UI or expanding this task into its cleanup. `detailLines`, `performanceLines` and `diagnosticRow` have production callers.

Baseline command:

```sh
bun test tests/panelformat.test.ts tests/statusformat.test.ts tests/sidebar.test.ts tests/tuirender.test.tsx tests/dashboardterminal.test.ts tests/charts.test.ts
```

Result: **39 tests passed, 0 failed, across six files**. This establishes the pre-change baseline, not acceptance of proposed copy. The working tree was clean before this planning change.

## Wording contract

Use short labels in summaries and full explanations in Details. Keep quantities, age, `~` estimates, textual exceptions and existing threshold labels. These examples specify meaning; verify their final wrapping before delivery.

| Data/state                   | Primary wording                                       | Explanation or diagnostic requirement                                                                                                                                                                    |
| ---------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reported measurement         | `Provider reported`                                   | Normalized provider usage. For `completed-request`, explain “Usage from the last completed request,” never the next request's size.                                                                      |
| Approximate measurement      | `Estimated`                                           | For `serialized-estimate`/`prepared-request`, explain “Estimate of the prepared request.” Retain `~` on quantities.                                                                                      |
| Fresh measurement            | `Measured Ns ago`                                     | Freshness does not guarantee exact current context or next-request size. Omit the raw “fresh” suffix.                                                                                                    |
| Stale measurement            | `Last measured …` / `Measurement out of date`         | Retain displayable occupancy and age; threshold pressure stays unknown.                                                                                                                                  |
| Missing measurement          | `Usage unknown`                                       | No measurement available; do not render zero.                                                                                                                                                            |
| Invalid measurement          | `Usage unavailable`                                   | “Measurement cannot be used for this session.” Retain the code without guessing model change or clock skew.                                                                                              |
| `requesting`                 | `Requesting compaction`                               | Acceptance has not been confirmed.                                                                                                                                                                       |
| `accepted`                   | `Compaction request accepted · waiting to start`      | Acceptance does not establish start or completion.                                                                                                                                                       |
| `running`                    | `Compaction running`                                  | Native execution has started.                                                                                                                                                                            |
| `awaiting-measurement`       | `Compaction ended · checking context reduction`       | Ended does not establish sufficient reclaim.                                                                                                                                                             |
| `blocked`                    | `Automatic compaction retry suppressed`               | Explain recognized blocked reasons in Details; do not imply native/manual compaction is disabled or suppression is permanent.                                                                            |
| `uncertain`                  | `Completion unconfirmed · automatic retry suppressed` | Refresh, reconnect or reload is not a promised resolution.                                                                                                                                               |
| `idle`                       | No lifecycle exception in summaries                   | Details: “No compaction request in progress.” Never translate as “succeeded” or “ready.”                                                                                                                 |
| Held chart value             | `Dim = last known context`                            | A retained chart level is not a new measurement. Use “┄ threshold” for the threshold guide.                                                                                                              |
| TPS / TTFT                   | Keep compact metric labels                            | Details: “TPS: tokens per second” and “TTFT: time to first output (text or reasoning).” Retain approximate timing/source qualifiers.                                                                     |
| Partial performance coverage | `Incomplete timing coverage` in explanation           | Model averages use matched observed durations; session averages include idle and tool time. Do not imply complete model timing or lifetime coverage. Retain exact `partial` diagnostics where available. |

Confidence and scope are independent: compose explanations from actual fields rather than assuming every reported value has completed-request scope. Present freshness separately. An invalid reading must not be described as usable simply because its stored confidence is `reported`.

Do not paraphrase `armed` as “automatic compaction enabled.” Global mode/health, phase, cooldown, failure limits, fresh pressure and session rearm state all constrain requests. Keep the exact boolean and explain it as one eligibility condition in Details; use existing `monitorStatusLines` for overall Guard behavior.

Translate only recognized reason codes established by current domain behavior. Unknown/open-ended policy, blocked and health reasons get a neutral “See diagnostic codes” fallback, with exact sanitized values in Details. Do not invent recovery instructions. Existing storage repair/reload and event-gap reload notices remain authoritative.

## Implementation sequence

1. Add renderer-free measurement confidence/scope/freshness helpers in `src/tui/statusformat.ts`, typed from existing scalar contracts. Keep `compactionLabel` in `panelformat.ts` as the shared lifecycle entry point. Avoid cycles through `format.ts`; use a small leaf wording module if needed. No SDK, renderer or policy-evaluation dependencies are required.
2. Apply shared wording to `panelSummary`, sidebar `mainSections` and row freshness exceptions. Keep identity, capacity occupancy, age, threshold distance and lifecycle consequences in their existing hierarchy. Wrap important exceptions or use concise complete variants rather than clipping away “waiting” or “unconfirmed.” Preserve the two-line emergency panel summary.
3. Align context-chart legends in `historySections` and `PanelDetails`. Change presentation only; preserve held geometry, capacity scale, samples, trace resets and collection while collapsed.
4. Organize native Details as readable measurement/state/performance explanations followed by labeled diagnostics. Preserve exact phase, armed state, confidence, scope, provenance, reasons, limits, cooldown and cumulative scope. Keep route-family statistics explicitly scoped as today.
5. Lead standalone `terminalDetail` with a concise readable summary. Keep full IDs, `diagnosticRow`, every `snapshotFields` path (including absent fields), Unix timestamp semantics and interruption information under diagnostics. Overview retains its row budgets and uses shared lifecycle/freshness wording.
6. Add the short performance glossary to native Details and standalone Detail. Keep chart metric labels/order/units, Models views and observation controls unchanged. Update README and relevant configuration descriptions after implementation.

The first reviewable implementation step is shared measurement wording and lifecycle refinements with focused semantic tests, wired into summaries. Follow with Details/legend integration and renderer/host fixture updates. Deliver the full sequence as UX-09; a helper-only change does not complete the user-facing recommendation.

## Acceptance and validation

| Area                  | Required evidence                                                                                                                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lifecycle             | Exercise all seven phases. Accepted says waiting; ended says checking reduction; uncertain preserves suppression. Idle is not a success/eligibility claim. Known blocked reasons and unknown fallback do not promise recovery.                                                       |
| Measurements          | Reported/estimated, completed/prepared request, fresh/stale/missing/invalid and absent snapshots remain distinct. Include invalid model/timestamp fixtures, stale estimates and alternate confidence/scope combinations. No unknown becomes zero or current pressure.                |
| Diagnostics           | Native Details retains exact phase, armed, confidence, scope, provenance and reason codes. Standalone retains every snapshot path and full identity. Unknown codes remain inspectable and sanitized; no raw exception/content logging.                                               |
| Geometry              | Render panel and standalone at 80×24, 40×20 and 20×12; sidebar at 39/35/20 outer columns. Include long CJK/emoji identities and exceptions. Preserve selection, controls, scrolling and sidebar density targets (≤28/34 lines at 39/35 columns). Record measured results separately. |
| Guard status          | Observe, enabled, suspended, disconnected, stale and unknown retain implications and remedies. Session armed wording cannot override overall Guard status.                                                                                                                           |
| Performance           | Explain TPS/TTFT and incomplete timing coverage without changing accounting, denominators, timing eligibility, estimates or unknown values.                                                                                                                                          |
| Interaction/resources | Preserve selection, route-family scope, help/back, disclosure, grouped attention rows, chart settings and cleanup. Formatting adds no reads, consumers, timers or retained data.                                                                                                     |

Extend existing formatter tests for semantic behavior and renderer fixtures for visible wording/reachability. Update `tests/fixtures/sidebar-host.tsx` accepted/ended assertions and `scripts/fixtures/metrics-tui.py`'s “muted held” wait when changing legends. Preserve chart-continuity assertions; replacing expected text must not remove held-value coverage. Prefer observable assertions over tests duplicating label dictionaries.

During implementation rerun the targeted baseline, then `bun run typecheck`, `bun test`, `bun run format:check`, `bun run build` and `git diff --check`.

After rebuilding, run the opt-in synthetic-provider native PTY harness on available OpenCode 2.0.29 and 2.1.2 hosts, expanding sidebar History before legend/continuity checks. Inspect summary/Details wrapping, child selection, help/back and chart transitions. Use the standalone terminal harness for changed Detail layout. Record unavailable runs as skips; synthetic usage does not certify genuine-provider accounting/reclaim. The initial documentation-only plan used formatting/diff checks; implementation results are recorded separately in the delivery report.

Write a separate validation report using the actual delivery date, then mark UX-09 delivered and link its evidence from the review.

## Scope and follow-up

No scheduler, policy, accounting, persistence, telemetry, transport, RPC/schema, public export, dependency, version or publication changes are needed. Use existing host APIs. Package-install checks are required only if distribution boundaries change.

UX-10 remains next: distinguish unsupported history capability from transient failures, preserve clearly marked stale results only for the matching query, and make retry accurate. It needs its own error/state investigation and cancellation tests; changing the generic error message alone would not complete it.
