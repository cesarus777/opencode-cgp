# Standalone terminal dashboard: implementation handoff

Prepared 2026-10-27 for a new implementation session. This continues **stage 3** of [the standalone dashboard plan](standalone-dashboard.md).

## Starting state

- `046af72` implements the connection spike.
- `09681fe` implements the shared controller. The working tree was clean when this handoff was prepared.
- The package is `@cesarus777/opencode-cgp@0.2.5`; the executable is `context-guard`.
- Stages 1 and 2 passed against OpenCode 2.0.29 and 2.1.2, with `@opencode/client@2.0.29` and the native TUI closed. The full offline suite passed 156 tests. Read [connection validation](../validation/dashboard-connection-2026-10-22.md) and [controller validation](../validation/dashboard-controller-2026-10-22.md) for the precise limits of these checks.
- Neither dashboard frontend nor its CLI commands exist yet. The controller live probe uses unmeasured sessions and an empty history window. Populated metrics in a standalone terminal still need validation.

Read `AGENTS.md` and its referenced RTK instructions before working. Recheck the current checkout and installed tools; temporary binaries, fixtures and cached dependencies from earlier sessions may no longer exist. Do not repeat completed stages or infer that earlier live results certify new UI behavior.

## Deliverable

Implement and validate:

```sh
context-guard dashboard tui [--server URL] [--directory PATH]
```

The application must run independently of OpenCode's native TUI. It must provide overview, selected-session detail and history screens, keyboard navigation, search/filters, refresh, explicit location selection and help. Reuse the shared controller as the application state owner. Browser delivery is stage 4; complete this terminal milestone first.

## Existing implementation to reuse

