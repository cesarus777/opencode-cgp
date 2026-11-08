# Dashboard performance investigation

Date: 2026-11-07. Status: historical baseline investigation. Steps 1–3 and 5 are now delivered; see the [implementation plan](dashboard-performance-implementation.md) and [2026-11-08 validation](../validation/dashboard-performance-2026-11-08.md). Findings below describe the pre-implementation code.

The reported symptom is slow opening of standalone **History / Models** in a directory with many sessions and statistics. Archive loading is the first optimization target. Separate session-discovery and Overview redraw costs also grow with session count.

## Reproduction and scope

Run the offline benchmark on the Bun runtime used for the standalone dashboard (Bun >=1.3.0):

```sh
bun run bench:dashboard
bun run bench:dashboard --requests
```

The benchmark creates and removes a temporary synthetic archive. It opens no real server, session database, user archive, credentials, or provider content. It measures application formatting, controller projection/selection, simulated discovery, the real filesystem archive reader, and the real Models service. It does not measure terminal painting, HTTP/RPC latency, public session-context restoration, or the user's actual directory.

The sample-only workload isolates scan overhead; it contains no completed-request identities. `--requests` uses distinct completed requests across 1,024 sessions and four models. Archive measurements are individual calls at each size, not statistical percentiles. Formatting/selection measurements use three warmups and 15 measured iterations. Compare runs on the same runtime and otherwise idle machine.

## Findings

### History reparses unrelated archive data

`src/historyserver.ts` calls `readPerformanceHistory` for every service read. `src/history.ts` lists/stats the archive, reads captured segment contents, splits lines, parses JSON, validates every record, and only then filters session/time. A short selected-session window can therefore scan up to the default 64 MiB even when it contains no matching records. Capping chart points at 500 bounds the response, not that scan.

The standalone controller's 16-entry History cache helps revisiting the same session/window. Its periodic refresh invalidates location entries every 30 seconds. First visits, changed windows, and refreshed queries still scan the archive. Multiple frontends contend with the History service's single `reading` slot.

History does not pass `context.signal` to `readPerformanceHistory`. Cancellation is checked after the scan, so an obsolete query can continue consuming CPU and keep the service busy. The scan's synchronous parse sections also delay other work on the server event loop.

### Models caches normalized facts briefly, then rescans

`src/modelanalyticsserver.ts` already coalesces archive reads, caches normalized request facts for 30 seconds, and retains two query snapshots for up to 90 seconds. Warm reads are cheap. After cache expiry, it rereads the whole bounded archive and reconciles request facts before filtering the requested completion range. Small displayed pages/windows do not bound first-load work.

`src/history.ts` yields through `setTimeout(0)` every 256 lines whenever a cancellation signal exists. Models supplies a signal; History currently does not. The scheduling cost is measurable separately from JSON parsing. Cancellation should be retained while moving to time-budgeted yielding or a worker.

On Bun 1.3.11 / AMD Ryzen 5 5500U, the sample-only baseline measured:

| Archive | History read, zero matches | Same read with cancellation checks | Cold Models | Warm Models |
| ------- | -------------------------- | ---------------------------------- | ----------- | ----------- |
| 4 MiB   | 70 ms                      | 133 ms                             | 149 ms      | <1 ms       |
| 16 MiB  | 242 ms                     | 518 ms                             | 566 ms      | <1 ms       |
| 64 MiB  | 923 ms                     | 2,072 ms                           | 2,419 ms    | <1 ms       |

The History scan delayed a 10 ms server-side timer by approximately 52–60 ms at its worst observed tick. These are synthetic local filesystem measurements; actual archive record shapes and request reconciliation add variability. They establish that scan cost alone can explain visible loading delay.

The completed-request run on the same runtime/machine measured:

| Archive | History read | Matching records | Cold Models | Warm Models | Aggregated requests |
| ------- | ------------ | ---------------- | ----------- | ----------- | ------------------- |
| 4 MiB   | 63 ms        | 8                | 147 ms      | 2.5 ms      | 7,616               |
| 16 MiB  | 222 ms       | 32               | 554 ms      | 11 ms       | 30,464              |
| 64 MiB  | 864 ms       | 128              | 2,234 ms    | 41 ms       | 100,000 (bounded)   |

All four models were returned. The largest workload exceeds Models' default 100,000 distinct-request budget; those totals are bounded and coverage is partial. Even the warm Models path grows with request count because it filters selected-model requests and rebuilds buckets on every read. A query/snapshot bucket cache can reduce that residual cost. These results use the actual reader/service, without HTTP, terminal rendering, or session restoration.

### Other session-count costs

`src/dashboard/terminal.ts` formats every Overview row and computes labels for the whole list before taking the visible slice. `overviewRowLines`, `clip`, and `cells` repeatedly perform grapheme segmentation. Each publication rebuilds the family and clones/freezes the full view in `src/dashboard/controller.ts`; age ticks publish once per second. Key handling can draw once through controller publication and again explicitly in `mountTerminal`.

