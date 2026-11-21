import { join } from 'node:path';
import { z } from 'zod';
import { readOwnRegularFile, writeFileAtomic } from '../profile/fsio';
import { DEFAULT_THEME_ID } from './appearance';

const FILE_NAME = 'appearance.json';
const MAX_BYTES = 64 * 1024;
export const HISTORY_LIMIT = 50;

export type ChoiceSource = 'default' | 'ui' | 'mcp' | 'undo';

export interface ChoiceEntry {
  readonly revision: number;
  readonly themeId: string;
  readonly source: ChoiceSource;
  readonly at: number;
}

const entrySchema = z.object({ revision: z.number().int().min(1), themeId: z.string(), source: z.enum(['default', 'ui', 'mcp', 'undo']), at: z.number() }).strict();
const fileSchema = z.object({ schema: z.literal(1), themeId: z.string(), revision: z.number().int().min(1).optional(), history: z.array(entrySchema).optional() }).strict();

/**
 * The profile's theme choice with its revision history, kept in `appearance.json` of its data directory (the model
 * of the layout history in 0020). A missing or unreadable file reads as System at revision 1.
 */
export class ThemeChoiceStore {
  private entries: ChoiceEntry[];

  constructor(
    private readonly dataDir: string,
    private readonly now: () => number,
    private readonly isKnown: (themeId: string) => boolean,
  ) {
    this.entries = this.load();
  }

  private load(): ChoiceEntry[] {
    const fallback: ChoiceEntry[] = [{ revision: 1, themeId: DEFAULT_THEME_ID, source: 'default', at: this.now() }];
    const text = readOwnRegularFile(join(this.dataDir, FILE_NAME), { maxBytes: MAX_BYTES });
    if (text === undefined) return fallback;
    try {
      const parsed = fileSchema.safeParse(JSON.parse(text));
      if (!parsed.success) return fallback;
      const history = [...(parsed.data.history ?? [])].sort((a, b) => a.revision - b.revision);
      const revision = parsed.data.revision ?? history.at(-1)?.revision ?? 1;
      const known = this.isKnown(parsed.data.themeId) ? parsed.data.themeId : DEFAULT_THEME_ID;
      if (history.at(-1)?.revision === revision && history.at(-1)?.themeId === known) return history;
      return [...history.filter((entry) => entry.revision < revision), { revision, themeId: known, source: 'ui', at: this.now() }];
    } catch {
      return fallback;
    }
  }

  private save(): void {
    const current = this.current();
    writeFileAtomic(join(this.dataDir, FILE_NAME), `${JSON.stringify({ schema: 1, themeId: current.themeId, revision: current.revision, history: this.entries }, null, 2)}\n`);
  }

  current(): ChoiceEntry {
    return this.entries.at(-1) as ChoiceEntry;
  }

  /** The entry of a revision, or undefined when history no longer holds it. */
  get(revision: number): ChoiceEntry | undefined {
    return this.entries.find((entry) => entry.revision === revision);
  }

  /** The entry before the current one. */
  previous(): ChoiceEntry | undefined {
    return this.entries.at(-2);
  }

  /** Newest first. */
  list(): readonly ChoiceEntry[] {
    return [...this.entries].reverse();
  }

  /** Records a new revision and saves. */
  record(themeId: string, source: ChoiceSource): ChoiceEntry {
    const entry: ChoiceEntry = { revision: this.current().revision + 1, themeId, source, at: this.now() };
    this.entries = [...this.entries, entry].slice(-HISTORY_LIMIT);
    this.save();
    return entry;
  }
}
