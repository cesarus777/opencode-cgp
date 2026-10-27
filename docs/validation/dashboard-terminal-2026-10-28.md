# Standalone terminal dashboard validation — 2026-10-28

Stage 3 of the [standalone dashboard plan](../plans/standalone-dashboard.md) is implemented. Validation began October 27 and completed October 28 on Linux x64. Browser delivery (stage 4), remaining combined release checks (stage 5), publication and a version bump are outside this milestone.

## Implementation and delivery

`context-guard dashboard tui [--server URL] [--directory PATH]` uses the existing connection and one shared controller/subscription. Overview wraps scalar tree rows, detail scrolls through every exposed snapshot field including full identifiers, and history exposes six metrics, four windows and exact sample/request inspection. Keyboard focus, scrolling and metric/sample selection stay in the terminal shell. Metric/sample changes issue no history reads. Location selection rebinds the same authenticated connection; remembered locations are bounded to four and are not server-wide discovery.

The renderer is the existing **optional peer**, `@opentui/core`, validated at **0.5.17**. No SDK upgrade, new required dependency, Solid import, native panel registration, monitor or history collector was added. The application uses public `createCliRenderer`, `TextRenderable`, key/resize events and `destroy`; the renderer factory also destroys itself when terminal initialization fails. Tests inject startup and runtime failures after renderer creation and verify controller/listener disposal.

The command checks **Bun >=1.3.0**, interactive stdin/stdout and renderer availability before terminal takeover. Tested terminal runtime: **Bun 1.3.11**, downloaded as `@oven/bun-linux-x64@1.3.11` into `/tmp/guard-terminal-runtime/node_modules/@oven/bun-linux-x64/bin/bun`. Plugin/server/core and diagnostic CLI checks use **Bun 1.1.34**. The built CLI retains `import("@opentui/core")` inside the loader, with no eager renderer imports. The clean consumer loads server/core/RPC and produces offline reports with renderer peers absent.

For a clean client directory, install the built tarball and renderer together:

```sh
npm install /absolute/path/cesarus777-opencode-cgp-0.2.5.tgz @opentui/core@0.5.17
bun node_modules/.bin/context-guard dashboard tui
```

Use Bun >=1.3.0 for that launch. No Solid peer or preload is needed by the standalone command. Optional platform packages must be enabled when installing the renderer. An explicit remote server requires an absolute owning server path, passed unchanged. Authentication comes from `CONTEXT_GUARD_PASSWORD` and optional `CONTEXT_GUARD_USERNAME`; local discovery continues using `Service.discover()`/`Service.headers()`.

## Validation results

- Full offline suite: **161 passes**, including five focused terminal tests. These cover parsing/credential scope, focus, identity selection through updates, history presentation without extra reads, narrow widths, resizing, missing/stale/partial labels, full field exposure and initialization/runtime cleanup through public native renderer support.
- Typecheck, formatting and build pass.
- Clean-package smoke passes: 49 allowlisted files, renderer-free server/core/RPC, help, old-runtime and missing-peer failures in real PTYs before alternate-screen takeover, 16 installed adapter tests, renderer-free offline report generation, installed standalone live smoke, native TUI rendering/reactivity/disposal and consumer declarations.
- The connection/controller regression probe passes again on **both supported hosts**, including service discovery/authentication, inventory pagination, monitor events, history, scalar privacy and unknown usage.
- Standalone synthetic-provider PTY smoke passes on **OpenCode 2.0.29 and 2.1.2** with the native TUI closed. The 2.1.2 check also passes using the clean-installed CLI.

Exact host binaries:

| Host   | Executable                                                                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------ |
| 2.0.29 | `/tmp/guard-terminal-host-2029/node_modules/@opencode/cli-linux-x64/bin/opencode`, from `@opencode/cli-linux-x64@2.0.29` |
| 2.1.2  | `/home/julius/.local/lib/node_modules/@opencode/cli/bin/opencode.exe`, installed `@opencode/cli@2.1.2`                   |

The PTY fixture starts an isolated authenticated host, creates a root and two concurrent children, streams a synthetic provider's responses, and exercises agent/model attribution, overview/detail/history, all six metrics and all four windows, full session identity search/selection, metric changes without extra history reads/streams, help and resizing from 180 to 24 to 100 columns. It stops and restarts the host behind a stable loopback proxy, checks stale labels, retained occupancy with unknown pressure, recovery, partial timing and unique retained request IDs. Quit, Ctrl+C and SIGTERM restore canonical input/echo, cursor and alternate screen. The installed artifact check covers ordinary quit; additional built-command signal checks cover both host versions.

