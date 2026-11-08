# Dashboard performance validation — 2026-11-08

Runtime: Bun 1.3.11. CPU: AMD Ryzen 5 5500U with Radeon Graphics. Baseline: `f2d444c` in an isolated checkout with the same dependencies. Both workloads ran sequentially, in three independent processes before and after, separately from builds/tests. Invalid early runs that launched system Bun 1.1.34 were discarded. Filesystem caches were warm; these are process-cold scans, not cold-disk measurements.

The shared-cache/Overview/discovery delivery is implemented. The broader first-read optimization remains open: cold reads became more responsive but did not become faster. The initial 20 ms server-delay target is not met by every Models projection. No production worker, persistent index, new RPC field, archive schema or package export was introduced. Existing uncommitted sidebar restoration work is preserved.

## Measured archive behavior

Values below are medians of three process observations, in milliseconds. Warm History is the median of each process’s five-repeat p95; five observations are a small latency sample. Models “first” after the change includes shared reader initialization **plus** query construction, even though the benchmark opens History first. Models “warm” includes manifest validation and cached query/bucket reuse. Baseline Models warm uses its old TTL without filesystem validation.

### Sample-only scan workload

| MiB | Before History | After History cold | After History warm | Before Models first | After Models first | Before Models warm | After Models warm |
| --- | -------------: | -----------------: | -----------------: | ------------------: | -----------------: | -----------------: | ----------------: |
| 4   |           67.7 |              138.8 |               0.89 |               121.4 |              164.3 |               0.12 |              2.74 |
| 16  |          232.2 |              542.4 |               2.10 |               481.7 |              611.0 |               0.06 |              2.85 |
| 64  |          925.4 |             2222.0 |               2.41 |              2089.2 |             2306.3 |               0.11 |              4.56 |

### Completed-request workload

| MiB | Before History | After History cold | After History warm | Before Models first | After Models first | Before Models warm | After Models warm |
| --- | -------------: | -----------------: | -----------------: | ------------------: | -----------------: | -----------------: | ----------------: |
| 4   |           62.3 |              138.8 |               0.83 |               130.7 |              221.7 |               2.65 |              3.18 |
| 16  |          217.2 |              496.0 |               1.10 |               528.4 |              820.7 |              11.40 |              4.54 |
| 64  |          882.3 |             1979.9 |               4.25 |              2112.3 |             2966.4 |              32.56 |              6.26 |

Every unchanged-cache repeat had **zero additional bytes read and zero additional records parsed**, including 64 MiB. The completed-request workloads retained four models and exactly matched baseline request totals and every coverage field. The largest archive still stops at 100,000 distinct requests and reports its unscanned observations; coverage was not reduced to improve timing.

Coalesced mixed consumers read the 4 MiB segment once. A notified append read exactly **396 bytes and one new record**; pruning returned zero retained bytes and records. Abort settlement ranged from 0.25 to 1.16 ms. Counters measure file bytes/JSON parses, not JavaScript allocation counts. Appends still copy/reindex the affected decoded segment; they do not reparse its complete prefix.

## Responsiveness, Overview and resources

| Probe                                             |   Before |    After |
| ------------------------------------------------- | -------: | -------: |
| 64 MiB one-shot History max timer delay, median   |  50.1 ms |   1.9 ms |
| 1,024 rows, 80×24 frame p95, median               |  97.9 ms |   5.2 ms |
| 1,024 rows, controller selection p95, median      |  21.1 ms |   7.8 ms |
| 1,024 roots, simulated 100-page discovery, median | 242.7 ms | 106.4 ms |

Shared archive scans observed at most 9.9 ms timer delay. Models cold projections observed up to 54.4 ms, including allocation/GC and remaining synchronous grouping/copying work. The 20 ms target therefore remains a release-review limitation; neither parse slicing nor a worker alone proves a bound on all server work. One-shot scan wall time also increased because scheduling is now enabled without a signal.

Production-path RSS observations in the benchmark ranged from 117 to 286 MiB. These are process samples, not isolated cache allocations or a hard heap ceiling. The report retains heap/external/array-buffer observations. Overall max RSS includes the optional first-read prototypes and ranged from 399 to 592 MiB.

The initial 100,000 decoded-record cache thrashed on 169,456 sample observations at 64 MiB. The tuned limit is 200,000 records, alongside 64 MiB accounted encoded source and 256 segments. Index references, tail boundaries, in-flight snapshots, up to 100,000 normalized request facts, two query snapshots and eight bucket variants per snapshot have separate bounded lifetimes. A forced tiny-cache test verifies equivalence under eviction. Memory accounting remains approximate; smaller records can exceed the working set and trigger bounded reparsing.

