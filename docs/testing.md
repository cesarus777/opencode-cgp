# Validation

```sh
bun install --frozen-lockfile
bun run typecheck
bun test
bun -e 'import plugin from "./src/index.ts"; console.log(plugin.id, typeof plugin.setup)'
bun run test:live
```

Unit tests use injected clocks/ports and cover threshold boundaries, policy precedence, invalid options, normalized accounting, missing metadata, model switching, concurrent children, lifecycle races, cooldown, hysteresis, explicit failures, ambiguous admission, timeout suppression, cleanup, recovery and the no-op controller. Mocked SDK integration emits real V2 event shapes while sessions remain active and verifies child/nested-child requests, subsequent completion/continuation, observe mode, location ownership, safety storage and disposal. Telemetry tests validate rotation/file permissions and execute the CLI. These tests download no models and make no network requests.

## Optional live V2 validation

Use an already running **2.0.29-compatible V2 server** and a disposable project directory configured with your existing local OpenAI-compatible provider. Configure the plugin there with `mode:"enforce"`, a token threshold appropriate to that model's first few tool exchanges (for example 8192), `minReclaimTokens:128`, and the normal cooldown. Keep the native recent-history setting small enough that compaction has something to reclaim. Do not change actual model metadata. The script does not install models, edit configuration, or configure provider credentials.

```sh
GUARD_SERVER_URL=http://127.0.0.1:PORT \
GUARD_TEST_DIRECTORY=/absolute/disposable/project \
GUARD_TEST_MODEL=local/deepseek \
bun run test:live
```

If the server requires authentication, provide the full authorization header value in `GUARD_AUTHORIZATION`. Do not place secrets in the sample configuration or commit them. The server URL/authentication must come from your installation; the script does not assume a V1 port or login mechanism.

The script creates a root and child via the public V2 client, prompts the child to make sequential harmless shell calls, records only lifecycle names/IDs/times, and checks that compaction completed **after tools and before a continuation and final successful execution**. Acceptance alone cannot pass. The provider may ignore the requested tool sequence or context may not reach the configured threshold; either case fails the criterion rather than pretending it was tested. Native auto-compaction can also produce events: inspect the plugin journal's `compaction.requesting`/policy records to confirm plugin causation. Sessions created by the script are removed in finally; it never removes existing user sessions.

The endpoint/model were not supplied in this workspace, so `test:live` was executed only in its explicit SKIP path. There is no live-provider or Superpowers compatibility certification. Repeat with your actual Superpowers workload before deploying enforcement broadly.

## Native TUI offline and transport checks

```sh
bun run format:check
bun run test:tui-live
bun run bench:tui
```

Implementation validation completed with `bun install --frozen-lockfile`, `bun run typecheck`, 88 passing offline tests across 10 files, `bun run format:check`, and `git diff --check`.

The offline suite includes immutable snapshot privacy, ratio/remaining boundaries, batching/tombstones, final adapter scheduler state with telemetry disabled, RPC retry/disposal, subscription bootstrap ordering, overflow/gaps/EOF, old-location cancellation, unknown-row baselines, request chunk/concurrency bounds, nested inventory pagination/resumption, cycles, family ordering and outcome reduction. A subprocess rejects renderer-module imports while loading server/core. Checkout-directory resolution and an installed package symlink exercise the public host resolver separately.

The public `@opentui/solid/preload` and `testRender` fixture renders the actual panel at 40 and 20 columns, navigates beyond the first 100 rows, updates route/width reactively and verifies cleanup/focus gating. Formatting checks also cover graphemes, CJK, emoji, terminal controls and narrow detail quantities. A shared-state test mounts sidebar/panel consumers and repeats acquire/dispose 1000 times, checking that no active subscription/listener survives. These offline tests do not launch an OpenCode binary. Separate actual-host verification is recorded in the [live TUI report](validation/tui-2.0.29-2026-10-16.md), including the native child action and current-session navigation.

For an observational RPC smoke check, supply `GUARD_SERVER_URL`, `GUARD_TEST_DIRECTORY`, and `GUARD_TEST_SESSION` for an existing disposable session, with optional `GUARD_AUTHORIZATION`. `bun run test:tui-live` subscribes and validates a bounded read; no prompts or compactions are issued. It skips when prerequisites are missing. Its read pass does not certify changed-event delivery without a real update, interactive geometry or remote canonical location aliases. The observational script subsequently passed against an authenticated real 2.0.29 server with synthetic-provider sessions; the provider-driven compaction script remains unverified. See the [live TUI report](validation/tui-2.0.29-2026-10-16.md).

The benchmark compares monitoring alone, projection without a TUI, and one/two consumer views. It replays 1000 fake sessions (100 active), 10 simulated seconds at 100 updates/s plus a one-second 1000 updates/s burst, through 100 ms publication ticks. It reports CPU time, projection/view p95, encoding size, map cardinalities and heap/RSS deltas. Input contains no provider content and creates no journal. This is accelerated replay, not a real-time host CPU percentage or a 30-minute memory-plateau measurement.

An implementation run on Linux, Bun 1.1.34, AMD Ryzen 5 5500U measured projection p95 around 2.1 ms and family view p95 3.2–4.8 ms with one/two consumers. Each view retained 1000 rows; the replay generated 118 bounded messages including eight bootstrap batches, about 1.65 MB encoded per client. Short-run heap/RSS deltas include allocation and GC effects and do not prove a leak or plateau. Re-run locally with `bun run bench:tui`; results vary with machine and warm-up.

Actual local 2.0.29 package loading, authenticated HTTP client/server transport, wide root sidebar/slash access, resized child/grandchild panel access and current-session navigation have now passed using a synthetic provider. Remaining gates are cross-machine remote aliases, tmux detach/resize, Neovim terminal focus, genuine-provider/model changes, live manual/Guard compaction and continuation, and 30-minute resource/idle CPU measurements. Synthetic usage validates integration and display arithmetic, not real-provider accounting accuracy.
