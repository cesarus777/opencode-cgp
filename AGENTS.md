# Repository Guidelines

## Project Structure & Module Organization

`src/index.ts` exports the OpenCode V2 plugin; `src/adapter.ts` contains SDK integration. Keep policy evaluation, monitoring, scheduling, and budget contracts in harness-independent modules exported through `src/core.ts`. Telemetry and CLI diagnostics live in `src/telemetry.ts` and `src/cli.ts`.

`tests/` contains core, mocked adapter, and telemetry tests. `scripts/live.ts` provides optional live-server validation. `examples/opencode.jsonc` demonstrates plugin registration and options. Consult `docs/architecture.md`, `docs/reconnaissance.md`, and `docs/compatibility.md` before changing lifecycle behavior.

## Build, Test, and Development Commands

Use Bun 1.1.34 or newer:

- `bun install --frozen-lockfile`: install pinned dependencies.
- `bun run typecheck`: check strict TypeScript without emitting files.
- `bun test`: run the offline unit and mocked integration suite.
- `bun run format`: format source, tests, scripts, examples, and documentation.
- `bun run format:check`: verify formatting before review.
- `bun run inspect /absolute/path/events.jsonl --history`: inspect retained diagnostics.
- `bun run test:live`: validate against a configured V2 server; explicitly skips without required environment variables. See `docs/testing.md`.

There is no separate build step; the plugin exports TypeScript directly.

## Coding Style & Naming Conventions

Follow Prettier defaults: two-space indentation, double quotes, and semicolons. Use explicit `.ts` extensions for local imports. Use PascalCase for classes and interfaces, camelCase for functions and variables, and descriptive lowercase module filenames.

Preserve strict typing, including unchecked-index and exact-optional-property checks. Avoid `any` and unchecked assertions. Domain modules must not import OpenCode packages.

## Testing Guidelines

Use `bun:test` and name files `*.test.ts`. Describe observable behavior in test names. Inject clocks and ports for deterministic lifecycle tests. Cover threshold boundaries, model changes, concurrent children, duplicate requests, failures, and recovery when modifying those paths. No numerical coverage target is configured. Offline tests must not require network access or model downloads; report live-test skips separately from passes.

## Commit & Pull Request Guidelines

The repository currently has no commits, so no established message convention exists. Use concise imperative subjects, such as “Fix compaction recovery after restart.” Keep changes focused.

PRs should explain the problem, behavior changes, validation commands/results, and compatibility limitations. Link related issues when available. Update examples and documentation when configuration or public contracts change.

## Safety Constraints

Preserve model metadata and native workflows. Never equate compaction admission with completion. Log only approved diagnostic fields, never prompts, summaries, credentials, or tool outputs. Verify public V2 APIs before introducing integration changes.
