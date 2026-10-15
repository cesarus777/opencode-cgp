// Fallback only. No prompt content is retained or emitted. Work and traversal depth are bounded.
// This approximates serialized size, not a tokenizer or a guarantee about multimodal requests.
export function estimate(
  value: unknown,
  maxChars = 2_000_000,
): number | undefined {
  let chars = 0,
    nodes = 0;
  function visit(v: unknown, depth: number): boolean {
    if (++nodes > 100000 || depth > 30 || chars > maxChars) return false;
    if (typeof v === "string") chars += v.length;
    else if (typeof v === "number" || typeof v === "boolean") chars += 8;
    else if (Array.isArray(v)) {
      for (const item of v) if (!visit(item, depth + 1)) return false;
    } else if (v && typeof v === "object") {
      // Binary/media payloads cannot be estimated reliably using character counts.
      if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return false;
      for (const [key, item] of Object.entries(v)) {
        chars += key.length + 4;
        if (!visit(item, depth + 1)) return false;
      }
    }
    return chars <= maxChars;
  }
  return visit(value, 0) ? Math.ceil(chars / 3) : undefined;
}
