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
