# Compaction preservation validation

Validated in the Linux x64 workspace with the pinned `@opencode/plugin` and `@opencode/client` 2.0.29 SDKs. Bun 1.1.34 runs offline tests, type checking, formatting and packaging; the synthetic host harness uses Bun 1.3.11.

## Host checks

The built plugin passed `scripts/preservation-live.ts` separately on actual **OpenCode 2.0.29** and **OpenCode 2.1.2**. Each run used an isolated temporary project/config/storage tree, a local OpenAI-compatible synthetic provider, and generated disposable credentials. The harness checks:

- Original Unicode/multiline request text in deterministic custom checkpoints, with versioned native metadata.
- Repeated compaction and recovery of the original text after host restart.
- Protected text in the first assembled context, including continuation hooks that precede observer processing of the ended event.
- A custom checkpoint during an unfinished tool turn followed by native continuation.
- Provider-reported post-compaction tokens below the captured threshold and an explicit warning above it.
- Generation-endpoint failure followed by native compaction and an explicit preservation-fallback warning.
- No private prompt/answer/summary canary in the diagnostic journal.

Both hosts reported every assertion as passed. Commands (after `bun run build`):

```sh
bun run test:preservation-live /path/to/opencode-2.0.29
bun run test:preservation-live /path/to/opencode-2.1.2
```

The public compaction hook's custom result, checkpoint metadata and experimental `ctx.generate.text` endpoint worked on both tested hosts. Genuine-provider behavior, remote deployments, other platforms/versions and semantic summary correctness remain **unverified**.

## Offline checks

The full offline suite passes 279 tests. Added coverage includes delimiter collisions, overlapping first/latest requests, first unfinished turns, exact Unicode/multiline text, repeated checkpoint metadata integrity, revert boundaries, absent/oversized history, generation failure/empty output, opaque state, opt-out, all threshold types at/below/above the boundary, request starts spanning completion, missing/stale readings, model changes, independent concurrent children, duplicate events, early continuation contexts, warning retention/replacement, restart degradation, optional older records, narrow display warnings and scalar-only snapshots/diagnostics.

`bun run typecheck`, `bun run format:check`, build, and `bun run test:package` all pass. Package validation checks 72 allowlisted files, installs the packed artifact in a fresh consumer, runs the adapter behavior suite against its built entrypoint, renders the native TUI with shared Solid state, and compiles consumer declarations. Registry access is required. Its optional installed-host dashboard PTY is skipped; the separate two-host preservation harness above passes. Genuine-provider live validation is separate from these synthetic and offline passes.
