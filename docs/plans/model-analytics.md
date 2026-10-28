# Model analytics in the standalone dashboard

Status: stage 1 implemented and validated in the working tree. Stages 2–4 remain planned.

## Goal and scope

Add a Models screen to `context-guard dashboard tui` that compares models across root and child sessions in the selected OpenCode location. Selecting a model shows request-level evidence, aggregate TPS and TTFT distributions for a selected time range. Keep the sidebar context trace bounded and independent.

Deliver retained-history analytics first, then optional durable request storage. The first milestone must say “retained history,” never “all time.” Browser UI and aggregation across locations are separate work.

## Current constraints

- `src/history.ts` retains scalar performance records in rotating JSONL segments. Defaults are seven days and 64 MiB; its reader also limits scanned bytes to 64 MiB.
- `context-guard.history.v1` reads one authorized session at a time, permits at most seven days and caps chart points and requests at 500. Chart output is unsuitable as the input for complete model aggregates.
- `src/dashboard/view.ts` already computes matched-request TPS for one selected session. Session discovery is bounded and cannot identify every archived session.
- Request snapshots contain request identity, model attribution, timing, tokens and provenance. Session cumulative totals and sampled averages must not be summed as request data.

## Metric contract

Implement harness-independent request normalization and aggregation modules, exported through `src/core.ts`, shared by the server and CLI.

- Identify requests by owning location, session ID, request ID and request start timestamp. Deduplicate repeated archive records deterministically; conflicting observations produce a coverage warning rather than two requests.
- Attribute by request model, with record model as a documented legacy fallback. Preserve full provider/model identity. Never substitute the session's current model for a historical request. Keep unknown attribution separate.
- Select requests by completion timestamp in a half-open `[from, to)` interval. In-flight and requests without confirmed stream completion do not enter completed-request aggregates. Audit existing request-record emission before relying on record type alone.
- Average request TPS is `sum(matched output + reasoning tokens) / sum(matched request duration in seconds)`. Request duration runs from request start to stream completion and includes TTFT. Concurrent request durations are summed; this measures request performance, not aggregate system throughput.
- TTFT mean, median and p95 use available nonnegative request TTFT values. Document nearest-rank p95 and midpoint median for even counts. TTFT retains its observed/approximate timing label. Unknown TTFT is excluded, never replaced by zero.
- Show separate denominators: observed completed requests, TPS-eligible requests, TTFT-eligible requests, sessions, partial requests and excluded requests by reason. Token provenance stays explicit; estimated tokens must not silently mix with reported-token TPS. A partial session does not automatically invalidate every fully matched request.
- Return absent metrics for empty eligible sets. Show requested range, available coverage, gaps, malformed records, scan limits and retention truncation alongside results. Retained boundaries alone cannot establish gap-free coverage.

## Stage 1 — Shared aggregation and offline CLI

1. Audit completion, retries, missing usage, token provenance and model changes in existing archive emission. Add only allowlisted scalar fields if a required distinction cannot be recovered; keep schema-1 files readable and label legacy uncertainty.
2. Add normalized completed-request extraction and deterministic model summaries. Scan raw archive records before chart downsampling, session limits or request slicing. Bound memory/work and explicitly report incomplete scans.
3. Add `inspect models /absolute/history-directory` with `--model`, `--agent`, `--from`, `--to`, JSON and CSV output. Define exact field names and units once for CLI and RPC consumers.
4. Test hand-calculated weighted TPS and TTFT statistics, duplicate records, retries, model switches, concurrent children, missing/zero usage, tool-only requests, partial observations, restart gaps and time-boundary selection.

Acceptance: more than 500 requests across more than the current inventory's sessions produce the expected aggregates when within scan limits. Changing chart resolution cannot change these aggregates.

## Stage 2 — Location-scoped analytics service

1. Add a separate read-only, versioned analytics RPC; preserve monitor and history-v1 contracts. Verify registration and location-routing against installed public V2 declarations before integration changes.
2. Provide model summaries and paginated request details for an explicit range/filter. Aggregate before response pagination. Define bounded ranges, response sizes, scan budgets, stable ordering and snapshot/cursor semantics so refreshes cannot duplicate or skip detail rows unnoticed.
3. Query the owning location's archive directly, including records for inactive sessions absent from live inventory. Establish location authorization through the RPC context and server-owned archive, rather than removing the existing per-session authorization check.
4. Never accept a filesystem path from remote callers. Validate every input/output and project only approved scalar fields.
5. Serialize or bound archive reads, cancel obsolete work, cache by location/filter/range/archive revision and invalidate on writes or pruning. Separate unsupported, disabled, unavailable, empty, partial and stale results.

