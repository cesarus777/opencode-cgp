# Budget Controller extension

`BudgetController.evaluate(BudgetInput): BudgetAction` and `NoopBudgetController` live in `src/types.ts`. The monitor accepts an injected controller. Today it records non-continue actions as advisory telemetry; only context policies execute compaction. No checkpoint, rotation, stop, or lifecycle side effect exists.

Inputs include session role/hierarchy, current context, cumulative input/output/reasoning/cache counters, observed model/tool calls, elapsed monitor time, and optional depth/inherited token budget. Undefined depth/budget means unknown, not zero. A future controller must add authoritative execution start/depth/inheritance collection and persisted counters before enforcing lifetime budgets; current request/tool counters and elapsed time cover monitor residency.

Actions are `continue`, `warn`, `compact`, `checkpoint`, `rotate`, and `stop` (all but continue include a reason). To extend:

1. Add a separately validated budget configuration; resolve inherited limits at child admission, preserving explicit role overrides.
2. Supply reliable cumulative accounting and lifecycle clocks through the monitor/adapter. Missing metrics should produce an explicit degraded decision.
3. Route both threshold-derived `compact` and controller-derived `compact` through the existing CompactionScheduler. Keep admission/deduplication and completion tracking there.
4. Introduce a capability-aware action executor for other actions only when a harness exposes safe public APIs. Checkpointing or rotation must not be disguised as compaction.
5. Test budget sharing among concurrent siblings and persistence across restarts before enabling it.

A Codex or other harness adapter can reuse Config/PolicyResolver/ThresholdEvaluator, ContextUsageProvider, CompactionScheduler and the budget interfaces. It must accurately declare its own compaction and interruption semantics; OpenCode guarantees do not transfer automatically.

The TUI's `ContextSnapshot` is a read-only projection of existing measurements and scheduler state, exported with `SnapshotStore` and family calculations from `./core`. RPC reads and presentation freshness checks do not call a budget controller or execute actions. New budget UI fields should extend a versioned, validated scalar contract and retain separate cumulative versus per-request scope. Never infer inherited budgets, successful execution, or enforcement permission from a rendered row or a reconnected UI.
