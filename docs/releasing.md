# Building and releasing

## Package identity

Publish as **`@cesarus777/opencode-cgp`**. Version **0.2.3** is already public; **0.2.5** adds continuous context charts, shared sidebar/panel traces, confirmed compaction drops and local OpenCode 2.1.2 validation. The requested unscoped `opencode-context-guard` name is occupied by a different repository/maintainer, so the maintainer selected this scoped name. The plugin ID remains `context-guard`; existing options, RPC IDs and `opencode-context-guard` diagnostic storage paths stay unchanged. Verify registry availability before each release.

## Local validation

Use Bun **1.1.34** (the tested minimum) and Node **22.14.0** with npm **11.21.0**, matching CI. Newer tools require their own validation. Local packaging also supports npm 12's keyed JSON pack report. Install with `bun install --frozen-lockfile`; `prepare` builds the checkout, so TypeScript and renderer build dependencies must be installed.

```sh
bun run format:check
bun run typecheck
bun test
bun run build
npm pack --dry-run
bun run test:package
```

`bun run validate` includes formatting, types, offline tests and the packed smoke test. Only the packaging smoke test requires npm registry access. It runs `npm pack` with lifecycle scripts, inspects the file allowlist, installs without scripts/dev/renderer peers in a temporary directory, resolves every export through the public V2 host resolver, imports server/core/RPC, and reuses adapter tests against the installed plugin. It then installs the tested host renderer modules and checks compiled TUI setup, native rendering, shared Solid reactivity, click handling and cleanup using public runtime support. Finally it compiles a TypeScript consumer of all public exports. Temporary files and installations are removed even on failure; failure diagnostics go to ignored `.artifacts/` and are uploaded by CI. No workspace symlinks are used.

## Package layout and runtime boundary

| Export             | Runtime         | Declaration             |
| ------------------ | --------------- | ----------------------- |
| `.` and `./server` | `dist/index.js` | `dist/types/index.d.ts` |
| `./core`           | `dist/core.js`  | `dist/types/core.d.ts`  |
| `./rpc`            | `dist/rpc.js`   | `dist/types/rpc.d.ts`   |
| `./tui`            | `dist/tui.js`   | `dist/types/tui.d.ts`   |

Bun builds four ESM library entries and the CLI targeting Bun. Internal modules are bundled per entry; all package imports remain external. The public OpenTUI Solid build plugin compiles JSX ahead of publication to renderer primitives, preserving reactive semantics. It does not use React's JSX transform. There are no runtime assets or dynamic imports in the plugin and no source maps containing unpublished sources. TypeScript emits declaration siblings; a small build step changes their local source-extension references to `.js`, which TypeScript resolves to `.d.ts`. `dist/` is regenerated from scratch and ignored by Git. Only `dist/`, README, license and the npm manifest ship. The CLI ships as `dist/cli.js` with a Bun shebang and the `context-guard` npm executable. It supports diagnostics, metrics export and self-contained HTML chart reports without renderer peers.

`@opencode/plugin` and `@opencode/client` stay pinned runtime dependencies at 2.0.29; the client is also required by public declarations. OpenCode's runtime substitutes its public SDK modules. `solid-js`, `@opentui/core` and `@opentui/solid` remain optional peers for the TUI; they are development dependencies only for compilation and tests. Theme is a development dependency used by SDK types. The server never imports a renderer. OpenCode's native TUI provides shared runtime modules, including imports from installed JavaScript in node_modules. Bundling Solid/OpenTUI would break owner/context/module identity. Standalone consumers of `./tui` must provide compatible host modules and runtime support; plain Node is not a supported TUI host.

`prepack` builds npm artifacts. `prepare` additionally supports Git dependency builds and local installs; npm may run both hooks when packing, which is intentional and idempotent. Git consumers need a Bun executable and development dependencies. Root `server.ts`, `rpc.ts` and `tui.tsx` wrappers remain for direct checkout-directory loading; the tarball uses package exports instead. Production installation needs no compiler or lifecycle scripts.