Acceptance: another location's records cannot be accessed, reconnects do not multiply subscriptions, and older servers retain existing dashboard functionality with Models marked unavailable.

## Stage 3 — Shared controller and terminal Models screen

1. Extend `DashboardPort`, controller state and immutable view model with analytics capability, filters, cached summaries and selected-model details. Reuse the existing authenticated connection.
2. Add Models navigation with 5-minute, 1-hour, 24-hour and 7-day presets and an explicit date-range selector within service bounds. Location, model and agent filters apply consistently to totals and details.
3. Show a sortable table: full model identity, sessions, eligible request count, weighted TPS, TTFT mean/median/p95 and coverage. Preserve full identities in details when narrow rows truncate them. Sort unknown values consistently.
4. Selecting a model opens coverage, metric definitions and paginated completed-request details. Keep historical analytics usable without a live selected session. Do not label session-average TPS as a model aggregate.
5. Load on entry/filter changes and explicit refresh; coalesce requests and cancel obsolete ones. Preserve previous results as stale during refresh/failure. Cursor movement and table sorting must not trigger archive scans.

Acceptance: models used by multiple concurrent children and historical sessions appear correctly; unknown/partial values remain visible; resizing, location changes, restart recovery and terminal cleanup work through the existing shell.

## Stage 4 — Optional durable request analytics

Retained JSONL analysis does not provide permanent history. Add an opt-in server-side request ledger after the first three stages, with a documented embedded-store choice compatible with the server's Bun >=1.1.34 runtime and package constraints. Validate that choice in an isolated storage spike before adding a dependency.

- Store normalized scalar request facts, provenance, observation gaps and schema metadata under a location-scoped directory. Use the request identity as a uniqueness key; support atomic corrections and restart recovery.
- Feed it from observed request completion independently of JSONL retention and whether a dashboard is open. Keep collection asynchronous and bounded; failures surface coverage warnings without blocking native workflows or compaction.
- Support explicit retention configuration, including an opt-in no-age-pruning mode, backup/export and storage-size visibility. A configured byte cap must report pruning; “permanent” requires no automatic pruning and still depends on available disk and backups.
- Backfill only retained records with idempotent import; record the earliest imported coverage and unavailable earlier history. Never imply pre-installation reconstruction.
- Index by completion time and provider/model; query all retained requests without the chart reader's 64 MiB cap. Compute aggregates before detail pagination; document exact percentile cost and impose visible query budgets.
- Add longer ranges and an “all stored” option only when supported. This ledger preserves request facts for TPS/TTFT analysis; permanently retaining every live sample or context measurement is an additional storage feature, not implied here.

Acceptance: a request is counted once across restart, replay and backfill; JSONL pruning does not remove ledger facts; disk-full and corrupt-record handling remain explicit; old-range queries expose their actual coverage.

## Validation and documentation

Run formatting, typecheck and offline tests for each stage. Add native terminal tests for navigation, narrow layouts, missing capability and refresh cancellation. For integration milestones, run package smoke and authenticated synthetic-provider checks on OpenCode 2.0.29 and 2.1.2, including >500 requests, historical sessions, model changes, restart and location isolation. Run privacy canaries through RPC payloads, exports and terminal captures. Report live skips separately; synthetic results do not certify real-provider timing.

Update configuration, architecture, compatibility and testing documentation with metric definitions, retention/coverage limits, RPC compatibility and reproducible commands. Validate disabled analytics and renderer-free existing consumers. No commit, publication or version bump is part of this plan.

## Stage 1 delivery record — 2026-10-28

Implemented `aggregateModels` in the harness-independent core and `inspect models` / installed `context-guard models` JSON/CSV exports. Existing schema-1 request records supply timing, tokens and attribution; no collection, RPC or retention changes were needed. Request records can follow failed steps, so eligibility requires an observed stream end rather than assuming that a request record proves completion. Exports document that stream completion is not task success.

Validation: formatting, strict typecheck, build, offline suite and clean-package smoke pass. The analytics tests cover hand-calculated statistics, more than 500 requests and 128 sessions, conflicts/replays, completion ranges, partial/missing facts and scalar-only projection. The installed command and new core export pass without renderer peers. Installed live dashboard PTYs were explicitly skipped without opt-in; no analytics server/TUI integration or real-provider timing is claimed.
