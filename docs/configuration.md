# Configuration and accounting

The TypeScript schema is `Config` in `src/types.ts`; `parseConfig(unknown)` in `src/config.ts` performs runtime validation. Unknown keys at every level, invalid types, nonfinite/fractional token thresholds, empty selectors, unsupported glob syntax, ratios outside `(0,1]`, invalid modes, and incompatible telemetry settings fail setup with a field-level error. There is no fallback to an accidentally more permissive configuration.

Defaults:

| Setting                       | Default                                      |
| ----------------------------- | -------------------------------------------- |
| enabled / mode                | true / observe                               |
| defaults.threshold            | tokens: 131072                               |
| policies                      | []                                           |
| safety.cooldownMs             | 60000                                        |
| safety.minReclaimTokens       | 8192                                         |
| safety.maxConsecutiveFailures | 3                                            |
| safety.pendingTimeoutMs       | 300000                                       |
| safety.staleMs                | 300000                                       |
| safety.maxSessions            | 1024                                         |
| safety.sessionTtlMs           | 86400000                                     |
| safety.outputReserveTokens    | positive model output limit                  |
| metrics.enabled               | true                                         |
| metrics.sampleIntervalMs      | 500                                          |
| metrics.rollingWindowMs       | 2000                                         |
| history.enabled               | true                                         |
| history.retentionDays         | 7                                            |
| history.maxBytes              | 67108864 total                               |
| history.path                  | location journal path + `.metrics` directory |
| telemetry.enabled / jsonl     | true / true                                  |
| telemetry.maxBytes            | 8388608 per file, two files retained         |
| telemetry.path                | location hash in user's state directory      |

All safety/time/size values are safe integers; cooldown, reclaim and explicit reservation may be zero. Positive bounds are required for other fields. Reclaim must be smaller than every absolute threshold. `policies` has at most 256 entries. Selectors are case-sensitive, at most 256 characters, with `*` and `?` wildcards only; other regex characters are literal. Model selectors contain a slash and match the complete `providerID/modelID`. Role `main` means no parentID; any depth with a parentID is `subagent`. There is no inferred specificity: last matching policy wins in array order.

A remaining-token allowance larger than the model budget is reported as `incompatible-model-budget`; unknown budgets report `missing-model-budget`. These rules do not generate repeated compactions. Unknown output reservation with no explicit input limit also means unknown usable budget. An explicit zero reservation is allowed but should reflect your actual request setup. The plugin's default reservation is conservative and may exceed OpenCode's actual per-request output cap. Generation options and model limits remain untouched.

## Measurements

`usage.current` contains `tokens`, `at`, model, optional requestId, provenance, confidence and scope:

- `provider-normalized` / `reported` / `completed-request`: normalized counts from `session.step.ended` (or a failed step reporting usage). Input = `input + cache.read + cache.write`. This is the reported count of that completed prompt, not a promise about the next request. Provider bugs, hidden protocol overhead, and opaque native checkpoints can still affect accuracy.
- `serialized-estimate` / `approximate` / `prepared-request`: bounded traversal of already assembled hook system/messages/tools, divided by three characters per token. Used only when no fresh matching provider metric exists. No full-session history API is scanned. Binary payloads, depth >30, >100000 values, or >2 million characters cause the estimator to abstain; unsupported media and provider transforms prevent exact sizing.

Zero normalized prompt counts are treated as missing: V2 normalization also uses zero when providers omit metrics. Negative/noninteger/nonfinite metrics are rejected. Old measurements do not override newer observations; model changes invalidate old prompt measurements. Provider observations are correlated with the `step.started` model, so attaching to a request after its start cannot silently attribute usage to a new model.

`usage.cumulative` comes from O(1) `session.get().tokens` metadata reads. It includes persisted session usage (including auxiliary work accounted by the harness), independent of current prompt size. Visible output and reasoning are separate; sum them for total generated tokens. Input categories are similarly separate; add input/read/write for cumulative prompt tokens. These totals are not multiplied or accumulated from repeated event notifications. Exact snapshot timing can lag an in-flight request.

Peak usage, model-request and tool-call counters cover **this monitor residency**, with `countersSince` defining their beginning. They are not claimed to be lifetime counters. Compaction counters/safety timestamps are persisted for retained sessions. Prepared prompt estimates can contribute to the peak. Event stream gaps suspend enforcement until plugin reload and explicitly report potentially incomplete observations. An inactive record is historical; `lastSeen` is not a live heartbeat.

