/** Integer tab ids for the hosted tools: unique per profile, never reused (`tabNumber`). */
export class TabTable {
  private readonly byNumber = new Map<number, string>();
  private readonly byLeaf = new Map<string, number>();

  /** `next` is the first number to hand out; restored numbers push it past themselves. */
  constructor(private next = 1) {}

  /** Records a leaf that already has a number (after a restart). */
  restore(leafId: string, tabNumber: number): void {
    this.byNumber.set(tabNumber, leafId);
    this.byLeaf.set(leafId, tabNumber);
    if (tabNumber >= this.next) this.next = tabNumber + 1;
  }

  allocate(leafId: string): number {
    const existing = this.byLeaf.get(leafId);
    if (existing !== undefined) return existing;
    const tabNumber = this.next++;
    this.byNumber.set(tabNumber, leafId);
    this.byLeaf.set(leafId, tabNumber);
    return tabNumber;
  }

  leafOf(tabNumber: number): string | undefined {
    return this.byNumber.get(tabNumber);
  }

  numberOf(leafId: string): number | undefined {
    return this.byLeaf.get(leafId);
  }

  /** The highest number handed out so far plus one: what a persisted counter keeps. */
  peekNext(): number {
    return this.next;
  }

  /** The number stays taken, so it is never reused. */
  release(leafId: string): void {
    const tabNumber = this.byLeaf.get(leafId);
    this.byLeaf.delete(leafId);
    if (tabNumber !== undefined) this.byNumber.delete(tabNumber);
  }
}

export class StaleRefError extends Error {
  constructor(readonly ref: string) {
    super(`${ref} is stale after navigation; call read_page again`);
    this.name = 'StaleRefError';
  }
}

/** `ref_N` ids of one tab mapped to DOM node ids, cleared on every committed navigation. */
export class RefTable {
  private refs = new Map<string, number>();
  private counter = 0;
  private generation = 0;

  assign(backendNodeId: number): string {
    for (const [ref, id] of this.refs) if (id === backendNodeId) return ref;
    const ref = `ref_${++this.counter}`;
    this.refs.set(ref, backendNodeId);
    return ref;
  }

  resolve(ref: string): number {
    const id = this.refs.get(ref);
    if (id === undefined) {
      if (/^ref_[0-9]+$/.test(ref) && Number(ref.slice(4)) <= this.counter) throw new StaleRefError(ref);
      throw new Error(`unknown ref ${ref}; call read_page or find to get refs`);
    }
    return id;
  }

  /** Called on each committed navigation. Numbers keep counting so an old ref never names a new node. */
  invalidate(): void {
    this.refs = new Map();
    this.generation += 1;
  }

  get invalidations(): number {
    return this.generation;
  }
}
