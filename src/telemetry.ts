import { mkdir, open, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import type { Config, TelemetryEvent, TelemetrySink } from "./types.ts";
export function defaultPath(directory: string): string {
  const key = createHash("sha256").update(directory).digest("hex").slice(0, 16);
  return join(
    process.env.XDG_STATE_HOME || join(homedir(), ".local/state"),
    "opencode-context-guard",
    `${key}.jsonl`,
  );
}
export class JsonlTelemetrySink implements TelemetrySink {
  private pending: string[] = [];
  private working: Promise<void> | undefined;
  private disabled = false;
  private bytes = 0;
  private ready = false;
  constructor(
    readonly path: string,
    private readonly config: Config["telemetry"],
  ) {}
  emit(event: TelemetryEvent): void {
    if (!this.config.enabled || this.disabled) return;
    // Serialize now: mutable session state must not change a queued record.
    const line = JSON.stringify({ schema: 1, ...event }) + "\n";
    if (!this.config.jsonl) {
      console.error(line.trimEnd());
      return;
    }
    if (this.pending.length >= 256) {
      console.error("context-guard: telemetry queue full; record dropped");
      return;
    }
    this.pending.push(line);
    this.kick();
  }
  private kick(): void {
    if (!this.working && !this.disabled)
      this.working = this.drain().finally(() => {
        this.working = undefined;
        if (this.pending.length) this.kick();
      });
  }
  private async drain(): Promise<void> {
    try {
      if (!this.ready) {
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        this.bytes = await stat(this.path)
          .then((s) => s.size)
          .catch(() => 0);
        this.ready = true;
      }
      while (this.pending.length) {
        const line = this.pending.shift();
        if (!line) continue;
        const size = Buffer.byteLength(line);
        if (size > this.config.maxBytes) continue;
        if (this.bytes + size > this.config.maxBytes) {
          await rename(this.path, `${this.path}.1`).catch((e) => {
            if (e.code !== "ENOENT") throw e;
          });
          this.bytes = 0;
        }
        const file = await open(this.path, "a", 0o600);
        try {
          await file.writeFile(line);
        } finally {
          await file.close();
        }
        this.bytes += size;
      }
    } catch {
      this.disabled = true;
      this.pending = [];
      console.error(
        "context-guard: telemetry unavailable (check path and permissions)",
      );
    }
  }
  async flush(): Promise<void> {
    while (this.working) await this.working;
  }
}
export async function readJournal(
  path: string,
  maxBytes = 16 * 1024 * 1024,
): Promise<unknown[]> {
  const records: unknown[] = [];
  for (const name of [`${path}.1`, path]) {
    const size = await stat(name)
      .then((s) => s.size)
      .catch(() => 0);
    if (!size) continue;
    const file = await open(name, "r");
    const buffer = Buffer.alloc(Math.min(size, maxBytes));
    try {
      await file.read(buffer, 0, buffer.length, Math.max(0, size - maxBytes));
    } finally {
      await file.close();
    }
    const lines = buffer.toString("utf8").split("\n");
    if (size > maxBytes) lines.shift(); // Tail begins inside an arbitrary record.
    for (const line of lines) {
      if (!line) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        /* Partial final writes are ignored. */
      }
    }
  }
  return records;
}