Discovery still reports a partial inventory at the existing page/node limits. Concurrency improves latency; it does not manufacture completeness. Root progress arrives before child completion, with at most four branch requests and deterministic commits. Viewport tests format fewer than 24 rows for a 1,024-row frame, reuse unchanged layouts, preserve selected identity, and verify a single coalesced draw.

## First-read decision

| 64 MiB prototype | Samples latency / timer delay | Requests latency / timer delay |
| ---------------- | ----------------------------: | -----------------------------: |
| worker           |                   1106 / 9 ms |                   1590 / 69 ms |
| index            |                   215 / 83 ms |                   318 / 177 ms |

The worker includes startup, full bounded parsing/reconciliation and full fact transfer back to the parent. Request-heavy transfer still stalls the parent; its latency also exceeds one second. The index includes a SHA-256 pass over all source bytes plus JSON decoding of approved scalar offsets/facts; its JSON decoding stalls the parent. Index sizes were 16.0 MiB (samples) and 34.2 MiB (requests); index construction took roughly 2.4–2.8 seconds and is reported separately. Prototype memory includes temporary construction objects.

Decision: ship the in-process cache and cooperative reader; retain both prototypes as benchmark-only evidence. Neither prototype satisfies both first-read and responsiveness targets, so neither should become a production format/runtime dependency in this increment. A follow-up needs a compact indexed representation with chunked/off-thread decode and bounded fact transfer, plus schema validation, atomic updates, corruption recovery, restrictive permissions, pruning and packed-worker loading tests. No persistence/configuration/distribution contract is silently added. Actual-host checks below use small synthetic archives; no large real-directory trace was available, so the investigation’s real-directory first-read workflow remains unverified.

## Correctness and validation

The offline suite covers captured-size reads, notified append growth during a scan without retry starvation, forced rebuilds during a scan, inclusive History boundaries, UTF-8 chunk splits, valid/malformed tails, append replacement, global gaps, authorization on cache hits, immutable snapshots, replacement/shrink/rewrite/rotation/pruning, byte-budget selection, eviction, bounded unstable-manifest retries, one/all-consumer cancellation, shutdown and retry. History/Models integration verifies one shared scan. Reconciliation tests compare complete outputs after each suffix, including complements, conflicts and request-cap stop positions. Query tests cover revision reuse beyond TTL, old-snapshot stability, expiration timestamp renewal and returned-bucket mutation. Existing privacy/accounting/compaction tests remain required and pass.

- `bun run typecheck`: pass.
- `bun test`: 250 pass, 0 fail (33 files).
- `bun run format` and `bun run format:check`: pass.
- `bun run build`: pass.
- `GUARD_PACKAGE_HOST=1 GUARD_DASHBOARD_BUN=... bun run test:package`: pass (65 allowlisted files, clean install, all exports, 16 behavioral tests, standalone renderer/preflight, native TUI and consumer declarations). Packed monitor/History and location-isolated analytics over 600 archived sessions passed on the actual host in observe and enforce modes. The optional packed-host interactive PTY was explicitly skipped; built-checkout PTYs are separate below. Registry DNS failed in the sandbox and the check passed after retrying with registry access.
- Isolated standalone PTY on OpenCode 2.1.2: final built smoke passed, including History missing capability/transient failure/timeout/retry, Models/raw-archive statistics, navigation, all metrics/windows, root/concurrent children, resize, restart, native-client survival, privacy canaries and terminal restoration.
- Isolated standalone PTY on OpenCode 2.0.29: final built smoke passed with the same History/Models, recovery, restart, privacy and native-client/terminal cleanup checks.

The test/benchmark runtime was selected with `/tmp/guard-terminal-runtime/node_modules/@oven/bun-linux-x64/bin` prepended to `PATH`; merely invoking that Bun executable before `run` lets the package script launch the system Bun. PTY checks additionally set `GUARD_DASHBOARD_BUN` explicitly. Sandbox loopback restrictions required an escalated host run; the first sandboxed listen failure was not a pass.

Raw observations: [before/after JSON](dashboard-performance-2026-11-08.json). Reproduction: `bun run bench:dashboard`, then `bun run bench:dashboard --requests`, sequentially. Live smoke: `GUARD_DASHBOARD_HOST=1 GUARD_DASHBOARD_BUN=/tmp/guard-terminal-runtime/node_modules/@oven/bun-linux-x64/bin/bun bun run test:dashboard-terminal`; set `GUARD_DASHBOARD_BINARY=/tmp/guard-terminal-host-2029/node_modules/@opencode/cli-linux-x64/bin/opencode` for 2.0.29. Synthetic host/provider checks do not certify genuine-provider accounting, remote transport, other platforms or long-running memory behavior.
