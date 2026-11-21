/** One line of a stream-json stdout, parsed or reported. */
export type NdjsonItem =
  | { readonly kind: "message"; readonly value: Record<string, unknown> }
  /** A line that is not a JSON object. `text` is cut to a few hundred characters for logging. */
  | { readonly kind: "invalid"; readonly text: string }
  /** A line over the limit, discarded unread. */
  | { readonly kind: "dropped"; readonly bytes: number };

/** Lines over this size are dropped (0037 section 2.2). */
export const MAX_LINE_BYTES = 4 * 1024 * 1024;

const LOG_TEXT_CHARS = 200;

/**
 * Splits a byte stream into stream-json messages. Chunks may end anywhere, also inside a multi-byte character;
 * a line that does not parse and a line over the limit are reported and skipped, so one bad line never stops
 * the stream. Keys and message types the app does not know pass through untouched.
 */
export class NdjsonReader {
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private discarding = false;

  constructor(private readonly maxLineBytes: number = MAX_LINE_BYTES) {}

  push(chunk: Buffer | string): NdjsonItem[] {
    let rest = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    const items: NdjsonItem[] = [];
    for (;;) {
      const newline = rest.indexOf(0x0a);
      if (newline < 0) {
        this.append(rest);
        return items;
      }
      this.append(rest.subarray(0, newline));
      const item = this.finishLine();
      if (item !== undefined) items.push(item);
      rest = rest.subarray(newline + 1);
    }
  }

  /** The stream ended: a last line without a newline is still a line. */
  end(): NdjsonItem[] {
    const item = this.finishLine();
    return item === undefined ? [] : [item];
  }

  private append(bytes: Buffer): void {
    if (bytes.length === 0) return;
    this.pendingBytes += bytes.length;
    if (this.discarding) return;
    if (this.pendingBytes > this.maxLineBytes) {
      this.discarding = true;
      this.pending = [];
      return;
    }
    this.pending.push(bytes);
  }

  private finishLine(): NdjsonItem | undefined {
    const bytes = this.pendingBytes;
    const dropped = this.discarding;
    const text = dropped ? "" : Buffer.concat(this.pending).toString("utf8");
    this.pending = [];
    this.pendingBytes = 0;
    this.discarding = false;
    if (dropped) return { kind: "dropped", bytes };
    const line = text.endsWith("\r") ? text.slice(0, -1) : text;
    if (line.trim() === "") return undefined;
    try {
      const value: unknown = JSON.parse(line);
      if (value !== null && typeof value === "object" && !Array.isArray(value))
        return { kind: "message", value: value as Record<string, unknown> };
    } catch {
      // reported below
    }
    return { kind: "invalid", text: line.slice(0, LOG_TEXT_CHARS) };
  }
}
