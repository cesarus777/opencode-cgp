# Configuration and accounting

The TypeScript schema is `Config` in `src/types.ts`; `parseConfig(unknown)` in `src/config.ts` performs runtime validation. Unknown keys at every level, invalid types, nonfinite/fractional token thresholds, empty selectors, unsupported glob syntax, ratios outside `(0,1]`, invalid modes, and incompatible telemetry settings fail setup with a field-level error. There is no fallback to an accidentally more permissive configuration.

Defaults:

| Setting                       | Default                                 |
| ----------------------------- | --------------------------------------- |
| enabled / mode                | true / observe                          |
| defaults.threshold            | tokens: 131072                          |
| policies                      | []                                      |
| safety.cooldownMs             | 60000                                   |
| safety.minReclaimTokens       | 8192                                    |
| safety.maxConsecutiveFailures | 3                                       |
| safety.pendingTimeoutMs       | 300000                                  |
| safety.staleMs                | 300000                                  |
| safety.maxSessions            | 1024                                    |
| safety.sessionTtlMs           | 86400000                                |
| safety.outputReserveTokens    | positive model output limit             |
| telemetry.enabled / jsonl     | true / true                             |
| telemetry.maxBytes            | 8388608 per file, two files retained    |
| telemetry.path                | location hash in user's state directory |

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