Provider content, titles and credentials use random privacy canaries. Every captured PTY chunk is checked; diagnostics are checked separately. Failed UI assertions can retain a scalar frame only after canary checks. Successful runs retain no terminal content or host logs.

## Reproduction

With the two absolute binary/runtime paths above, run:

```sh
bun run format:check
bun run typecheck
bun test
bun run build
GUARD_DASHBOARD_HOST=1 bun run test:dashboard-spike
GUARD_DASHBOARD_HOST=1 GUARD_DASHBOARD_BINARY=/absolute/path/to/opencode-2.0.29 bun run test:dashboard-spike
GUARD_DASHBOARD_HOST=1 GUARD_DASHBOARD_BUN=/absolute/path/to/bun-1.3.11 bun run test:dashboard-terminal
GUARD_DASHBOARD_HOST=1 GUARD_DASHBOARD_BUN=/absolute/path/to/bun-1.3.11 GUARD_DASHBOARD_BINARY=/absolute/path/to/opencode-2.0.29 bun run test:dashboard-terminal
GUARD_PACKAGE_TERMINAL=1 GUARD_DASHBOARD_HOST=1 GUARD_DASHBOARD_BUN=/absolute/path/to/bun-1.3.11 bun run test:package
```

Python 3 with `pyte` is required for the standalone PTY smoke; registry and loopback access are required for the clean-package check. Offline tests require neither network access nor downloads. Run them separately from compilation-heavy jobs. Both host opt-ins were enabled for this validation; their live checks were **passes, not skips**. The separate package-host registration probe and real-provider tests were not enabled by this milestone.

## Package impact

The final tarball measures **108,899 compressed bytes** and **457,777 unpacked bytes**, with 49 allowlisted files. The clean-installed validation tarball measured 108,204 compressed bytes and 455,656 unpacked bytes before the README usage addition; its executable code is the same. These are npm pack metadata, not directory sizes. Renderer packages remain external and are excluded from the plugin tarball.

An isolated `npm install --ignore-scripts --no-audit --no-fund @opentui/core@0.5.17` with normal peer/optional resolution installed 12 packages. Packing those exact installed versions gives:

| Delivery                                           | Compressed tarball bytes | Unpacked package bytes |
| -------------------------------------------------- | -----------------------: | ---------------------: |
| `@opentui/core@0.5.17`                             |                2,312,111 |             13,728,413 |
| `@opentui/core-linux-x64@0.5.17`                   |                1,928,134 |              6,343,910 |
| All 12 renderer packages, including resolved peers |               10,613,967 |             50,652,697 |

Summing regular installed file lengths, excluding symlinks and including npm's installed lock metadata, gives **50,658,579 logical installed bytes**. This is installation footprint, not a compressed npm size or filesystem allocation measurement. Download totals sum package tarballs and exclude registry metadata, HTTP overhead and the separate Bun runtime.

The remaining packages were `ansi-regex@6.4.0`, `bun-ffi-structs@0.3.1`, `diff@9.0.0`, `emoji-regex@10.6.0`, `get-east-asian-width@1.7.0`, `marked@17.0.1`, `string-width@7.2.0`, `strip-ansi@7.1.2`, `typescript@5.9.3` and `web-tree-sitter@0.25.10`. Resolved peers account for a substantial part of the footprint; other npm versions, platforms or peer policies may differ. Reproduce by installing into an empty directory, reading its lockfile and packing the actually installed package versions with `npm pack --json`. Existing server consumers acquire none of this optional renderer setup.

## Limits

This validates local authenticated HTTP with synthetic usage and public SDK 2.0.29. It does not certify cross-machine HTTPS, real-provider accounting, other OS/CPU combinations, tmux/Neovim interaction or long-term resource behavior. History points expose no per-sample token-source field, so the UI states that source is not retained and explains estimated live TPS/reported cumulative output semantics. Exact request timing/IDs/partial indicators are exposed where retained. Incomplete history is labeled and gaps are preserved; no unknown values are replaced with zeros. Enforcement suspended by the server stays suspended across UI recovery.
