/** The most recent terminal output of a session, kept so a reloaded renderer can redraw the screen. */
export class OutputBuffer {
  private chunks: string[] = [];
  private length = 0;

  constructor(private readonly limit = 512 * 1024) {}

  append(data: string): void {
    this.chunks.push(data);
    this.length += data.length;
    while (this.length > this.limit && this.chunks.length > 1) {
      this.length -= this.chunks.shift()?.length ?? 0;
    }
  }

  read(): string {
    return this.chunks.join('');
  }
}
