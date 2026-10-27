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

Earlier validation had no endpoint/model and executed only the explicit `test:live` SKIP path. The disposable synthetic-server harness added on 2026-10-20 now supplies both and exercises the completion criterion; see its report below. There is no live-provider or Superpowers compatibility certification. Repeat with your actual Superpowers workload before deploying enforcement broadly.

## Native TUI offline and transport checks

```sh
bun run format:check
bun run test:tui-live
bun run bench:tui
```

Implementation validation completed with `bun install --frozen-lockfile`, `bun run typecheck`, 88 passing offline tests across 10 files, `bun run format:check`, and `git diff --check`.

The offline suite includes immutable snapshot privacy, ratio/remaining boundaries, batching/tombstones, final adapter scheduler state with telemetry disabled, RPC retry/disposal, subscription bootstrap ordering, overflow/gaps/EOF, old-location cancellation, unknown-row baselines, request chunk/concurrency bounds, nested inventory pagination/resumption, cycles, family ordering and outcome reduction. A subprocess rejects renderer-module imports while loading server/core. Checkout-directory resolution and an installed package symlink exercise the public host resolver separately.

The public `@opentui/solid/preload` and `testRender` fixture renders the actual panel at 40 and 20 columns, navigates beyond the first 100 rows, updates route/width reactively and verifies cleanup/focus gating. Context chart tests cover the fixed capacity scale, threshold boundaries, missing/zero/overflow values, bounded deduplicated observations, held plateaus during pauses/missing/lower measurements, completion-gated drops, duplicate render stability, shared bounded traces across view remounts, session isolation and model/capacity resets. The sidebar renderer checks live updates and compaction drops with retained samples, threshold/pressure colors, narrow layouts and its updated reference frame. Formatting checks also cover graphemes, CJK, emoji, terminal controls and narrow detail quantities. A shared-state test mounts sidebar/panel consumers and repeats acquire/dispose 1000 times, checking that no active subscription/listener survives. These offline tests do not launch an OpenCode binary. Separate actual-host verification is recorded in the [live TUI report](validation/tui-2.0.29-2026-10-16.md), including the native child action and current-session navigation.

For an observational RPC smoke check, supply `GUARD_SERVER_URL`, `GUARD_TEST_DIRECTORY`, and `GUARD_TEST_SESSION` for an existing disposable session, with optional `GUARD_AUTHORIZATION`. `bun run test:tui-live` subscribes and validates a bounded read; no prompts or compactions are issued. It skips when prerequisites are missing. Its read pass does not certify changed-event delivery without a real update, interactive geometry or remote canonical location aliases. The observational script subsequently passed against an authenticated real 2.0.29 server with synthetic-provider sessions; the provider-driven compaction script remains unverified. See the [live TUI report](validation/tui-2.0.29-2026-10-16.md).

The benchmark compares monitoring alone, projection without a TUI, and one/two consumer views. It replays 1000 fake sessions (100 active), 10 simulated seconds at 100 updates/s plus a one-second 1000 updates/s burst, through 100 ms publication ticks. It reports CPU time, projection/view p95, encoding size, map cardinalities and heap/RSS deltas. Input contains no provider content and creates no journal. This is accelerated replay, not a real-time host CPU percentage or a 30-minute memory-plateau measurement.

An implementation run on Linux, Bun 1.1.34, AMD Ryzen 5 5500U measured projection p95 around 2.1 ms and family view p95 3.2–4.8 ms with one/two consumers. Each view retained 1000 rows; the replay generated 118 bounded messages including eight bootstrap batches, about 1.65 MB encoded per client. Short-run heap/RSS deltas include allocation and GC effects and do not prove a leak or plateau. Re-run locally with `bun run bench:tui`; results vary with machine and warm-up.

Actual local 2.0.29 package loading, authenticated HTTP client/server transport, wide root sidebar/slash access, resized child/grandchild panel access and current-session navigation have now passed using a synthetic provider. Remaining gates are cross-machine remote aliases, tmux detach/resize, Neovim terminal focus, genuine-provider/model changes, live manual/Guard compaction and continuation, and 30-minute resource/idle CPU measurements. Synthetic usage validates integration and display arithmetic, not real-provider accounting accuracy.

## Packed npm artifact

```sh
bun run test:package
```

