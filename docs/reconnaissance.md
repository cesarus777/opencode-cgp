# API investigation (2026-10-15)

No OpenCode binary, installed SDK, or existing application was present in this workspace. Bun is 1.1.34. Target: published `@opencode/plugin@2.0.29`; upstream source commit `4397ee44d038a5f17bf6ac161431673d93e563b5`. This is a V2-only plugin, not a V1 compatibility shim.

Sources read:

- https://dev.opencode.ai/v2/docs/build/plugins/
- https://dev.opencode.ai/v2/docs/compaction/
- https://dev.opencode.ai/v2/docs/api/
- https://github.com/anomalyco/opencode/tree/4397ee44d038a5f17bf6ac161431673d93e563b5/packages
- https://github.com/jmrona/opencode-plugins/tree/main/compaction

## Verified contracts

`Plugin.define({id, setup})`, `ctx.options`, disposable `session.hook`, abortable `event.subscribe`, `session.get`, `model.list`, and `session.compact` are public V2 interfaces. Plugin context methods return unwrapped data and reject errors. HTTP responses have a `data` envelope. There is no public session list on the plugin context: existing sessions are discovered on their next hook/event. Session info supplies parentID and cumulative tokens. Events have `data`, `created`, and a durable per-session sequence, not V1 `properties`.

`packages/core/src/session/runner/llm.ts` advances the inbox on every iteration, consumes steer compaction controls, runs native compaction, then continues with the existing continuation flag. There is no child-session exclusion. The context hook runs before every agent request, including continuations, but it is not a cancellation or compaction barrier. Requests are deferred outside hooks. Event delivery/admission can race the next boundary: enforcement is proactive and eventually queued, not a hard maximum on the very next prompt. An in-flight tool/model call cannot be preempted by this plugin.

`session.compact({sessionID,id,delivery:"steer"})` admits a durable inbox item. Equal requests merge, explicit IDs make retries idempotent. Acceptance is not success. `session.compaction.started`, `.ended`, and `.failed` distinguish execution outcomes. `.ended` contains summary text: never log the raw event. `.started` has inputID but `.ended` does not; track the session's single compaction lifecycle. Native automatic compaction is also observed.

`packages/core/src/session/usage.ts` stores noncached input, visible output, reasoning, cache read and cache write independently. `packages/ai/src/protocols/openai-chat.ts` subtracts cached tokens from prompt_tokens and handles DeepSeek cache-hit fields. Prompt = input + cache.read + cache.write. Output totals including reasoning = output + reasoning. Zero normalized usage can mean missing provider metrics. Raw `contextTokens` exists in some protocols but is not exposed by public step events; native provider compaction counts may differ from replay sizes.

`session.step.ended` reports each completed model step; it is not execution completion. `session.execution.*` tracks task outcomes. Failed steps may include usage. `session.get().tokens` supplies authoritative cumulative normalized totals without scanning transcript history. A previous prompt measurement is exact only for that completed request and model, never for the assembled next request. The public context hook supplies assembled content for approximate fallback estimation.

Model limits are read only. Input capacity is constrained by explicit input and by context minus reserved output where both are known. The plugin conservatively reserves limit.output (or an explicit outputReserveTokens option) rather than pretending context is all available for input. OpenCode's own buffer policy differs and remains intact.

## Reference implementation comparison

jmrona uses V1 `@opencode-ai/plugin`, `message.updated`, `session.idle`, `session.summarize`, and an experimental compaction prompt hook. It intentionally skips children and waits for idle after experiencing truncated tool loops. We retain its lessons about acceptance versus completion and cooldowns, but use none of those hooks or its prompt modifications. V2's durable control path directly addresses the idle-only limitation.

## Validation boundary

SDK compilation and mock adapter tests can verify plugin contracts. A live V2 server is not installed here; no real-provider or Superpowers execution has been established. The optional live script must be run against a disposable V2 session and endpoint before claiming deployment validation. See compatibility.md for degraded capabilities and recovery behavior.
