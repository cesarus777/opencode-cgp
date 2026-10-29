# Aggregate model charts in the terminal dashboard

Status: phases 1–4 implemented and locally validated in the working tree; see the [delivery record](../validation/model-analytics-tui-2026-10-29.md). Extends stages 2–3 of [model analytics](model-analytics.md); the offline aggregator and CLI already ship in 0.3.0 and later.

## User workflow

1. Run `context-guard dashboard tui` in a separate terminal while working in OpenCode.
2. Press **4** to open **Models**, listing all models observed in the owning location's retained archive. A selected live session is unnecessary.
3. Select a model with **Up/Down** or **j/k** and press **Enter** for its aggregate chart and statistics.
4. Use **Left/Right** to select a metric, **w** for 5m/1h/24h/7d, **f** for an exact agent filter, **[ / ]** to inspect a time bucket, and **r** to refresh. **Escape** returns to the model list.

The model list shows full provider/model identity, sessions, completed requests, weighted request TPS, TTFT median/p95 and coverage. Details show the full identity, selected range, combined statistics, chart, selected-bucket values and request eligibility counts. Long identities and statistics wrap; graph rows preserve their spacing. Reuse the existing scroll and fixed-footer behavior.

Model selection and sorting must not select a live session or require it to remain in inventory. Existing exact model/agent filters seed Models on entry; session-ID search remains an inventory filter and does not constrain model aggregates. Show the effective analytics filters in the screen. Default sorting is completed requests descending, with stable model-ID tie breaking; unknown values sort last. A keyboard sort selector can reuse cached results.

## Metric and chart contract

Aggregate raw request facts from root and child sessions in one owning location, including historical sessions absent from the live inventory. Reuse the CLI's reconciliation, historical model attribution, reported-token eligibility and completion-time `[from, to)` filtering.

| Chart metric           | Per-bucket calculation                                                           |
| ---------------------- | -------------------------------------------------------------------------------- |
| Weighted request TPS   | Sum eligible reported output tokens × 1000 / sum matched request durations in ms |
| TTFT median            | Median of eligible observed TTFT values, displayed in seconds                    |
| TTFT p95               | Nearest-rank p95 of eligible observed TTFT values, displayed in seconds          |
| Completed requests     | Number of deduplicated completed requests                                        |
| Reported output tokens | Sum reported request output, with missing-usage counts visible                   |

Partition the requested interval into equal UTC time buckets and assign each request by stream-completion time. Use the same reconciliation result for range totals, chart buckets and request details. Calculate the range TPS directly from the summed tokens and durations, never from an average of plotted rates. Calculate range percentiles from requests, never bucket percentiles. Requests completed inside a range retain their full matched duration even if they started before it.

Label TPS **weighted request TPS**: summed concurrent request durations measure request performance, not combined tokens per wall-clock second. Do not sum sampled session averages or label this as live aggregate TPS. In-flight requests enter these charts only after observed stream completion; completion does not imply task success. A future fleet-throughput chart would need a separately defined time-attribution contract.

Use approximately 120 buckets by default, capped at 240. Rate and latency buckets without eligible observations are blank. Count/token buckets can show zero only when the retained coverage supports it; missing or uncertain coverage remains visibly partial or unknown. Overlay retained gap markers without claiming that absent markers prove complete coverage. Coarsen charts by merging underlying request facts, never by averaging bucket summaries. Changing terminal width or chart resolution must not change range totals.

## Phase 1 — Shared aggregate series

Refactor `src/modelanalytics.ts` to expose one bounded request reconciliation path shared by the existing CLI summaries and a new bucket aggregator. Keep existing CLI output and exported `aggregateModels` behavior compatible. Avoid copying normalization or deduplication into the TUI or RPC service.

Return allowlisted bucket fields: start/end, completed and eligible request counts, partial/excluded counts, reported output, matched duration, weighted TPS and TTFT statistics. Keep unknown metrics absent and retain attribution/coverage warnings. Keep archive scan metadata distinct from filter-specific eligibility counts.

Tests: hand-calculated totals and buckets, unequal/concurrent request durations, model switches, duplicates/conflicts, zero/missing usage, missing TTFT, partial facts, exact completion boundaries, empty buckets and gap markers. Cover more than 500 requests and 128 sessions. Assert that bucket count and request-detail pagination cannot affect totals.

## Phase 2 — Location-scoped analytics RPC