This network-enabled check upgrades the former workspace-symlink export check to a real npm tarball installation. It verifies server imports without optional renderer peers, every public export, configuration, the existing adapter behavior suite against the installed default export, native compiled TUI rendering through public host runtime support, and consumer declarations. It uses no repository symlinks and removes its temporary installation on success or failure. See [package architecture](releasing.md#package-layout-and-runtime-boundary).

The native renderer fixture deliberately installs `solid-js@1.9.15` with `@opentui/solid@0.5.17`, matching the inspected OpenCode 2.0.29 host. That renderer declares a narrower Solid peer version, so this test uses npm's `--legacy-peer-deps` while supplying the exact tested host modules explicitly. Server-only installation also bypasses peer auto-installation and omits optional dependencies to prove the renderer is not required. This does not change consumers' dependency resolution or bundle host modules into the package.

For an actual installed **OpenCode V2 2.0.29** executable on PATH, additionally run:

```sh
GUARD_PACKAGE_HOST=1 bun run test:package
```

This starts disposable loopback servers in observe and enforce mode with separate XDG configuration/data/cache/state directories, registers the **installed tarball's built directory**, checks native plugin registration, and reads the public RPC snapshot health. It makes no model requests, uses a generated temporary authentication password, does not modify real configuration, and stops its servers before removing temporary resources. Native npm-manager installation cannot be tested until the first registry publication. This actual-server check does not exercise compaction or the compiled host's interactive TUI; the default smoke test separately renders the packed TUI using OpenTUI's public test renderer.

To verify interactive packed TUI and real-provider behavior before production enforcement:

1. Run `npm pack --pack-destination /absolute/disposable/artifacts` from the checkout. In a separate disposable directory, use `npm install /absolute/disposable/artifacts/cesarus777-opencode-cgp-0.1.0.tgz`. Do not pass the tarball to `opencode plugin add`, which rejects tarball targets.
2. Set `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, and `XDG_CACHE_HOME` to separate directories under that disposable root for **every** host command. Keep the source checkout outside the project being opened. Register the absolute installed `node_modules/@cesarus777/opencode-cgp/dist` directory in the disposable project's `opencode.jsonc`, preserving the options from the normal example. Put the same absolute installed `dist` directory in the isolated `cli.json` plugin list. Built-directory registration avoids fetching an unpublished npm version. The inspected 2.0.29 config loader requires directories for explicitly configured local plugins, despite newer live documentation also describing direct files.
3. Configure a local OpenAI-compatible provider in that disposable project, as described above. Start `opencode serve --hostname 127.0.0.1 --port <free-port>` with a generated `OPENCODE_PASSWORD` value; use that password for the client connection. Never record credentials in diagnostic artifacts.
4. In another terminal with the same isolated XDG environment and password, start `opencode --server http://127.0.0.1:<free-port> /absolute/disposable/project`. Check root/child/grandchild sidebar/panel access, `/context-guard`, row navigation and narrow layouts using the [existing checklist](validation/tui-2.0.29-2026-10-16.md). Exercise observe first, then enforce with a deliberately low threshold in this disposable configuration.
5. Run the existing `test:live` with `GUARD_SERVER_URL`, `GUARD_TEST_DIRECTORY`, `GUARD_TEST_MODEL`, and the full Basic `GUARD_AUTHORIZATION` header. Use `test:tui-live` with a disposable session ID to check transport. Confirm **completed** compaction and continuation, not admission alone. Stop hosts and delete only the temporary root afterward.

Interactive packed-host TUI, synthetic/real-provider compaction, and native npm-manager installation remain separate checks; do not infer them from a passing registration or mock test. GitHub Actions/OIDC cannot be certified by local validation.

Packed validation executed on 2026-10-16 with Bun 1.1.34, Node 26.11.1 and npm 12.2.0: default clean-install smoke passed; nine installed adapter regressions passed; native renderer and declaration consumer passed. The opt-in actual OpenCode 2.0.29 server registration/RPC checks passed in both modes without model requests. CI pins Node 22.14.0/npm 11.6.2; execution on that toolchain and GitHub-hosted runners still needs a CI run. Existing provider-driven `test:live` and remote `test:tui-live` executed their explicit SKIP paths because their required endpoint/session variables were not supplied.

## Performance and history validation

For a disposable actual OpenCode 2.0.29 or 2.1.2 server with a deterministic local SSE provider, run `bun run build` followed by `bun run test:metrics-server-live`. No provider credentials or model downloads are needed. Add `GUARD_SYNTHETIC_TUI=1` for actual compiled-host PTY checks, including context holds, child permission waits/activity, lower usage and manual compaction at 180/80 columns (Python 3 with `pyte` and Pillow plus `fc-match` required; scalar chart captures go to `.artifacts/context-*.png`), and `GUARD_SYNTHETIC_BROWSER=1` for Firefox report rendering. This creates isolated project/configuration/data/cache/state directories and removes them afterward. Loopback listeners and the optional package check need the appropriate sandbox/network access. See the [2026-10-20 live metrics report](validation/metrics-2.0.29-2026-10-20.md) for commands, evidence and pinned-host limitations. Synthetic-provider results do not certify genuine-provider accounting. See also the [context continuity validation](validation/context-chart-2.0.29-2026-10-22.md).

The offline suite covers fractional chunk estimates, rolling expiry, TTFT, weighted model averages, idle/session averages, concurrent session identity, duplicate deltas/durable events, missing timing/usage, restart checkpoints, v1/v2 selection and narrow performance formatting. Adapter tests verify streamed deltas perform no metadata reads or checkpoint writes. History tests cover age/cap rotation, dropped-record markers, restricted file permissions, scalar privacy, bounded filtered exports, malformed tails and filesystem failure isolation.

For an observational comparison against a real provider, set `GUARD_SERVER_URL`, `GUARD_TEST_DIRECTORY`, and `GUARD_TEST_SESSION` (plus optional `GUARD_AUTHORIZATION`) and run `bun run test:metrics-live`. Start a request manually in that disposable session during its 60-second observation window. The script independently derives request TPS/TTFT from public events and compares the completed request with v2 RPC. It does not prompt, compact, or log generated content. Without configuration it explicitly skips; without a complete matching request it fails. For a fast continuing agent, a later request can replace the latest projection before comparison; repeat with a single-response request. This check has not been run against a real provider as part of this implementation.

Chart tests cover same-name session separation, timestamp ordering, duplicate request identities, captured model attribution, explicit/inferred gaps, unknown usage, bounded extrema-preserving downsampling, terminal gaps/narrow widths, escaped HTML payloads and executable client syntax, scoped CLI generation, and overwrite protection. The native OpenTUI fixture verifies panel padding, a fixed close/back hint after scrolling, single-metric charts, left/right cycling (including wraparound without extra history reads), the selected session/window, explicit close, and one shared consumer. History RPC tests verify ownership, invalid path/range rejection, gap retention and disabled status. Package validation generates a report using the packed CLI before installing renderer peers.

The [OpenCode 2.1.2 validation](validation/context-chart-2.1.2-2026-10-22.md) repeats the server/TUI checks on the latest stable host. The synthetic fixture selects the appropriate provider runtime and reasoning capability schema and waits for its models to become available before prompting.

## Standalone dashboard connection spike

Run `bun run build`, then `GUARD_DASHBOARD_HOST=1 bun run test:dashboard-spike` to validate the standalone read transport against an installed OpenCode binary with its native TUI closed. Set `GUARD_DASHBOARD_BINARY` to an absolute binary path to check another version. The opt-in fixture creates only disposable sessions in isolated directories, uses generated loopback authentication, validates service discovery, root pagination, child inventory, live monitor events and bounded history, and cleans up afterward. Without opt-in it reports a skip. Offline dashboard connection tests use injected fetch fixtures and do not open network connections. See the [2.0.29/2.1.2 connection validation](validation/dashboard-connection-2026-10-22.md) for results and remaining runtime gates.

The probe also starts the shared dashboard controller, selects a child, loads its history and verifies that session titles, metadata and credentials are absent from its view model. Run `bun test tests/dashboardconnection.test.ts tests/dashboardinventory.test.ts tests/dashboardcontroller.test.ts tests/dashboardview.test.ts` for deterministic offline coverage of inventory limits, live reconciliation, cancellation, history/cache bounds, immutable views and scalar privacy. See [controller validation](validation/dashboard-controller-2026-10-22.md) for the behavior and live-check limits.
