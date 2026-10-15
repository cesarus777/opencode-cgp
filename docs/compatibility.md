# Compatibility and known limitations

## Evidence

Verified against published `@opencode/plugin@2.0.29` and `@opencode/client@2.0.29`; inspected upstream commit `4397ee44d038a5f17bf6ac161431673d93e563b5`. SDK type checks and entrypoint import run in Bun 1.1.34. Official docs are live and may change; pin the SDK and revalidate lifecycle behavior when upgrading the harness. A different runtime version is not certified merely because it loads this package.

The source's `packages/core/test/session-runner.test.ts` includes “runs manual compaction before the continuation of an active tool turn”. It asserts the compaction message completes and the continuation runs. The corresponding runner consumes steer compaction controls on every iteration without excluding parented sessions. This is source evidence, not a claim that the upstream test suite was executed here.

## Capability matrix

| Criterion                                                           | Status                                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Immutable model limits; three thresholds; role/model/agent policies | Implemented and unit-tested                                                    |
| Root, child and nested child monitoring                             | Implemented; mocked SDK integration tested                                     |
| Durable public V2 compaction and completion tracking                | Implemented; compiled against published SDK                                    |
| Active child can compact before task end                            | Supported by inspected runner; mocked plugin path tested; live host unverified |
| Strict compaction before the immediately next request               | **Unsupported guarantee**; asynchronous event/admission race                   |
| Global session inventory before next activity                       | **Unavailable on plugin SessionContext**; lazy discovery via hooks/events      |
| Exact next-request size from public provider metrics                | **Unavailable**; reported previous request plus labeled fallback only          |
| Completed compaction reconstruction after an event gap/restart      | Conservative `uncertain`; no full transcript replay                            |
| Exact cumulative session tokens                                     | Uses harness session totals; provider omissions still propagate                |
| Lifetime peak/request/tool counters                                 | **Not implemented**; residency-scoped counters are explicit                    |
| Superpowers workflow coexistence                                    | No workflow modifications; **real Superpowers run unverified**                 |
| Live V2 installation/provider check                                 | **Not run**: binary/server/endpoint absent in the supplied workspace           |
| Forced budget stop, rotation, checkpoints                           | Intentionally not implemented                                                  |

An active long-running child is never excluded because it is a child or because it has not become idle. The hook observes every primary request and step events drive enforcement. A single long model request or tool cannot be interrupted by Context Guard. There may be one or more additional requests before admission reaches a safe boundary. This plugin is early compaction policy, not a hard token-limit firewall.

The assembled-context estimator is a heuristic. Large binary/media-heavy or >2-million-character fallback contexts can be unknown. Provider metrics remain preferred; a zero or missing metric does not become an exact count. Protocol-specific `contextTokens` is not available in public step events. Native provider compaction may retain opaque state that is not comparable across models; model changes invalidate prompt usage.

The public directory identifies plugin ownership. Parent/child sessions moved to another location require the plugin to be loaded there too. Sessions inactive before installation appear on their next activity. The plugin does not list historical transcripts or poll every session. CLI history is limited to retained journal records.

`uncertain` means an admission/completion may have happened without evidence. It never expires into permission to compact again. A subsequent explicit compaction lifecycle can resolve it; manual native compaction is available through OpenCode. A failure circuit resets after observed success. Reloading does not erase persisted unresolved safety state. No automatic destructive state reset is provided. Long-lived dormant recovery records may exhaust `maxSessions`; increase this bound or inspect/remove obsolete sessions through OpenCode so deletion events can clean them up. Capacity conditions are logged explicitly.

An event stream gap suspends enforcement until reload even when observation reconnects. No private event replay or experimental wait API is used. Telemetry failure is reported to stderr and does not interrupt native workflows; failure of safety persistence prevents admission. The plugin does not suppress OpenCode's own automatic compaction, so observe mode means this plugin does not request compaction, not that OpenCode will never compact.
