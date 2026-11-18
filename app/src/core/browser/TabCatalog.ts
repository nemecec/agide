import type { ObserveMode } from '../surfaces/types';
import { TabTable } from './tables';
import type { BrowserTabState, ServiceId, TabNumber } from './types';

/** Persistence of the tab states and the number counter (SQLite in the app, memory in tests). */
export interface TabStore {
  load(): { readonly leafId: string; readonly surfaceId: string; readonly state: BrowserTabState }[];
  save(leafId: string, surfaceId: string, state: BrowserTabState): void;
  remove(leafId: string): void;
  counter(): number;
  setCounter(next: number): void;
}

export class MemoryTabStore implements TabStore {
  private readonly rows = new Map<string, { surfaceId: string; state: BrowserTabState }>();
  private next = 1;
  load() {
    return [...this.rows].map(([leafId, row]) => ({ leafId, ...row }));
  }
  save(leafId: string, surfaceId: string, state: BrowserTabState): void {
    this.rows.set(leafId, { surfaceId, state });
  }
  remove(leafId: string): void {
    this.rows.delete(leafId);
  }
  counter(): number {
    return this.next;
  }
  setCounter(next: number): void {
    this.next = next;
  }
}

export interface TabRecord {
  readonly leafId: string;
  readonly surfaceId: string;
  state: BrowserTabState;
}

/**
 * The `browser-tab` leaves the browser module recorded. A leaf that is not here is a forged leaf: it has no
 * view, no tools and no observation (0026 section 1).
 */
export class TabCatalog {
  readonly table: TabTable;
  private readonly records = new Map<string, TabRecord>();

  constructor(private readonly store: TabStore) {
    this.table = new TabTable(store.counter());
    for (const row of store.load()) {
      this.records.set(row.leafId, { leafId: row.leafId, surfaceId: row.surfaceId, state: row.state });
      this.table.restore(row.leafId, row.state.tabNumber);
    }
  }

  /** Records a new tab and gives it its number. */
  add(input: { readonly leafId: string; readonly surfaceId: string; readonly service: ServiceId; readonly url: string; readonly title: string; readonly observe: ObserveMode; readonly createdBy: BrowserTabState['createdBy'] }): TabRecord {
    const tabNumber: TabNumber = this.table.allocate(input.leafId);
    this.store.setCounter(this.table.peekNext());
    const state: BrowserTabState = { url: input.url, title: input.title, service: input.service, observe: input.observe, tabNumber, createdBy: input.createdBy, zoom: 1 };
    const record: TabRecord = { leafId: input.leafId, surfaceId: input.surfaceId, state };
    this.records.set(input.leafId, record);
    this.store.save(input.leafId, input.surfaceId, state);
    return record;
  }

  get(leafId: string): TabRecord | undefined {
    return this.records.get(leafId);
  }

  bySurface(surfaceId: string): TabRecord | undefined {
    return [...this.records.values()].find((record) => record.surfaceId === surfaceId);
  }

  byNumber(tabNumber: number): TabRecord | undefined {
    const leafId = this.table.leafOf(tabNumber);
    return leafId === undefined ? undefined : this.records.get(leafId);
  }

  list(): TabRecord[] {
    return [...this.records.values()];
  }

  update(leafId: string, patch: Partial<BrowserTabState>): TabRecord | undefined {
    const record = this.records.get(leafId);
    if (!record) return undefined;
    record.state = { ...record.state, ...patch };
    this.store.save(leafId, record.surfaceId, record.state);
    return record;
  }

  remove(leafId: string): void {
    this.records.delete(leafId);
    this.table.release(leafId);
    this.store.remove(leafId);
  }
}
