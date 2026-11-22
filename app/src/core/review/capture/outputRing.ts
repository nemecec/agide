/**
 * Keeps the first `head` bytes and the last `tail` bytes of a stream and counts what was dropped in between, so a
 * check that prints without end costs a fixed amount of memory (0040 section 6, output cap).
 */
export class OutputRing {
  private readonly first: Buffer[] = [];
  private firstBytes = 0;
  private last: Buffer[] = [];
  private lastBytes = 0;
  private dropped = 0;

  constructor(
    private readonly head = 64 * 1024,
    private readonly tail = 960 * 1024,
  ) {}

  push(chunk: Buffer): void {
    let rest = chunk;
    if (this.firstBytes < this.head) {
      const take = rest.subarray(0, this.head - this.firstBytes);
      this.first.push(take);
      this.firstBytes += take.length;
      rest = rest.subarray(take.length);
    }
    if (rest.length === 0) return;
    this.last.push(rest);
    this.lastBytes += rest.length;
    while (this.lastBytes - this.last[0]!.length >= this.tail) {
      const gone = this.last.shift()!;
      this.lastBytes -= gone.length;
      this.dropped += gone.length;
    }
    if (this.lastBytes > this.tail) {
      const over = this.lastBytes - this.tail;
      this.last[0] = this.last[0]!.subarray(over);
      this.lastBytes -= over;
      this.dropped += over;
    }
  }

  get truncated(): boolean {
    return this.dropped > 0;
  }

  /** The kept bytes in order, with a marker line where bytes were dropped. */
  contents(): Buffer {
    const parts = [...this.first];
    if (this.dropped > 0) parts.push(Buffer.from(`\n[... ${this.dropped} bytes omitted ...]\n`));
    parts.push(...this.last);
    return Buffer.concat(parts);
  }

  /** The last `characters` characters of the kept output, as text. */
  tailText(characters: number): string {
    // With nothing dropped the head and the tail are one stream; with a gap the tail alone is the end of the output.
    const text = Buffer.concat(this.dropped > 0 ? this.last : [...this.first, ...this.last]).toString('utf8');
    return text.length > characters ? text.slice(text.length - characters) : text;
  }
}
