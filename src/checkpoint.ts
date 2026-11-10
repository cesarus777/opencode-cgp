import { createHash } from "node:crypto";
import type { SessionMessageInfo } from "@opencode/client";
import {
  constructCheckpoint,
  selectProtected,
  type ProtectedContext,
  type TranscriptEntry,
} from "./preservation.ts";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function record(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
export function readCheckpoint(
  summary: string,
  metadata: unknown,
): TranscriptEntry["checkpoint"] {
  if (!record(metadata)) return;
  const v = metadata.guardPreservation;
  if (
    !record(v) ||
    v.version !== 1 ||
    typeof v.originalId !== "string" ||
    !Array.isArray(v.boundaries) ||
    v.boundaries.length !== 3 ||
    !Array.isArray(v.hashes)
  )
    return;
  const sections: string[] = [];
  for (let i = 0; i < 3; i++) {
    const b: unknown = v.boundaries[i];
    if (
      !record(b) ||
      typeof b.start !== "number" ||
      typeof b.end !== "number" ||
      !Number.isSafeInteger(b.start) ||
      !Number.isSafeInteger(b.end) ||
      b.start < 0 ||
      b.end < b.start ||
      b.end > summary.length
    )
      return;
    const text = summary.slice(b.start, b.end);
    if (hash(text) !== v.hashes[i]) return;
    sections.push(text);
  }
  const [original, middle, latest] = sections;
  if (original === undefined || middle === undefined || latest === undefined)
    return;
  return { originalId: v.originalId, original, middle, latest };
}
export function sourceContext(
  messages: readonly SessionMessageInfo[],
  boundary?: string,
) {
  const end =
    boundary === undefined
      ? messages.length
      : messages.findIndex((m) => m.id === boundary);
  if (end < 0) throw new Error("history-unavailable");
  return selectProtected(
    messages.slice(0, end).map((m): TranscriptEntry => {
      if (m.type === "user") return { id: m.id, type: m.type, text: m.text };
      if (m.type === "assistant")
        return {
          id: m.id,
          type: m.type,
          text: m.content
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join(""),
          work: m.content
            .map((p) =>
              p.type === "text"
                ? p.text
                : p.type === "tool"
                  ? `Tool ${p.name}: ${p.state.status}\n${
                      "content" in p.state
                        ? (p.state.content
                            ?.filter((c) => c.type === "text")
                            .map((c) => c.text)
                            .join("\n") ?? "")
                        : ""
                    }`
                  : "",
            )
            .filter(Boolean)
            .join("\n"),
          complete:
            m.time.completed !== undefined && m.finish === "stop" && !m.error,
        };
      if (m.type === "compaction" && m.status === "completed") {
        const checkpoint = readCheckpoint(m.summary, m.metadata);
        if (m.metadata?.guardPreservation && !checkpoint)
          throw new Error("checkpoint-integrity-failed");
        return {
          id: m.id,
          type: m.type,
          complete: true,
          text: m.summary,
          ...(checkpoint ? { checkpoint } : {}),
          opaque: !!m.providerState || !!m.providerContext,
        };
      }
      return {
        id: m.id,
        type: m.type,
        ...("text" in m ? { text: m.text } : {}),
      };
    }),
  );
}
export function checkpointResult(
  source: ProtectedContext,
  summary: string,
  nonce: string,
) {
  const c = constructCheckpoint(source, summary, nonce);
  return {
    summary: c.text,
    metadata: {
      guardPreservation: {
        version: c.version,
        originalId: c.originalId,
        boundaries: c.boundaries,
        hashes: [source.original, summary, source.latest].map(hash),
      },
    },
  };
}

/** Inspect only actual text parts; serialized JSON escaping must not change the comparison. */
export function assembledText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(assembledText);
  if (!record(value)) return [];
  if (
    value.type === "reasoning" ||
    value.type === "tool-result" ||
    value.type === "tool-call"
  )
    return [];
  if (typeof value.text === "string") return [value.text];
  return value.content !== undefined ? assembledText(value.content) : [];
}
