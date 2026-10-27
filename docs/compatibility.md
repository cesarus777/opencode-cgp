# Compatibility and known limitations

## Evidence

Verified against published `@opencode/plugin@2.0.29` and `@opencode/client@2.0.29`; inspected upstream commit `4397ee44d038a5f17bf6ac161431673d93e563b5`. SDK type checks and entrypoint import run in Bun 1.1.34. Official docs are live and may change; pin the SDK and revalidate lifecycle behavior when upgrading the harness. OpenCode 2.1.2 additionally passes local server/TUI validation with the same pinned SDK baseline; see the [2.1.2 report](validation/context-chart-2.1.2-2026-10-22.md). Other runtime versions are not certified merely because they load this package.

The source's `packages/core/test/session-runner.test.ts` includes “runs manual compaction before the continuation of an active tool turn”. It asserts the compaction message completes and the continuation runs. The corresponding runner consumes steer compaction controls on every iteration without excluding parented sessions. This is source evidence, not a claim that the upstream test suite was executed here.

Actual local 2.0.29 host validation with synthetic streaming, metrics/history RPCs, restart/retention, chart controls and completed child compaction is recorded in the [2026-10-20 report](validation/metrics-2.0.29-2026-10-20.md). The packed artifact also serves all three RPC versions in observe and enforce modes. Genuine-provider accounting and reclaim remain separate validation gates.

## Capability matrix

| Criterion                                                           | Status                                                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Immutable model limits; three thresholds; role/model/agent policies | Implemented and unit-tested                                                                       |
| Root, child and nested child monitoring                             | Implemented; mocked SDK integration tested                                                        |
| Durable public V2 compaction and completion tracking                | Implemented; compiled against published SDK                                                       |
| Active child can compact before task end                            | Supported by inspected runner; mocked and synthetic-provider live paths tested                    |
| Strict compaction before the immediately next request               | **Unsupported guarantee**; asynchronous event/admission race                                      |
| Global session inventory before next activity                       | **Unavailable on plugin SessionContext**; lazy discovery via hooks/events or selected-ID UI reads |
| Exact next-request size from public provider metrics                | **Unavailable**; reported previous request plus labeled fallback only                             |
| Completed compaction reconstruction after an event gap/restart      | Conservative `uncertain`; no full transcript replay                                               |
| Exact cumulative session tokens                                     | Uses harness session totals; provider omissions still propagate                                   |
| Lifetime peak/request/tool counters                                 | **Not implemented**; residency-scoped counters are explicit                                       |
| Superpowers workflow coexistence                                    | No workflow modifications; **real Superpowers run unverified**                                    |
| Live V2 installation/provider check                                 | **Local TUI verified on 2.0.29 with synthetic metrics**; real-provider compaction unverified      |
| Forced budget stop, rotation, checkpoints                           | Intentionally not implemented                                                                     |

An active long-running child is never excluded because it is a child or because it has not become idle. The hook observes every primary request and step events drive enforcement. A single long model request or tool cannot be interrupted by Context Guard. There may be one or more additional requests before admission reaches a safe boundary. This plugin is early compaction policy, not a hard token-limit firewall.

The assembled-context estimator is a heuristic. Large binary/media-heavy or >2-million-character fallback contexts can be unknown. Provider metrics remain preferred; a zero or missing metric does not become an exact count. Protocol-specific `contextTokens` is not available in public step events. Native provider compaction may retain opaque state that is not comparable across models; model changes invalidate prompt usage.

The public directory identifies plugin ownership. Parent/child sessions moved to another location require the plugin to be loaded there too. Sessions inactive before installation appear on their next activity or when selected by a sidebar/panel snapshot read. Those reads can restore the last matching-model prompt usage through public `session.context`, retaining its original timestamp; they never request compaction or reconstruct compaction completion. No usable usage after compaction, missing revert boundaries and missing/zero provider metrics remain unknown. The plugin does not list historical transcripts or poll every session. CLI history is limited to retained journal records.

`uncertain` means an admission/completion may have happened without evidence. It never expires into permission to compact again. A subsequent explicit compaction lifecycle can resolve it; manual native compaction is available through OpenCode. A failure circuit resets after observed success. Reloading does not erase persisted unresolved safety state. No automatic destructive state reset is provided. Long-lived dormant recovery records may exhaust `maxSessions`; increase this bound or inspect/remove obsolete sessions through OpenCode so deletion events can clean them up. Capacity conditions are logged explicitly.

An event stream gap suspends enforcement until reload even when observation reconnects. No private event replay or experimental wait API is used. Telemetry failure is reported to stderr and does not interrupt native workflows; failure of safety persistence prevents admission. The plugin does not suppress OpenCode's own automatic compaction, so observe mode means this plugin does not request compaction, not that OpenCode will never compact.

## Native TUI validation boundary

