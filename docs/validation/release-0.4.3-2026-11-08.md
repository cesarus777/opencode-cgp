# 0.4.3 release validation

Date: 2026-11-08. Candidate prepared for the tag-triggered npm staging workflow.

Restores Live TPS, average model/session TPS, and observed TTFT to the main sidebar session, visible descendants, and native panel agent rows. Existing performance collection and metric definitions are unchanged. README, configuration, sidebar description, historical plan annotation, and changelog describe the restored display.

## Validation

- `bun test`: 250 passed, 0 failed across 33 files.
- `bun run typecheck`, `bun run format:check`, and `git diff --check`: passed.
- The performance regression test checks each of five native formatting surfaces separately at 16, 20, 35, and 80 cells, including distinct model/session averages, estimated values, and partial coverage.
- `bun run test:package`: passed pack/build, 65-file allowlist, clean installation, public imports, 16 adapter tests, native TUI rendering/reactivity/disposal, exports, and consumer declarations. The first sandbox attempt failed DNS; the rerun with registry access passed.
- Installed standalone renderer and optional live PTY checks were skipped because the runtime is Bun 1.1.34 and host opt-ins were absent. No new live-provider validation was run.

## Publication

Version `0.4.3` is prepared for tag `v0.4.3`. The repository workflow stages npm publication with provenance; the staged package requires maintainer approval with 2FA before becoming public. A staged workflow success alone does not establish public availability.