| File                                                           | Responsibility                                                                                                       |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/dashboard/connection.ts`                                  | One authenticated SDK client; discovery; explicit location binding; monitor/history reads; scalar session projection |
| `src/dashboard/port.ts`                                        | SDK-independent read-only controller port                                                                            |
| `src/dashboard/controller.ts`                                  | Start/stop, subscribers, location/session selection, screen/window/filter state and refresh                          |
| `src/dashboard/view.ts`                                        | Immutable view contract, four history windows, matched request summaries and completeness notices                    |
| `src/dashboard/inventory.ts`                                   | Bounded root/child pagination and partial inventory notices                                                          |
| `src/tui/transport.ts`                                         | Snapshot reconciliation, gaps, epochs, retries and bounded reads                                                     |
| `src/tui/chartformat.ts`                                       | Six metric definitions and renderer-independent terminal plots                                                       |
| `src/tui/format.ts`                                            | Existing terminal text formatting and width handling                                                                 |
| `src/cli.ts`                                                   | Current Bun CLI dispatch; journal, metrics and report commands                                                       |
| `scripts/build.ts`, `scripts/package-smoke.ts`                 | Bundled CLI and clean-package verification                                                                           |
| `scripts/dashboard-spike.ts`, `scripts/metrics-server-live.ts` | Disposable host/auth/controller probe and existing synthetic provider fixtures                                       |

Reuse pure helpers where their readonly types and semantics fit. Do not import `src/tui.tsx`, native panel registration or `@opencode/plugin/tui` into the standalone application. Do not create a second monitor, history collector or RPC contract.

## Implementation sequence

### 1. Resolve terminal runtime and dependency delivery

Inspect the installed public renderer API and test a minimal standalone renderer lifecycle before building the screens. The candidate is `@opentui/core@0.5.17` directly, using text/table renderables without Solid.

This renderer declares Bun `>=1.3.0`, while the plugin package declares Bun `>=1.1.34`. Prefer a terminal-command-specific Bun version check, preserving existing plugin/CLI compatibility. Report the requirement before entering the alternate screen. If a compatible renderer is chosen instead, document the evidence and dependency tradeoff.

Keep renderer runtime loading lazy and verify the built artifact actually preserves that boundary. Server/core imports and existing CLI commands must work without renderer peers. Decide whether terminal setup uses the current optional peer or a separately delivered optional dependency; document exact installation instructions and measure packed/download/install impact rather than reporting directory sizes as npm package sizes. Pin the renderer used for validation.

Prove renderer startup, ordinary exit and cleanup after initialization failure. Record the supported Bun/runtime combination. Do not upgrade the OpenCode SDK merely to add a standalone renderer.

### 2. Add CLI dispatch and connection setup

- Add `dashboard tui` parsing and command-specific help. Reject unknown flags, missing values and unsupported modes clearly. Preserve existing CLI behavior.
- Resolve the local default directory to an absolute path. For an explicit remote server, pass the supplied owning directory as a server-side path rather than resolving it against the local machine. Require a directory if the server-side default cannot be established safely.
- Use `connectDashboard()` for service discovery or explicit URLs. Do not start an OpenCode server from the command.
- Map remote credentials from `CONTEXT_GUARD_PASSWORD` and optional `CONTEXT_GUARD_USERNAME` (default `opencode`). Keep secrets out of arguments, help examples, diagnostics and errors. Local discovery continues using `Service.discover()` and `Service.headers()`.
- Check interactive terminal availability and dependencies before terminal takeover. A noninteractive invocation should produce an actionable error and exit status.
- Construct one controller and subscribe once. Navigation must call its methods rather than directly issuing SDK requests.

### 3. Implement the terminal shell and overview

Keep terminal-only focus, scrolling, selected chart/sample and input-editing state separate from the controller's shared navigation/filter state.

Display connection/enforcement health, known monitored/active counts, location and completeness notices. Render a scrollable root/child tree with agent/model, prompt tokens/capacity, occupancy, trigger/headroom, pressure, compaction phase, live TPS and measurement age. Keep the selected row visible through updates and resizing; preserve selection by session ID rather than row index.

Use labels for missing, invalid, stale, estimated, partial, blocked and uncertain values. Missing metrics render as unknown/unavailable, never zero. Preserve occupancy during stale periods while pressure is unknown. Use the view's independent inventory/live/performance freshness labels. Sanitize terminal control sequences and respect display-cell widths.

Provide search, agent/model filters and an explicit location selector that can accept an owning absolute directory and show remembered locations. The controller currently remembers at most four locations; do not imply that this is complete server-wide location discovery.

### 4. Implement complete detail and history screens

Detail must show the complete exposed snapshot contract, including usage provenance/scope/confidence, limits/reserve, configured/effective threshold, peak, cumulative token/cache totals, compaction lifecycle/count/arming/reasons/timestamps and every performance field. Keep IDs inspectable in full through scrolling or a dedicated identifier view when narrow layouts abbreviate them.

History must support all six existing metrics and all four controller windows: five minutes, one hour, 24 hours and seven days. Reuse the existing six-row plotting semantics where practical. Add keyboard selection of exact samples/requests so timing, token source/partial indicators and request IDs are inspectable. Preserve gaps; do not interpolate unknown points. Display retention, downsampling, disabled/unavailable history, stale cached results and the 500-point/request bound.

Use the controller's matched request summaries. Presentation changes such as switching the displayed metric or inspecting a sample must not trigger new history reads. Window/session changes must retain existing cancellation and serialization behavior.

### 5. Complete keyboard handling, resizing and shutdown

Suggested bindings, subject to renderer conventions:

| Action                       | Binding                       |
| ---------------------------- | ----------------------------- |
| Move selection/scroll        | Up/Down, j/k, PageUp/PageDown |
| Overview/detail/history      | 1/2/3                         |
| Previous/next history metric | Left/Right                    |
| Choose history window        | w                             |
| Search                       | /                             |
| Agent/model filters          | f                             |
| Choose location              | l                             |
| Refresh                      | r                             |
| Help                         | ?                             |
| Cancel editor/go back        | Escape                        |
| Quit                         | q, Ctrl+C                     |

Typing into search/filter/location editors must take precedence over global shortcuts. Keep a discoverable help/footer in narrow layouts. Recompute layout on resize without restarting the controller or creating another stream.

Use one idempotent shutdown path for normal quit, supported termination signals, startup failures and runtime errors. Unsubscribe, stop the controller, dispose renderer/input/resize/signal listeners and restore raw mode/cursor/alternate screen. Avoid writing arbitrary exception objects or terminal session content to logs.

### 6. Verify the built and installed terminal command

Add focused offline tests for CLI parsing/credential handling, renderer loading boundaries, row/detail/history behavior, focus/navigation, narrow sizes, resize, missing/stale/partial values and cleanup. Use injected ports/clocks and public renderer test support; do not duplicate controller tests that already establish reconciliation semantics.

Add a standalone terminal live smoke using an isolated authenticated host and synthetic provider. Reuse/refactor existing fixtures carefully, without coupling to launching the native TUI. Exercise a root and concurrent children, populated streaming metrics/history, model/agent attribution, navigation, resize and exit. Check a stream interruption/server restart recovers with stale labels and no false zero measurements or duplicate request summaries. Privacy canaries must not appear in terminal captures or diagnostics.

Extend clean-package smoke coverage to launch the installed terminal CLI with its documented renderer setup. Check missing-peer/unsupported-runtime errors and existing server imports without renderer modules. No publication or version bump is required for this milestone.

## Validation gates

```sh
bun run format:check
bun run typecheck
bun test
bun run build
bun run test:package
GUARD_DASHBOARD_HOST=1 bun run test:dashboard-spike
```

Add and document a reproducible command for the standalone synthetic-provider PTY smoke. Validate supported OpenCode 2.0.29 and 2.1.2 hosts, recording the exact binaries and terminal runtime used. Do not assume either host version is still installed. Live skips must be reported separately from passes.

Run the full offline suite separately from compilation-heavy jobs: a previous parallel run exceeded the native renderer fixture's five-second deadline, while a standalone rerun passed. Do not broaden or repeat tests after the relevant checks pass unless there is a concrete remaining failure or risk.

Update README usage, testing/compatibility documentation, the parent plan's progress and a dated validation record. Retain captures containing only approved scalar dashboard fields, if useful for review.

## Acceptance for this session

The built and clean-installed command connects to a configured host, runs while the native TUI is closed, exposes overview/details/all six history metrics for root and concurrent children, and exits with the terminal restored. Unknown/stale/partial/provenance labels remain accurate. Multiple screens and navigation share one controller/stream. Renderer requirements and installation/package impact are documented, and existing server/CLI consumers remain usable under their supported runtime.

Stage 4 (browser bridge/UI) and stage 5's remaining combined release checks follow this milestone. Do not claim either is complete from terminal validation. Stage or commit only if requested in the new session.

## Prompt for the new session

> Implement stage 3 using `docs/plans/standalone-dashboard-terminal.md`. Stages 1 and 2 are committed through `09681fe`. Follow the parent dashboard plan and repository instructions, resolve the standalone renderer/runtime boundary first, then implement and validate the terminal MVP through the clean-installed CLI and synthetic-provider PTY smoke. Continue autonomously within this scope; report actual validation results and remaining limitations.
