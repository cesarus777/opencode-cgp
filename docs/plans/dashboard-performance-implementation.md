# Dashboard performance implementation plan

Date: 2026-11-07. Status: steps 1–3 and 5 implemented; first-read alternatives measured under step 4. Validation and remaining cold-start limits are recorded in the delivery report.

Benchmark baseline committed first as `f2d444c` (`Add reproducible dashboard performance benchmark`). See the [investigation](dashboard-performance.md) and [benchmark instructions](../testing.md#dashboard-performance-benchmark).

## Objective and delivery boundary

Improve opening and revisiting standalone History / Models in directories with large archives. Deliver server archive/query work first, followed by independent Overview/discovery improvements. A first-ever read after server restart may still need one full scan; persistent indexing is a separate measured decision below.

Preserve public monitor/history/analytics RPC schemas, package exports, archive JSONL schema, CLI output semantics, model metadata, and compaction lifecycle/accounting. Cache failure must fall back to bounded reads or existing unavailable/stale presentation. It must never suspend/resume enforcement or fabricate current measurements.

## 1. Cancellation and scan scheduling

Suggested commit: `Make archive scans cancellable and responsive`.

Files: `src/history.ts`, `src/historyserver.ts`, `tests/history.test.ts`, `tests/historyserver.test.ts`.

- Pass History's RPC abort signal into the archive reader and combine it with a service-owned shutdown signal. Check cancellation before directory/file work, during parsing, and before publishing results. Release the busy slot in `finally` after abort/failure.
- Replace the fixed `setTimeout(0)` every 256 lines with elapsed-time budgeting. Start with a 4 ms parse slice, using a monotonic clock and an injectable yield function. Yield regardless of whether the caller supplied a signal; cancellation checks and cooperative scheduling are separate responsibilities. Keep parsing exceptions separate from abort/yield exceptions so cancellation cannot increment malformed-record counts.
- Stream captured file contents in bounded chunks rather than materializing `source.split("\n")`. Carry incomplete UTF-8/JSON lines across chunks. Preserve current final-tail behavior for both valid unterminated records and malformed tails. A subsequent append must replace/reparse that tail's contribution exactly once.
- Keep byte selection, ordering, filters, malformed counts and gaps identical. Read only each file's captured size; bytes appended later belong to the next revision. File handles, timers and waiters must close on every outcome.

Tests: pre-abort, abort during file/parse work, service disposal, retry after abort, malformed versus canceled records, UTF-8 boundaries, valid/invalid unterminated tails, from/to boundaries, no-signal scheduling, and failure cleanup. Use injected clocks/yield hooks and filesystem ports for deterministic tests; real-time thresholds belong in the benchmark.

## 2. Shared bounded archive reader

Suggested commits: `Add a revisioned archive reader` and `Share archive reads between History and Models`.

Files: new `src/archive.ts` and `tests/archive.test.ts`; `src/history.ts`, `src/historyserver.ts`, `src/modelanalyticsserver.ts`, `src/adapter.ts`, and related service/adapter tests.

### Ownership and API

Create one `PerformanceArchive` per plugin instance and server-owned location/path in adapter setup. Pass it to both services through internal dependency injection. Dispose services before disposing the shared reader. Disabled history must perform no archive filesystem work. Avoid a process-global cache or client-provided filesystem paths.

The reader returns an immutable internal snapshot containing the existing records/metadata plus an opaque archive revision. Keep `readPerformanceHistory` available for one-shot CLI callers and as the differential reference during migration. Existing test reader injection remains supported; no new public RPC field is required.

### Revisions, appends and invalidation

- Build a canonical segment manifest with filename ordering, file identity, size and change timestamps. Open/fstat before reuse/read so replacement races cannot substitute another file. Revalidate captured identity and size before committing a scan; abandon/retry an unstable revision within a bounded retry budget. Surface continuing failure through existing service errors.
- Reuse unchanged segment entries. For append-only growth, read from the previous complete-line boundary and replace the old tail contribution. Bound tail storage. Reparse a changed segment when append-only growth cannot be established.
- Invalidate affected entries on replacement, same-size rewrite, shrink, deletion, rotation and pruning. A metadata change must invalidate the archive revision even if no request facts changed, because retention/malformed/gap metadata may have changed.
- Preserve the existing greedy newest-first byte selection, followed by chronological traversal. `retainedBytes` includes the whole manifest; `skippedBytes` includes unselected files. Preserve `retainedFrom`, malformed-record totals and gaps even when a session query skips irrelevant records.
- File metadata is a validation aid, not a proof against arbitrary external rewrites with restored timestamps. Use writer notifications for in-process append/prune invalidation and test replacement/rewrite detection. Document the filesystem assumption; external writers with unobservable mutations require a forced rebuild.

### Query indexes and budgets

Keep per-segment session offsets and validated time bounds from parsed records, plus global gap offsets and malformed counts. Index the fields used by History filters. Never infer record time bounds solely from filenames. Build normalized Models facts from all eligible request observations before applying completion-time query filters.

Start with internal limits of 64 MiB accounted encoded cache data, 100,000 decoded records and 256 segment entries. Evict least-recently-used decoded entries when any limit is reached; retain only bounded index data. If a query exceeds the cache working set, stream/reparse evicted data under the existing byte budget. Cache eviction must affect speed only, never totals or completeness. Account indexes, tails and in-flight snapshots separately and measure peak heap/RSS; encoded-byte accounting is not an exact JavaScript heap ceiling. Tune the initial limits against the benchmark before shipping.

Coalesce overlapping scans of the same manifest revision. Each consumer owns an abort waiter. Canceling one waiter must leave other readers running; cancel the underlying job when the last waiter leaves or the owner disposes. Never expose a partially populated snapshot. Bound retained revisions and concurrent jobs so canceled or slow clients cannot retain unlimited archive copies.

### History authorization and service concurrency

Authorize each History session against the owning location before consulting cached data, including cache hits. Preserve global history gaps and unknown/empty-session behavior. Retain the existing single History-query admission guard initially; shared scans between History and Models provide reuse without introducing an unbounded query queue. If later allowing concurrent History queries, impose an explicit small limit and independent cancellation.

Tests: unchanged reuse with zero additional file reads/JSON parses; shared History/Models reads; suffix-only append; split/previously malformed tails; multiple segment changes; reordered/late timestamps; replacement/shrink/same-size rewrite; rotation/pruning; byte-budget selection; cache eviction and forced rebuild; disabled/no-RPC setup; one/all waiter cancellation; disposal during scan; location authorization on hits; immutable snapshot isolation; bounded retry and failure recovery. Compare complete record/metadata results with the one-shot reader across generated mutation sequences.

## 3. Models reuse by archive revision

Suggested commits: `Cache Models queries by archive revision` and `Incrementally reconcile appended request facts`.

Files: `src/modelanalyticsserver.ts`, `src/modelanalytics.ts`, `src/modelseries.ts`, their tests, and `scripts/dashboard-bench.ts`.

First remove avoidable query work while retaining the existing pure reconciliation algorithm:

- Key normalized facts by archive revision. An unchanged archive may reuse facts beyond the current 30-second scan TTL after manifest validation. A changed archive invalidates facts; the first implementation may rebuild them from cached records without filesystem reparse.
- Keep the existing maximum of two query snapshots and 90-second cursor lifetime. Cache sorted models, selected-model request lists and buckets inside each snapshot with bounded LRU entries, initially eight bucket variants per snapshot. Bind buckets to selected model and resolution; request pagination should reuse them. Preserve sort/cursor/query validation and response copies so consumers cannot mutate cached state.
- Keep old snapshots immutable until their existing expiry, allowing pagination to finish against the original facts while new reads use the new revision. Location, agent, range, model, resolution and revision must be represented in the appropriate cache keys; UI metric/bucket navigation stays local.

Then introduce incremental reconciliation only after differential tests establish equivalence:

- Extract an accumulator shared with the pure aggregator. Use the existing identity `(location, sessionId, requestId, startedAt)` and preserve complementary observations, conflicts, partial/legacy attribution and eligibility counts.
- Apply suffix observations incrementally only when segment traversal order and the processed prefix are unchanged. Rebuild from cached canonical records on pruning, replacement, inserted earlier segments or a changed cutoff. Do not simply subtract summaries or average averages; request contributions and TTFT distributions must remain exact.
- Preserve the 100,000 distinct-request processing boundary, including its order-dependent stop position, duplicate handling, `scannedRecords`, `unscannedRecords` and partial coverage. Later observations beyond that stop cannot silently alter accepted facts. Fall back to canonical reconciliation whenever an incremental update cannot prove equivalence.
- Keep History observation-time filtering separate from Models completion-time filtering. Cross-segment facts may start outside the requested range and complete inside it.

Tests: raw-archive equivalence for every public metric/coverage field; late complementary observations, conflicts, pruning and partial tails; exactly/below/above the request cap; completion boundaries; archived sessions; independent TPS/TTFT eligibility; cached sort/model/bucket/page variants; snapshot expiration; refresh failures retaining matching results; returned-object mutation; cancellation during normalization. Existing tests in `modelanalytics`, `modelseries`, `modelanalyticsserver` and `dashboardmodels` remain required.

## 4. First-read optimization decision

After steps 1–3, rerun both workloads and the actual-host History/Models workflow. A warm in-process cache benefits subsequent dashboard opens while the server remains alive. Record cold process-start latency separately.

If the first-ever 64 MiB statistics read still exceeds one second or event-loop delay remains above the target below, compare two bounded prototypes:

- A worker for parsing/reconciliation, keeping SDK calls and enforcement on their current owner. Include transfer/copy cost, cancellation, worker failure, runtime/package loading and memory in the comparison.
- A versioned, optional on-disk segment index containing only approved scalar offsets/time/session/request metadata. Validate it against captured file identity/size and a content integrity check. Use atomic replacement and existing restrictive file permissions; corrupted, missing or legacy indexes fall back to scans. Cap and prune index storage with its archive. Do not include raw lines or content, and do not trust an index to bypass session authorization.

Select the smallest option that meets measured first-read and responsiveness goals. This is a separate delivery with format/storage and distribution review, not a prerequisite for the first shared-cache improvement. Increasing TTL or silently reducing retention/request coverage is not the proposed solution.

## 5. Independent Overview and discovery work

Suggested commits: `Bound dashboard Overview formatting to its viewport` and `Publish progressive dashboard discovery`.

Proceed after the History/Models delivery:

- Cache identity labels and row layouts with bounded invalidation by row data, width and exception state. Keep a lightweight row-height index for viewport/paging and format visible rows plus bounded overscan. Preserve selected-ID reveal, Unicode widths, labels, tall exceptions, filters and narrow fallbacks.
- Coalesce controller-publication/key/resize drawing so one input does not immediately format the same frame twice. Reuse frozen unchanged subtrees rather than cloning every snapshot each age tick; keep subscriber immutability and isolate frontend failures.
- Discover independent child branches with an initial concurrency cap of four, while keeping cursor chains sequential and page reservations within the global budget. Commit results in deterministic traversal order. Publish coalesced partial progress; selecting a discovered ID should not wait for the final scan. Carry explicit discovery completeness and bounds through refresh/removal handling.
- Keep idle-session usage restoration out of this change until an actual-host timing trace quantifies its queue cost. A later change can fetch outside the adapter queue only with generation/model/revert/compaction revalidation before committing scalar usage. Reads must remain unable to evaluate policy or admit work.

Tests: viewport work bounded by visible rows/overscan; selected identity and page movement across updates/resize; exception height changes; Unicode/repeated names; one draw per coalesced update; immutable subscriptions; concurrency/page/depth/node bounds; deterministic hierarchy; partial progress, duplicate cursors, cancellation and old-location responses; correct removal only after trustworthy discovery.

## Validation and release gates

1. Before each performance comparison, run appropriate offline tests and typecheck separately from benchmarks. Extend the benchmark with archive read/parse counters, unchanged/repeated History opens, append/prune refreshes, mixed concurrent consumers, cancellation latency, Models bucket reuse, and peak heap/RSS. Keep metrics internal to the benchmark/test ports; no RPC or telemetry expansion is needed.
2. Run `bun run bench:dashboard` and `bun run bench:dashboard --requests` sequentially on the same Bun >=1.3.0 runtime and machine as the baseline. Record both first and repeated measurements; use several process runs for timing summaries. Keep deterministic work-count assertions in tests and timing targets in the validation report.
3. Initial performance targets: unchanged cache-resident segments incur zero extra reads/parses; append processes only newly completed lines plus the prior tail; warm 64 MiB History/Models queries target p95 <100 ms when their working sets fit the declared cache budget; parsing targets maximum event-loop delay <20 ms and abort settlement <100 ms on the benchmark machine. Measure cache-overflow cases explicitly. Treat these as release-review targets to verify, not current guarantees.
4. For later UI work, target p95 <16 ms for a warm 1,024-session 80×24 Overview frame. For discovery, verify a usable partial list after the first root page, with honest partial state and bounded request concurrency.
5. Run the full offline suite, formatting, typecheck and build. Run `test:package` if a worker, distribution boundary, new export or dependency changes. Run the isolated standalone PTY workflow on supported OpenCode 2.0.29 and 2.1.2, including History/Models refresh, rapid switches, shutdown, continued native-client operation and scalar privacy canaries. No genuine-provider or remote/platform claims follow from synthetic runs.
6. Update architecture/testing/configuration documentation for delivered behavior, publish a dated before/after validation report, and link each completed increment from this plan. Mark delivery complete only after correctness, resource bounds and performance evidence are recorded.

The original implementation order was step 1 followed by step 2, then steps 3–5. The delivery record below identifies the completed increments and remaining first-read work.

## Delivery record (2026-11-08)

See [dashboard performance validation](../validation/dashboard-performance-2026-11-08.md) for commands, deterministic work counts, repeated before/after measurements, resource observations and host results.

- Step 1: History caller/shutdown cancellation, captured-size streaming, UTF-8/tail handling and 4 ms cooperative scheduling are implemented and tested.
- Step 2: one adapter-owned revisioned reader is shared by History and Models. It validates manifests, reuses decoded segments, handles notified suffix appends, bounds the LRU, preserves authorization/metadata and supports independent cancellation. The decoded-record budget was tuned to 200,000 after measuring overflow at the proposed 100,000.
- Step 3: revision-keyed facts, bounded sort/bucket variants and canonical-prefix incremental reconciliation are implemented. Large normalization/selection work cooperates with cancellation; uncertain or evicted prefixes rebuild canonically. Existing request-accounting and cursor bounds are retained.
- Step 4: both bounded, synthetic-only worker and integrity-checked scalar index prototypes are included in the benchmark. Neither installs a runtime worker or persistent production index. First-read latency remains a separate delivery: the worker includes full fact transfer; the index includes full-source integrity verification and JSON decode, but still needs the format/storage/distribution review and recovery implementation described above. Warm-cache improvements do not imply a sub-second first read after restart.
- Step 5: bounded Overview labels/layouts, viewport formatting, immutable snapshot reuse, draw coalescing and progressive four-request discovery are implemented. Idle usage restoration is unchanged.

The first shared-cache/UI delivery is implemented. The wider cold-process first-read optimization is not marked complete; its prototype measurements and release-review limits are explicit in the report.