The baseline's 1,024-session Overview formatting took approximately 107 ms median at 80×24 and 82 ms at 40×20, compared with 2.3/1.8 ms for 10 sessions. Controller selection/publication took approximately 19 ms at 1,024 sessions. These costs primarily explain Overview navigation lag, rather than first-load statistics latency.

`src/dashboard/inventory.ts` discovers roots and each node's children sequentially, including empty branches, with a 100-page budget. The controller commits the discovered list after the whole scan. A flat forest of 100 roots already needs 101 requests to prove completeness, exceeding the current default. At 1,024 roots, 11 pages fetch roots and the remaining 89 budgeted requests probe individual branches. At a hypothetical 50 ms/request, 100 serial requests consume about five seconds before processing overhead; this is a latency estimate, not a measured network result. The controller caps the scan at 15 seconds.

Snapshot RPC preparation in `src/adapter.ts` also serializes idle-session usage restoration with event handling. Each eligible session may read metadata and session context sequentially. `SnapshotClient` batches 128 IDs and allows two reads together, but server preparation uses a shared queue. This is a code-level startup/monitoring risk that needs actual-host timing before changing it. Preserving location authorization, stale/model/revert/compaction validation, and read-only restoration is mandatory.

## Recommended implementation order

1. **Make archive scans reusable and incremental.** Extract a location-owned bounded archive reader/cache for History and Models. Cache parsed immutable closed segments and update only newly appended bytes in the active segment, using captured size and file identity to detect replacement/truncation. Evict pruned segments and bound memory separately from the on-disk byte limit. Coalesce overlapping scans. Share normalized request facts with Models while retaining per-session History authorization and global gap records. Add valid per-segment session/time metadata so narrow queries can skip unrelated segments; filenames alone do not prove safe time bounds. Legacy archives need a bounded fallback. A cold process may still require one initial scan until an on-disk index is available.
2. **Make scans cancellable and responsive.** Pass the RPC abort signal through History. Yield against an elapsed-time budget rather than every 256 records, checking cancellation regularly. Measure both wall time and maximum event-loop delay. Consider a worker for parsing/reconciliation if time-budgeted scanning cannot keep the server responsive. One canceled consumer must not cancel a shared scan that still has other consumers.
3. **Keep Models facts current without rebuilding the archive.** Reconcile only new observations while preserving duplicate/conflict handling, historical model attribution, completion-time filtering, matched token/duration averages, quantiles, coverage and retention semantics. Cache query results by archive revision and query. Do not aggregate from downsampled chart points or only the currently visible sessions.
4. **Reduce independent UI/discovery work.** Cache row labels/layouts, format the visible window plus bounded overscan, coalesce publication/key redraws, and avoid copying unchanged snapshots on each tick. Publish discovery progressively and add modest bounded concurrency for independent child requests, keeping pagination order, cancellation, node/page/depth bounds and honest partial status. Treat idle usage restoration separately after actual-host timing; moving I/O outside the serialized event queue requires generation/state revalidation before committing results.

First delivery should combine reusable archive reads with cancellation/scheduling. This targets the user's History/Models symptom directly. The renderer and inventory work can follow independently.

## Acceptance checks for implementation

- Compare first and repeated History/Models opens at 4/16/64 MiB on the same runtime, with genuine completed-request records. Record scanned bytes, parsed records, latency, allocation/peak memory, and maximum event-loop delay.
- Repeated queries against unchanged closed segments must not reread/reparse them. Appending to the active segment should process only the new complete lines; malformed tails, replacement, truncation, rotation and pruning must invalidate affected state correctly.
- Verify rapid session/window/location changes, timeout/abort, concurrent History/Models consumers, shared-scan cancellation, service disposal and stale-result recovery. An obsolete request should release its work promptly.
- Match current raw-archive History results and Models statistics, including late observations, duplicate/conflicting requests, archived sessions, cross-segment reconciliation, gaps, coverage and partial-retention notices. Preserve the existing authorization/privacy contracts.
- Measure server event handling while scans run, not just terminal responsiveness. Cache/worker failures must not change compaction policy or enforcement.
- For later UI work, target sub-16 ms warm Overview formatting at 1,024 sessions and test identity, Unicode widths, paging, narrow/tall rows and exceptions. For discovery, verify usable early results without claiming complete inventory prematurely.

This investigation itself changed no production behavior. The later implementation delivers shared archive revisions, cooperative scans, Models reuse, bounded Overview formatting and progressive discovery; its [validation report](../validation/dashboard-performance-2026-11-08.md) records cold-start and responsiveness limitations. Sidebar restoration is included in 0.4.2.