These decisions follow [V2 publication guidance](https://dev.opencode.ai/v2/docs/build/plugins/#publish), [Bun external package imports](https://bun.sh/docs/bundler#packages), and [npm manifest rules](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/).

## Maintainer setup (external permissions required)

1. Confirm scope ownership and select an unused version. For a new package, an npm owner can bootstrap it with staged publishing and approve it with 2FA before configuring its trusted publisher. Do not place credentials in the repository.
2. Create a GitHub environment named `npm`, with required reviewers and deployment restrictions allowing only authorized `v*` tags. Protect release tags and the workflow/default branch against unauthorized changes. Neither workflow creates releases or pushes tags itself.
3. In npm package settings, configure a GitHub trusted publisher: owner **cesarus777**, repository **opencode-cgp**, workflow **release.yml**, environment **npm**. Leave **Allow npm publish** and **Allow npm dist-tag** unchecked; this workflow only stages packages. Use GitHub-hosted runners. Repository URL metadata must match the public GitHub repository for provenance.
4. Follow npm's [trusted publishing instructions](https://docs.npmjs.com/trusted-publishers/). Staged publishing requires Node ≥22.14 and npm ≥11.15.0; CI and this workflow pin npm 11.21.0. No `NPM_TOKEN` or `NODE_AUTH_TOKEN` secret is needed. After verifying OIDC, disable token-based publishing if appropriate. Configure a new publisher close to release time; npm documents expiry of unvalidated configurations.

For a first release, an authorized npm owner can run `npm login` and `npm stage publish --access public --tag latest` (or `--tag next` for a prerelease), then approve the staged package with 2FA on npmjs.com. This is an explicit release action: do not run it during ordinary validation. Local bootstrap does not receive GitHub provenance; subsequent tag releases use OIDC and provenance. See npm's [staged publishing instructions](https://docs.npmjs.com/staged-publishing/).

## Release

Update `package.json` to an unused semantic version, run `bun install` to refresh lockfile metadata, and commit the manifest/lockfile and documentation together after review. Run the full local validation suite. With explicit maintainer authorization, tag that commit `v<exact-package-version>` and push that tag. Ordinary branch pushes only validate.

The `release.yml` tag workflow checks exact tag/version equality and queries npm with its bounded-retry registry client: only a completed lookup reporting E404 for the requested version permits publication; network/auth/registry failures fail closed. A concurrency group serializes releases. All formatting, type, unit, built-export, pack and clean-install checks must pass. The `npm` environment approval controls execution. The workflow runs `npm stage publish --access public --provenance`, using OIDC without a registry token. Stable versions stage with the `latest` tag; prereleases stage with `next`. A successful workflow means the package is staged, not publicly released. Review the stage ID in the workflow log, inspect the package under **Staged Packages** on npmjs.com, and approve it with 2FA to publish it. Approval can also use an interactive `npm stage approve <stage-id>` session; OIDC cannot approve stages. npm refuses versions that are already published or staged; inspect an existing stage before retrying. The registry preflight only detects published versions. All third-party actions are pinned by commit; review their upstream changes before updating pins.

The failed `v0.2.0` direct-publish tag and `v0.2.4` registry-preflight attempt remain unchanged. Version `0.2.1` is the first attempt using this staged workflow.

## Rollback

Consumers can edit their existing package target to a previously verified exact version and restart OpenCode, preserving options and avoiding duplicate registrations. A maintainer can move `latest` back with `npm dist-tag add @cesarus777/opencode-cgp@<known-good-version> latest` using authorized npm authentication, and deprecate a bad release with `npm deprecate @cesarus777/opencode-cgp@<bad-version> '<reason>'`. Do not overwrite versions or use unpublish as routine rollback. This workflow does not grant OIDC dist-tag management; use an authorized maintainer session or separately configure that permission and an approved workflow. Publish a new fixed version afterward.

## Runtime evidence limits

The default packed smoke test covers isolated mocks and the public native renderer. The opt-in actual OpenCode 2.0.29 server registration/RPC check passed in observe and enforce modes without model requests. Neither proves native npm-manager fetching or real-provider compaction. Prior checkout verification used an actual local 2.0.29 server/TUI with a synthetic provider; interactive compiled-host TUI with the packed artifact remains unverified. For reproduction and provider checks, follow [testing](testing.md). OpenCode 2.1.2 is additionally covered by the [current local validation](validation/context-chart-2.1.2-2026-10-22.md); V1 and other V2 versions are not certified. Git installation preparation and GitHub Actions/OIDC execution must be verified in their real environments.