## Logging

Only whitelisted scalar identity, usage, decisions and lifecycle state are serialized. No event payloads, prompts, tool arguments/results, model responses, summaries, credentials, or exception bodies are logged. Session/agent/model IDs are intentionally included. `jsonl:false` sends structured records to stderr instead of writing a journal; `enabled:false` disables usage telemetry, not bounded safety persistence. Files are created 0600 inside a 0700 directory. Existing parent permissions are not changed. Use a dedicated path, not a symlink or shared log destination.

## Native Context Guard view

The package exposes separate server, RPC and TUI entries. The same package or checkout registration in `opencode.jsonc` supplies both local entries on the inspected 2.0.29 host. For a remote connection, also install/register the package on the client in V2 `cli.json`:

```jsonc
{
  "plugins": [{ "package": "@cesarus777/opencode-cgp" }],
}
```

The remote server needs its own registration in the owning location. The client path is local to that client; it is never used as a remote telemetry path. Server options remain in `opencode.jsonc`. The TUI does not change enforcement, model limits, or native Context display. Performance collection and history use the server-side `metrics` and `history` options.

Open **Context Guard** from the command palette or `/context-guard`. Root sessions show a native sidebar section when the host mounts its sidebar. The inspected host suppresses that sidebar in child sessions; the panel also works in narrow terminals. On child routes the host also hides its normal prompt and palette shortcut; click **Context Guard: open panel** above the child composer to open the panel without leaving that route. The host controls focus, Escape, fullscreen and resize. Panel keys apply while focused:

| Key          | Action                                     |
| ------------ | ------------------------------------------ |
| Up / Down    | Select a family row; keep sibling order    |
| Enter        | Close this panel and navigate to selection |
| Space        | Expand/collapse a completed branch         |
| i            | Inspect selected session details           |
| r            | Refresh inventory and measurements         |
| l            | Resume partial inventory discovery         |
| c            | Toggle performance charts                  |
| Left / Right | Previous/next chart metric (wraps)         |
| [ / ]        | Shorter/longer chart time window           |
| q            | Close the panel                            |

The sidebar shows six descendants plus the family root. The panel renders a moving window of at most 25 rows. Completed branches collapse unless they contain the current ancestry, running work, crossed pressure, or blocked/uncertain compaction. Expanded-branch preferences are persisted as at most 1024 IDs; measurements and execution caches are transient.

The main session uses a live context chart in the sidebar and panel. Its full height is Guard's effective input capacity (0–100%), with a horizontal **┄** line at the resolved compaction threshold. Columns show successive observed measurements, newest at the right; the vertical scale does not expand with usage. Between completed compactions the displayed context level never decreases. Missing or temporarily lower measurements retain the previous displayed level; gray **┈** tops and shaded columns mark these held values. Pauses longer than 2.5 seconds get a held column, including a temporary tail toward now. A completed compaction permits a drop only after a reported completed-request measurement at or after its completion; admission, running, failure and estimates do not imply reclaimed context. The earlier high level remains alongside the lower value. Used/capacity tokens, occupancy percentage, threshold/headroom, freshness and compaction phase remain text. Subagent rows retain compact progress bars.

The shared UI state retains up to 96 display points per session for the 128 most recently viewed sessions. Sidebar/panel remounts and session navigation retain these traces; model or capacity changes start a new trace. Closing the client or unloading the plugin clears this local history. The chart displays as many recent points as fit. Age updates add at most one temporary held tail without storing timer measurements. The horizontal axis is observation order rather than elapsed time: a long pause is marked rather than expanded into one column per second. Before any usable measurement, missing usage remains blank. Held values affect only the graph; token/percentage labels and enforcement use the original measurements, so a temporarily lower reported value can differ from the held chart level. Stale measurements keep their freshness label and a muted trace. Unknown capacity leaves the chart unavailable; a threshold above capacity is reported in text. Usage above capacity is clipped visually while the text retains its actual value. Context charting requires no retained performance history or additional RPC requests.

Occupancy is prompt input plus cache reads/writes divided by Guard's effective input capacity. It differs from native Context, which includes other token categories and uses the context limit. Threshold comparisons use raw numbers: `tokens` and `ratio` are inclusive, `remaining` is strict. `~` labels estimates, `! near` means at least 90% of a positive trigger, and `!! crossed` means the configured comparison holds. Stale/missing measurements have unknown pressure. Cumulative input/output/reasoning/cache totals appear separately in inspected detail. A compaction phase of `accepted` means admission only.

