# Release 0.3.1 validation — 2026-10-29

Scope: automatic installation of the standalone dashboard renderer and clearer CLI help.

- Formatting, strict TypeScript checks and all 176 offline tests pass on Bun 1.1.34.
- A clean tarball installation includes OpenTUI and its native platform library without an additional renderer installation. Creating and destroying its public test renderer passes on Bun 1.3.11.
- The installed CLI passes interactive PTY preflight checks: Bun 1.1.34 reports the supported-runtime requirement, and Bun 1.3.11 loads the renderer and reaches URL validation without taking over the terminal.
- Server/core/RPC imports, offline charts and model analytics still pass on Bun 1.1.34. All 16 adapter regressions pass against the installed package.
- Registry preflight confirms that 0.3.0 is public and 0.3.1 is unused before release preparation.

Validation command:

```sh
GUARD_DASHBOARD_BUN=/tmp/guard-terminal-runtime/node_modules/@oven/bun-linux-x64/bin/bun bun run validate
```

The actual-server terminal smoke is skipped in this patch validation; the preceding [0.3.0 validation](release-0.3.0-2026-10-28.md) covers that path. This patch does not certify other platforms, real-provider timing or cross-machine clients. A successful tag workflow stages the npm package; maintainer approval with 2FA is required before public publication.
