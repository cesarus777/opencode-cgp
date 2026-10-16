# OpenCode V2 Context Guard

Configurable early compaction for root sessions and nested agents, using OpenCode's native durable compaction API. No model-limit changes, prompt injection, custom summaries, or task/workflow rewrites. Observe mode is the default.

Targets **`@opencode/plugin@2.0.29`**. The published SDK, official documentation, runner implementation, and upstream continuation test were inspected. This workspace had no installed OpenCode executable or local model endpoint: **live OpenCode / Superpowers validation remains unverified**, not a claimed pass. See [compatibility](docs/compatibility.md).

## Install

```sh
cd /path/to/opencode-cgp
bun install --frozen-lockfile
bun run typecheck
bun test
```

Register the checkout in your **V2** `opencode.jsonc` (project scope), or your existing global configuration to cover every location that loads it:

```jsonc
{
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-cgp",
      "options": {
        "mode": "observe",
        "defaults": { "threshold": { "type": "tokens", "value": 131072 } },
      },
    },
  ],
}
```

Restart/reload OpenCode and look for `context-guard: observe; diagnostics ...`. The package entrypoint has been import-tested with Bun and type-checked against the published V2 SDK. Plugin registration/options match the [official V2 plugin contract](https://dev.opencode.ai/v2/docs/build/plugins/). Actual registration in a running V2 host has not been tested here. Do not register the plugin twice (for example, both auto-discovery and `plugins`). No configuration is edited by the plugin.

Watch diagnostics first; then set `mode` to `enforce`. The complete [example](examples/opencode.jsonc) includes model, role, and agent policies. **Last matching rule wins**; selectors within a rule are ANDed. Put a subagent rule last if it must override every model rule.

## Thresholds

| Type        | Example  | Trigger                                    |
| ----------- | -------- | ------------------------------------------ |
| `tokens`    | `131072` | Prompt tokens ≥ value                      |
| `ratio`     | `0.25`   | Prompt tokens ≥ ceil(usable input × value) |
| `remaining` | `32768`  | Usable input − prompt tokens < value       |

Usable input is `min(positive limit.input, limit.context − output reservation)` when both constraints are known. Without an explicit input limit, the context-minus-reservation budget is used. Reservation defaults to positive `limit.output`; `safety.outputReserveTokens` can explicitly override this accounting assumption. Unknown limits are not fabricated. Absolute thresholds still work without model metadata; relative decisions abstain. Model metadata is never mutated.

A provider measurement refers to its **completed request**, not the next assembled prompt. Prompt tokens include uncached input plus cache reads and writes; output and reasoning are separate. Approximate fallback measurements are visibly labeled. See [configuration and accounting](docs/configuration.md).

## Native TUI

Open `/context-guard` or **Open Context Guard** in the command palette for current prompt occupancy, effective input capacity, trigger/headroom, measurement freshness, compaction phase and nested agent status. A native sidebar section appears where the host mounts its sidebar; the panel also works on child routes and narrow terminals. Estimates, unknown values, stale measurements and uncertain compaction remain explicit.

The TUI reads bounded snapshots over public OpenCode RPC, including when telemetry is disabled. Remote clients also need a client-side package registration in `cli.json`; see [the example](examples/cli.jsonc) and [controls, installation and bounds](docs/configuration.md#native-context-guard-view). It targets the inspected 2.0.29 API. Offline native-renderer tests pass; live host and terminal-environment validation remain unverified.

## Inspect

The startup message reports a location-specific JSONL file under `$XDG_STATE_HOME/opencode-context-guard/` (default `~/.local/state/opencode-context-guard/`). A custom absolute `telemetry.path` is supported. Use a distinct file per plugin location/process.

```sh
bun run inspect /absolute/path/from/startup.jsonl --json
bun run inspect /absolute/path/from/startup.jsonl --history
```

Latest retained session records show parent ID, agent/model, measurement scope/confidence, current and cumulative usage, model limits, effective threshold/percentage, policy, peak, compaction count, lifecycle state, failures, and timestamps. History includes degraded-capability and capacity events. Logs rotate at 8 MiB by default, retaining one previous file; this is a bounded diagnostic history, not an audit database. The CLI reads files and does not contact the model.

## Safety and validation

Compaction runs at a runtime step boundary, including active subagent continuations. Admission is asynchronous: the plugin cannot promise a hard ceiling on the immediately following prompt or interrupt a long-running tool. It does not wait for an agent's task to finish.

Cooldown, hysteresis, deduplication, failure limits, persisted safety state, and completion-event tracking prevent repeated summaries. An accepted request is never labeled completed. Ambiguous admission, missing completion, and interrupted-plugin recovery suppress further automatic requests until explicit lifecycle evidence resolves uncertainty. Native manual compaction remains available. No private/experimental API is used.

```sh
bun run typecheck
bun test
bun run test:live   # explicitly SKIPs without the required server environment
```

Tests cover the core, mocked V2 events for concurrent nested subagents, restart safety, telemetry rotation, and CLI reading. [Live test instructions](docs/testing.md) describe the optional disposable-session check against an existing V2 host and a local OpenAI-compatible endpoint; no model download is required.

Further reading: [API investigation](docs/reconnaissance.md), [architecture](docs/architecture.md), [Budget Controller extension](docs/budget-controller.md), [compatibility and limitations](docs/compatibility.md).