Snapshots work with telemetry disabled. Public RPC reads and live events carry only allowlisted scalar metadata and numeric usage. Reads cannot discover monitor sessions, admit compaction, restore suspended enforcement, or read transcripts. Native inventory discovers ancestors and paginated descendants outside rendering; discovered but unmonitored sessions retain unknown Guard values.

Automatic inventory is bounded to 1024 nodes, depth 64 and 100 list pages per scan, with one list request at a time. `l` resumes pending pages and permits up to 2048 resident client nodes, still with 100 pages per action. A partial marker remains when a bound, cycle, missing parent or failed branch prevents completeness. A visible family rescan runs every 30 seconds. Each owning location has a separate cancellable transport, reads at most 128 IDs per call with concurrency two, and reconciles every 15 seconds with a 5-second deadline. Live batches coalesce on the existing 100 ms worker. Gaps, reconnects, incompatible payloads and missing services are visible; transient errors retain last-known measurements. Hiding the last consumer aborts requests, streams, listeners and timers.

## Live performance and retained history

Each root/child session instance has separate metrics, even when agent names match. `TPS` is a rolling estimate of text plus reasoning characters / 4 per second; it is language/tokenizer dependent and marked `~`. The window defaults to two seconds and publication to 500 ms. Both intervals are integer milliseconds, at least 100; the window must be >= the publication interval and <= 60000.

`Avg model` divides matched completed-request output + reasoning tokens by accumulated request time (request start through stream completion). It includes TTFT and excludes subsequent tool execution, backoff and idle time. It is a duration-weighted rate, not an average of individual rates. `Avg session` divides authoritative cumulative session output + reasoning by wall time since session creation; it includes idle/tool time and auxiliary work counted by the harness. Its denominator continues increasing while idle. In-flight usage is not added to either reported average. Provider omissions propagate; normalized zeros cannot always distinguish omitted usage from an actual zero.

`TTFT` measures request start to the first nonempty text or reasoning delta, including publication/batching delay. It is marked `~` because it is observed output timing, not a direct provider token timestamp. Tool-only requests have unknown text/reasoning TTFT. Provider output may include generated tool arguments, so final reported rates may differ from the text/reasoning live estimate. Live TPS becomes zero after streaming stops; latest completed request TPS/TTFT remain in details until replaced by a new request. Waiting requests have no TTFT yet.

`partial` means model timing coverage is incomplete: late observation of a session with existing output, an unmatched request, retry replacement, missing timing/usage, restart, eviction/recreation, or event gap. No transcript reconstruction occurs. Performance checkpoints retain matched counts/durations and durable event deduplication under `performance.v1`, separately from compaction safety. Restarts invalidate live timing and label retained aggregates partial. Unknown rates display `?` rather than zero. Metrics do not affect compaction policy.

History is independent of diagnostic telemetry. `history.enabled:false` disables the archive; `metrics.enabled:false` also disables collection, checkpoints and archive writes. `history.path` is an absolute directory (not a file). Defaults use a location-hashed directory beside the default diagnostic journal; a custom `telemetry.path` does not redirect metrics. Use a dedicated history directory per location/process. History records contain scalar metadata only, never output text, reasoning, tool arguments/results, prompts or credentials.

The archive stores active-session samples at most once per second, request summaries, lifecycle/terminal records and gaps. Idle sessions are not sampled continuously. Version 1 JSONL records have unique record IDs, timestamps, session/parent/agent/model identity and optional performance snapshots. Snapshots include session creation/output totals, request timing/identity, matched token/duration totals, rates, completeness and provenance. Request summaries supersede live estimates; never add their totals to sampled totals. Model averages can be recomputed from aggregate count/duration differences; preserve gaps when downsampling.

Files rotate at 4 MiB or one hour, whichever comes first, and the configurable total byte cap takes precedence. Age retention uses segment start times and may remove a partly expired segment. Startup and writes prune expired/excess segments. Files are created 0600 in a 0700 directory. The bounded writer reports dropped samples and writes a gap marker when it can resume. Disk failures disable the archive and emit `history-unavailable`; live monitoring and compaction continue. `history-truncated` reports age/cap pruning. Archive completeness is always bounded by retention.

Export metrics as JSON or CSV:

```sh
bun run inspect metrics /absolute/history-directory --session ses_example --from 2026-10-20T00:00:00Z --to 2026-10-21T00:00:00Z
bun run inspect metrics /absolute/history-directory --csv > metrics.csv
```

