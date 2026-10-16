# Native TUI verification — 2026-10-16

Installed official `@opencode/cli@2.0.29` under `/home/julius/.local`; `opencode` is on PATH and reports `opencode v2.0.29`. npm 12 required explicit permission for the package's native-binary postinstall:

```sh
npm install --global --prefix "$HOME/.local" \
  --allow-scripts=@opencode/cli @opencode/cli@2.0.29
```

The actual compiled OpenCode server and TUI ran against a loopback synthetic OpenAI-compatible HTTP provider. No model was downloaded and no paid provider or existing credentials were used. Configuration, sessions, logs and cache were isolated under `/tmp/guard-live-yi6kjkvw`; existing user/project OpenCode settings were not edited. Temporary server/TUI processes were stopped after verification.

The server loaded the repository through `opencode.json`; the separately configured TUI client loaded it through `cli.json` and connected to the authenticated HTTP server. Telemetry was disabled and Guard stayed in observe mode. A root, child and grandchild each completed an actual OpenCode request using synthetic response/usage data. The configured test model had context/input/output limits of 136000/128000/8000; the trigger was 100000 input tokens.

| Actual route | Terminal | Observed Guard input | Occupancy | Trigger presentation        | Result                                                |
| ------------ | -------- | -------------------- | --------- | --------------------------- | ----------------------------------------------------- |
| Root         | 160×50   | 96000 / 128000       | 75.0%     | near, 4000 until trigger    | Sidebar and slash-opened panel passed                 |
| Child        | 80×30    | 112000 / 128000      | 87.5%     | crossed, 12000 over trigger | Native panel action and current-session detail passed |
| Grandchild   | 40×20    | 64000 / 128000       | 50.0%     | fresh, below trigger        | Native panel action and narrow layout passed          |

The same TUI navigated through the plugin's row selection and Enter command from root to child to grandchild, resizing between routes. Distinct synthetic usage counts proved that each panel showed its actual current session. The child view preserved root-to-current ancestry and showed all three family rows. Fullscreen panels appeared on narrow layouts, and text/quantities remained readable without a persistent child sidebar.

The public `context-guard.monitor.v1` bridge returned three reported measurements with capacity 128000, preserved hierarchy, and delivered six valid changed batches during the replay. `bun run test:tui-live` ran with the disposable server/session configuration and passed its authenticated bounded read (one monitored session, zero unknown). Observe mode produced no automatic compaction admissions.

## Issues found and fixed

- The open command was registered in the default input mode. It now uses the public global keymap scope, making `/context-guard` work from the root prompt.
- The host's child composer hides the normal prompt and palette shortcut. A native `session.composer.top` action, **Context Guard: open panel**, now opens the panel on the child route without navigating back to its parent. No default global shortcut was added.
- The initial model catalog can precede provider initialization. Missing resident model limits now trigger retries with bounded exponential backoff from one to 60 seconds and update scalar snapshot capacity when metadata arrives. Metadata recovery alone never evaluates enforcement or admits compaction; an adapter regression test verifies that another native observation is required.

The public OpenTUI renderer fixture also exercises the actual entry's global command registration, clickable child action and disposal. Offline adapter tests cover catalog recovery without premature admission.

## Remaining scope

This verifies a real local OpenCode host with synthetic provider metrics. It does not certify real-provider token accuracy, live compaction/reclaim/continuation, model changes during provider execution, cross-machine remote routing/canonical aliases, tmux, Neovim terminal, or a 30-minute resource plateau. Those remain separate validation gates. The provider-driven `test:live` compaction script was not run against a genuine model.