Add a separate versioned, read-only analytics contract in `src/rpc.ts` and a server module such as `src/modelanalyticsserver.ts`. Verify the installed public V2 registration and location-context APIs before integration. Preserve existing monitor/history contracts.

The service reads only the server-owned archive of its registered location. Clients submit ranges, model/agent filters and resolution, never filesystem paths. Do not remove the existing per-session History authorization check or enumerate live sessions to discover the archive's models.

Provide model summaries, selected-model buckets and paginated scalar request details from an immutable query snapshot. Aggregate before chart reduction or detail pagination. Bind an opaque cursor to the snapshot, location and query; reject expired/mismatched cursors and let the UI restart the query. Include `generatedAt`, snapshot expiry and scan/retention metadata so totals and pages cannot silently describe different archives.

Retain the existing seven-day query range, 64 MiB scan and bounded request reconciliation limits, reporting truncation explicitly. Bound returned model rows, cache memory, snapshot lifetime, detail pages and input/output sizes. Paginate a large model list without limiting its aggregate input. Serialize/coalesce scans per location and cancel obsolete callers; cancel shared work only when no callers need it. Read a bounded archive snapshot and report changes or incomplete reads explicitly.

Cache reusable results briefly; active-screen refresh should not cause a full archive scan per client on every sample write. Start with a 30-second refresh/cache interval, plus explicit refresh, and measure scan cost during validation. Reuse one authenticated dashboard connection and existing reconnect machinery. On older servers, show Models as unsupported while preserving overview, detail and session history.

Tests: input/output bounds, location isolation, disabled recording, unsupported capability, busy/cancelled reads, pagination stability during archive appends/pruning, expired cursors, malformed records, scan limits and privacy. No prompts, output text, tool results or credentials enter analytics payloads.

## Phase 3 — Controller and Models UI

Extend `src/dashboard/port.ts`, `connection.ts`, `controller.ts` and `view.ts` with negotiated analytics capability, selected model, range/filter state, summary pages, selected-model buckets, coverage and optional request-detail pages. Expose immutable views through the existing controller subscription; add no monitor/event stream.

Implement navigation and rendering in `terminal.ts` and `terminalview.ts`. Keep model detail independent of session selection. Preserve selected model identity across refresh/sorting. Reuse already-returned buckets for metric and bucket navigation, without RPC reads. When width changes, redraw cached data; avoid rescanning merely to resize.

Refresh only while Models is visible, on explicit refresh, range/filter changes or reconnection. Cancel obsolete queries after location/filter/range changes and discard late responses. Preserve previous results with a stale label on errors. Distinguish unsupported, recording disabled, unavailable, loading, empty, partial and stale states. Editing filters continues to take precedence over shortcuts.

The initial screen uses preset windows and explicit refresh; a custom UTC date-range editor can follow without blocking the first release. Request-detail pages can be a secondary view so the main screen remains useful in small terminals.

## Phase 4 — Validation and delivery

- Run formatting, strict types and the offline suite, including existing CLI analytics regressions.
- Test shell and native renderer navigation, all chart metrics, long identities, narrow/wide resize, chart-axis alignment, sorting, cached cursor movement and terminal restoration.
- Test selection/range/filter cancellation, refresh coalescing, stale recovery and old-server capability fallback with injected ports/clocks.
- Run packed installation checks and authenticated synthetic-provider checks on supported OpenCode 2.0.29 and 2.1.2. Exercise multiple sessions using the same model, model changes, archived sessions absent from inventory, more than 500 requests, server restart and location isolation.
- Validate the native OpenCode TUI and dashboard running concurrently in separate PTYs, including incoming completed requests and dashboard exit without interrupting OpenCode.
- Compare displayed range totals with `context-guard models` over the identical archive/filter/range. Run scalar privacy canaries through RPC and captured terminal frames. Record scan latency and cache behavior.
- Update help, README, metric definitions, architecture, compatibility and testing documentation. Report live skips separately from passes.

Acceptance: selecting a model shows one aggregate chart and matching summary across all eligible retained requests in the selected location/range, independent of live inventory, per-session chart limits, page size and terminal width. Limits and unknown measurements remain explicit.

Durable storage, all-time history, cross-location aggregation, browser delivery and the native `/context-guard` panel are separate milestones. This milestone targets the standalone terminal dashboard. Implementation is local; no version bump or publication is included.