Timestamps accept ISO dates or epoch milliseconds. JSON includes retention/read-limit metadata; CSV sends that metadata to stderr. Readers skip malformed/partial records, report them, and read at most 64 MiB of recent whole segments. Charts use the same timestamped records and preserve explicit observation gaps; see the chart commands below.

The new `context-guard.monitor.v2` RPC adds optional performance snapshots while retaining the version-1 batch envelope and revision protocol. The original v1 endpoint strips performance fields. Updated clients probe v2 per location and fall back to v1; older servers show context monitoring without performance metrics.

## Performance charts

Both chart surfaces display live TPS estimates, model-time and session-time average TPS, per-request TTFT, completed request throughput, and cumulative output. Each session instance keeps its own series, even when agent names match. Curves break across missing samples longer than 2.5 seconds, recorded gaps, model/agent changes, counter resets, or observation epochs. Missing observations are never filled with zero. Request TTFT/throughput use one scatter observation per completed request, deduplicated by session, request ID, and start time.

### Terminal panel

Open `/context-guard` and press **c** to show charts for the selected session. The padded panel shows one metric at a time: **Left / Right** cycles through live TPS, model/session averages, TTFT, request throughput and cumulative output. **Up / Down** chooses another family instance; **[ / ]** changes the window between five minutes, one hour (default), 24 hours and seven days. **c** returns to the monitor; **q** closes the panel. Controls stay visible in a fixed footer while content scrolls. **r** refreshes; history also refreshes every five seconds while chart mode is mounted. Switching metrics reuses the current history without another read.

Charts use a six-row block plot with a zero baseline, a value scale where space permits, and UTC time labels. Blank columns mean no sample; **┆** marks an explicit gap. Each occupied column shows an observed peak, with the observed min/max printed above it. Missing measurements are never connected or filled with zero. Narrow terminals wrap labels and retain the chart bounds. Returning from chart mode or closing the panel cancels its reads and polling.

The read-only `context-guard.history.v1` RPC accepts a session ID, from/to timestamps and a point bound. The owning server validates session location, limits windows to seven days, permits one archive read at a time, and caps responses at 500 points/requests and 128 gap markers. The TUI requests 240 points and shows bounded/downsampled and incomplete-data notices. It reads the server's configured archive, including for remote sessions; clients cannot choose server filesystem paths. Disabled recording and unavailable/older servers are shown explicitly. Monitoring/enforcement do not depend on this service.

### Interactive offline report

```sh
bun run charts /absolute/history-directory --output report.html
bun run charts /absolute/history-directory --session ses_example --from 2026-10-20T00:00:00Z --to 2026-10-21T00:00:00Z --output day.html
bun run inspect metrics /absolute/history-directory --chart report.html
# Installed npm package, with Bun available:
context-guard charts /absolute/history-directory --output report.html
```

Open the generated HTML file in a browser. It embeds its data and SVG renderer and makes no network requests. Select a session or compare up to 12 instances; filter by agent, model and UTC time; hover/focus points to see exact timestamps/values; save individual SVG charts or print the report. The four summary cards show matched/observed request counts, duration-weighted throughput, and median/p95 observed TTFT using the nearest-rank definition. Requests with missing reported usage or duration are excluded from throughput calculations, not assigned zero.

CLI `--session`, `--agent`, `--model`, `--from` and `--to` restrict the data embedded in the file. Browser filters can narrow that retained subset. Agent/model filters select observations with that captured request identity; the session average curves still describe the original session's cumulative totals. The summary throughput is recomputed from retained matching request tokens and durations, so it may differ from a session's lifetime model average. Repeated lifecycle snapshots never add output or inflate request counts.

`--max-points` defaults to 1000 per session (16–5000); `--max-sessions` defaults to the 128 most recently observed sessions (1–1024). Downsampling retains original timestamps, bucket endpoints and metric extrema, propagating gaps instead of averaging rates. Up to 1024 recent explicit gap markers are embedded; older discontinuities remain in curve boundaries. Full request records remain available for filtered summary calculations; request scatter drawing is separately bounded. Reports show retention, malformed-record, read-limit, omitted-session/gap and partial-coverage notices. Generation reads at most 64 MiB of history. Use `--session` to inspect an instance omitted by the report session bound. Existing output files require explicit `--force`; new reports are created 0600. Reports are snapshots: regenerate them to include new measurements.