The TUI and RPC boundaries compile against the installed 2.0.29 declarations. Offline tests verify public checkout entry resolution, server imports without renderer modules, mocked server snapshots, cancellation/order recovery, nested paginated inventory, execution reduction and native OpenTUI rendering through its public Solid preload. Optional renderer peers remain separate from server imports. The actual compiled 2.0.29 host additionally passed local synthetic-provider checks; see the [verification report](validation/tui-2.0.29-2026-10-16.md). Apart from the separately validated 2.1.2 runtime, other V2 versions remain uncertified.

The inspected host controls sidebar visibility and suppresses it for child routes. The child composer also occupies its own input mode, hiding the normal prompt/palette shortcut. The native **Context Guard: open panel** action above that composer provides panel access without navigating to the parent; `/context-guard` and palette access remain available in the usual prompt scope. Another plugin can suppress additive sidebar claims through replacement. Remote clients need a client-side package installation plus the server plugin in every owning location. Workspace IDs are used when available for canonical alias matching, with directory equality as the fallback. Actual remote routing/authentication aliases remain a live-validation item.

The actual local server/TUI passed authenticated RPC reads/live updates, root sidebar rendering, slash access, child/grandchild navigation, child panel actions and 160×50, 80×30 and 40×20 terminal layouts with synthetic provider usage. Startup catalog recovery was verified and regression-tested. Real-provider compaction, cross-machine remote TUI, tmux, Neovim terminal and long-running resource behavior remain unverified. Unknown/evicted historical sessions do not acquire fabricated measurements. Reconnecting the UI never re-enables enforcement suspended by a server event-stream gap.

## npm distribution verification

The prepared package is `@cesarus777/opencode-cgp@0.1.0`; the unscoped name belongs to another project. Package identity does not change the plugin ID, options, RPC contract or diagnostic storage locations.

The tarball has been installed into a temporary clean environment and checked independently of the source checkout. Server/core/RPC load without renderer peers; all five exports resolve; the nine adapter regressions run against the installed default export; declarations compile in a consumer; and the compiled TUI renders, responds to shared Solid state and clicks, and disposes through public OpenTUI runtime support. No renderer or SDK is bundled into the plugin.

Actual **OpenCode 2.0.29** additionally registered the installed tarball's built directory and returned RPC health in **observe and enforce** modes on 2026-10-16. These isolated servers made no model requests. This establishes real-host initialization and RPC compatibility, not real-provider compaction. The 2.0.29 configured-local loader skips direct files despite newer live docs describing file paths; use checkout directories or the packed `dist` directory for local validation. Normal npm resolution uses the package exports.

The native npm-manager fetch cannot be verified until publication. Interactive TUI in the compiled host against the **packed** artifact, Git preparation in the native manager, other V2 versions, and GitHub Actions/OIDC execution remain unverified. The prior interactive synthetic-provider report applies to the source checkout. See [packed validation and reproduction](testing.md#packed-npm-artifact).

## Performance metrics

Live TPS uses approximate character counts from public text/reasoning deltas; exact per-token streaming counts are unavailable in the pinned SDK. Completed request rates use normalized output + reasoning and `session.step.streamed` timing. TTFT includes native delta batching and transport publication delay. Tool-only output does not establish text/reasoning TTFT. Historical model durations before observation, across restart, or across a stream gap cannot be reconstructed from cumulative tokens; rates retain an explicit partial label.

Both `context-guard.monitor.v1` and `.v2` are served; v1 retains its closed payload shape. Performance integration is covered by offline SDK/mocked-adapter tests. Real-provider timing validation requires the opt-in `test:metrics-live` command and is not certified by offline tests.

Charts require retained scalar history. Existing history records remain readable without migration. The updated terminal chart mode needs `context-guard.history.v1` on the owning server; older servers keep live/context views and show an unavailable-history message. Offline reports require JavaScript for interaction and embed all selected scalar identities/metrics; no external assets or service are used. Native chart formatting/rendering and HTML generation are tested offline; this does not certify a live remote provider.

## Standalone terminal

`context-guard dashboard tui` uses one shared dashboard controller and the existing monitor/history RPCs, independently of the native TUI. Its terminal runtime is Bun >=1.3.0 with the optional `@opentui/core@0.5.17` peer installed beside the CLI. It uses public core text rendering without Solid or `@opencode/plugin/tui`. Renderer loading stays dynamic in the built CLI, and preflight failures occur before alternate-screen takeover. Existing server/core/diagnostic commands retain Bun >=1.1.34 support and require no renderer peers. The SDK remains pinned to 2.0.29.

Linux x64 synthetic-provider PTY checks cover OpenCode 2.0.29 and 2.1.2, populated root/concurrent-child metrics, all history metrics/windows and restart recovery. History points do not retain per-sample token-source metadata; the UI labels that limit and explains the estimated live TPS and matched timing semantics. Cross-machine HTTPS, other platforms, tmux/Neovim, real-provider accounting and long-running resource behavior remain unverified. Browser delivery and combined release checks remain later milestones. See [terminal validation](validation/dashboard-terminal-2026-10-28.md).
