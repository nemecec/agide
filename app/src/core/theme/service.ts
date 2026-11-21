import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DEFAULT_APPEARANCE, type AppearanceState, type PreviewState, type ThemeChange } from './appearance';
import { BUILTIN_THEMES, builtinTheme } from './builtin/index';
import { checkPairs } from './contrast';
import { resolveTheme } from './resolve';
import { contrastIssues, themeJsonSchema, validateThemeDocument, type ThemeDocument, type ThemeIssue } from './schema';
import { sourceOf, themeDetail, type ThemeSummary } from './summary';
import { ThemeChoiceStore, type ChoiceEntry, type ChoiceSource } from './themeChoice';
import { UserThemeStore, type UserThemeProblem } from './userThemes';
import { importVsCodeTheme, type ImportOutcome, type ImportRequest } from './vscode/import';

export const PREVIEW_MS = 60_000;

export type ThemeErrorCode = 'not_found' | 'invalid_input' | 'stale_revision';

export class ThemeError extends Error {
  constructor(
    readonly code: ThemeErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** What a window needs to draw the profile's theme. */
export interface ThemeState {
  readonly themeId: string;
  readonly revision: number;
  /** Present when the choice is a user theme. */
  readonly theme?: ThemeDocument;
  readonly preview?: PreviewState & { readonly windowId?: number };
  readonly change?: ThemeChange;
}

export interface ThemeServiceOptions {
  readonly dataDir: string;
  /** Recorded in `source.importer` of imported themes. */
  readonly importer?: string;
  readonly now?: () => number;
  readonly previewMs?: number;
  readonly timers?: { set(run: () => void, ms: number): unknown; clear(handle: unknown): void };
}

interface Preview {
  readonly previewId: string;
  readonly theme: ThemeDocument;
  readonly windowId: number | undefined;
  readonly expiresAt: number;
  readonly timer: unknown;
}

export type ThemeTarget = { readonly id: string } | { readonly document: unknown };

/**
 * The themes of one profile and its theme choice. Built-in themes ship with the app; user themes are files in the
 * profile's data directory. A change of the choice is a revision with history, like a layout change (0020). A
 * preview shows a theme without saving it and ends on Keep, Revert, a closed window or a timeout.
 */
export class ThemeService {
  private readonly user: UserThemeStore;
  private readonly choice: ThemeChoiceStore;
  private readonly now: () => number;
  private readonly previewMs: number;
  private readonly timers: NonNullable<ThemeServiceOptions['timers']>;
  private readonly listeners = new Set<() => void>();
  private userThemes: ThemeDocument[] = [];
  private problems: UserThemeProblem[] = [];
  private preview: Preview | undefined;
  private lastChange: ThemeChange | undefined;
  private appearance: AppearanceState = DEFAULT_APPEARANCE;

  constructor(private readonly options: ThemeServiceOptions) {
    this.now = options.now ?? Date.now;
    this.previewMs = options.previewMs ?? PREVIEW_MS;
    this.timers = options.timers ?? { set: (run, ms) => setTimeout(run, ms).unref(), clear: (handle) => clearTimeout(handle as NodeJS.Timeout) };
    this.user = new UserThemeStore(join(options.dataDir, 'themes'));
    this.rescan();
    this.choice = new ThemeChoiceStore(options.dataDir, this.now, (id) => this.find(id) !== undefined);
  }

  /** Reads the user theme files again. */
  rescan(): void {
    const scanned = this.user.scan();
    this.userThemes = scanned.themes;
    this.problems = scanned.problems;
  }

  userThemeProblems(): readonly UserThemeProblem[] {
    return this.problems;
  }

  /** The OS state the main process last reported; `get` resolves tokens with it. */
  setAppearance(state: AppearanceState): void {
    this.appearance = state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private find(id: string): ThemeDocument | undefined {
    return builtinTheme(id) ?? this.userThemes.find((theme) => theme.id === id);
  }

  private takenIds(): Set<string> {
    return new Set([...BUILTIN_THEMES, ...this.userThemes].map((theme) => theme.id));
  }

  private require(id: string): ThemeDocument {
    const found = this.find(id);
    if (!found) throw new ThemeError('not_found', `no theme with id ${id}`, { ids: this.all().map((theme) => theme.id) });
    return found;
  }

  private all(): ThemeDocument[] {
    return [...BUILTIN_THEMES, ...this.userThemes];
  }

  private lowContrast(theme: ThemeDocument): boolean {
    if (theme.kind === 'system') return false;
    try {
      const resolved = resolveTheme({ theme });
      return contrastIssues(resolved.tokens, resolved.scheme === 'dark').length > 0;
    } catch {
      return false;
    }
  }

  list(): ThemeSummary[] {
    const active = this.choice.current().themeId;
    return this.all().map((theme) => ({
      id: theme.id,
      name: theme.name,
      kind: theme.kind,
      source: sourceOf(theme),
      license: theme.license?.spdx,
      detail: themeDetail(theme),
      active: theme.id === active,
      lowContrast: this.lowContrast(theme),
    }));
  }

  /** The document, its tokens for the current OS appearance, the pairs under target and the JSON Schema. */
  get(id?: string) {
    const theme = this.require(id ?? this.choice.current().themeId);
    const resolved = resolveTheme({ theme, appearance: this.appearance });
    return {
      theme,
      active: theme.id === this.choice.current().themeId,
      revision: this.choice.current().revision,
      resolved: { scheme: resolved.scheme, contrast: resolved.contrast, tokens: resolved.tokens, terminal: resolved.terminal },
      contrast: checkPairs(resolved.tokens).filter((pair) => !pair.ok),
      jsonSchema: themeJsonSchema(),
    };
  }

  /** Checks a document without saving it. The adjustments are the values the clamp would use. */
  validate(document: unknown): { ok: boolean; errors: ThemeIssue[]; warnings: ThemeIssue[]; adjustments: { token: string; from: string; to: string }[] } {
    const result = validateThemeDocument(document, { existingIds: this.takenIds() });
    const issues = [...result.issues];
    if (result.theme && result.ok) {
      try {
        const resolved = resolveTheme({ theme: result.theme });
        issues.push(...contrastIssues(resolved.tokens, resolved.scheme === 'dark'));
      } catch {
        // A system theme without both variants was reported by the schema check.
      }
    }
    const warnings = issues.filter((issue) => issue.severity === 'warning');
    return {
      ok: result.ok,
      errors: issues.filter((issue) => issue.severity === 'error'),
      warnings,
      adjustments: warnings.flatMap((warning) => {
        const to = /`(#[0-9a-f]{6})`/i.exec(warning.hint)?.[1];
        const token = warning.path.split('/').at(-1);
        const from = token === undefined || result.theme?.kind === 'system' ? undefined : result.theme?.tokens?.[token];
        return to && token && from ? [{ token, from, to }] : [];
      }),
    };
  }

  state(): ThemeState {
    const current = this.choice.current();
    const theme = builtinTheme(current.themeId) ? undefined : this.find(current.themeId);
    const { preview } = this;
    return {
      themeId: current.themeId,
      revision: current.revision,
      ...(theme ? { theme } : {}),
      ...(preview ? { preview: { previewId: preview.previewId, name: preview.theme.name, expiresAt: preview.expiresAt, theme: preview.theme, ...(preview.windowId === undefined ? {} : { windowId: preview.windowId }) } } : {}),
      ...(this.lastChange ? { change: this.lastChange } : {}),
    };
  }

  private resolveTarget(target: ThemeTarget): ThemeDocument {
    if ('id' in target) return this.require(target.id);
    const result = validateThemeDocument(target.document, { existingIds: this.takenIds() });
    if (!result.ok || !result.theme) throw new ThemeError('invalid_input', 'the theme document is not valid', { issues: result.issues });
    return result.theme;
  }

  /** Shows a theme without saving it. A second preview replaces the first. */
  startPreview(target: ThemeTarget, windowId?: number): { previewId: string; expiresAt: number; name: string } {
    const theme = this.resolveTarget(target);
    try {
      resolveTheme({ theme });
    } catch (error) {
      throw new ThemeError('invalid_input', `the theme cannot be resolved: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.clearPreview();
    const previewId = randomUUID();
    const expiresAt = this.now() + this.previewMs;
    const timer = this.timers.set(() => this.endPreview(previewId), this.previewMs);
    this.preview = { previewId, theme, windowId, expiresAt, timer };
    this.notify();
    return { previewId, expiresAt, name: theme.name };
  }

  private clearPreview(): void {
    if (this.preview) this.timers.clear(this.preview.timer);
    this.preview = undefined;
  }

  /** Ends a preview and restores the saved theme. Returns false when that preview is already over. */
  endPreview(previewId?: string): boolean {
    if (!this.preview || (previewId !== undefined && this.preview.previewId !== previewId)) return false;
    this.clearPreview();
    this.notify();
    return true;
  }

  /** A closed window ends the previews that were limited to it. */
  windowClosed(windowId: number): void {
    if (this.preview?.windowId === windowId) this.endPreview(this.preview.previewId);
  }

  /**
   * Saves the choice as a new revision. `expectedRevision` must be the current one when given. A preview of a
   * document that is not saved yet is written to the profile's themes first.
   */
  apply(target: { readonly id: string } | { readonly previewId: string }, source: ChoiceSource, expectedRevision?: number) {
    const current = this.choice.current();
    if (expectedRevision !== undefined && expectedRevision !== current.revision) {
      throw new ThemeError('stale_revision', `the theme choice is at revision ${current.revision}, not ${expectedRevision}; read it again with theme_get`, { currentRevision: current.revision, themeId: current.themeId });
    }
    let theme: ThemeDocument;
    if ('previewId' in target) {
      if (!this.preview || this.preview.previewId !== target.previewId) throw new ThemeError('not_found', 'that preview is over; start a new one with theme_preview');
      theme = this.preview.theme;
      if (!this.find(theme.id)) {
        this.user.write(theme);
        this.rescan();
      }
    } else {
      theme = this.require(target.id);
    }
    this.clearPreview();
    return this.save(theme.id, source, 'apply');
  }

  private save(themeId: string, source: ChoiceSource, kind: ThemeChange['kind']) {
    const previous = this.choice.current();
    const entry = themeId === previous.themeId ? previous : this.choice.record(themeId, source);
    const name = this.require(themeId).name;
    if (entry !== previous) this.lastChange = { kind, revision: entry.revision, name, at: this.now() };
    this.notify();
    return { revision: entry.revision, themeId, name, changed: entry !== previous, undo: { tool: 'theme_undo', arguments: { revision: previous.revision } } };
  }

  /** Applies an earlier revision (by default the one before the current) as a new revision, so an undo can be undone. */
  undo(revision?: number) {
    const target: ChoiceEntry | undefined = revision === undefined ? this.choice.previous() : this.choice.get(revision);
    if (!target) throw new ThemeError('not_found', revision === undefined ? 'there is no earlier revision to restore' : `history holds no revision ${revision}`, { revisions: this.choice.list().map((entry) => entry.revision) });
    if (!this.find(target.themeId)) throw new ThemeError('not_found', `theme ${target.themeId} of revision ${target.revision} no longer exists`);
    this.clearPreview();
    return { ...this.save(target.themeId, 'undo', 'undo'), restoredRevision: target.revision };
  }

  history(): readonly ChoiceEntry[] {
    return this.choice.list();
  }

  /** Builds a theme from a VS Code file or package. With `save` the theme is written to the profile's themes. */
  importTheme(request: Omit<ImportRequest, 'existingIds' | 'now' | 'importer'>, save: boolean): ImportOutcome {
    const outcome = importVsCodeTheme({ ...request, existingIds: this.takenIds(), now: new Date(this.now()), importer: this.options.importer ?? 'Agide' });
    if (outcome.ok && save) {
      this.user.write(outcome.theme);
      this.rescan();
      this.notify();
    }
    return outcome;
  }

  dispose(): void {
    this.clearPreview();
    this.listeners.clear();
  }
}
