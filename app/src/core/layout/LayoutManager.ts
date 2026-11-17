import type { LayoutDocument, LayoutIssue } from '../blocks/layout';
import type { BlockRegistry, BlocksEvent } from '../blocks/types';
import { describeDiff, diffLayouts, isEmptyDiff, type LayoutDiff } from './diff';
import { hashText, type LayoutFiles } from './LayoutFiles';
import type { ChangeSource, LayoutHistory } from './LayoutHistory';
import { applyPatch, type PatchOperation } from './jsonPatch';
import { migrateLayout } from './migrations';
import { validateLayoutDocument, type LayoutReport } from './validate';

export const DEFAULT_LAYOUT_ID = 'session';

export type LayoutErrorCode = 'not_found' | 'stale_revision' | 'invalid' | 'read_only' | 'undo_unavailable';

export class LayoutError extends Error {
  constructor(
    readonly code: LayoutErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'LayoutError';
  }
}

export type LayoutInput = { readonly document: unknown } | { readonly patch: readonly PatchOperation[] };

export interface LastChange {
  readonly revision: number;
  readonly source: ChangeSource;
  readonly summary: readonly string[];
  readonly at: number;
}

export interface LayoutView {
  readonly layoutId: string;
  readonly layout: LayoutDocument;
  readonly revision: number;
  /** `preset` until the profile holds a file for the layout. */
  readonly origin: 'preset' | 'file';
  readonly readOnly: boolean;
  /** Problems of the file on disk that the app did not load. The running layout is the last valid one. */
  readonly fileIssues: readonly LayoutIssue[];
  readonly lastChange?: LastChange;
}

export interface ApplyResult {
  readonly layoutId: string;
  readonly changed: boolean;
  readonly revision: number;
  readonly previousRevision: number;
  readonly diff: LayoutDiff;
  readonly summary: readonly string[];
  readonly warnings: readonly LayoutIssue[];
  /** Arguments of `layout_undo` that restore the previous revision. */
  readonly undo: { readonly layoutId: string; readonly toRevision: number };
}

interface State {
  doc: LayoutDocument;
  origin: 'preset' | 'file';
  readOnly: boolean;
  fileIssues: LayoutIssue[];
  lastWrittenHash?: string;
  lastSeenHash?: string;
  migratedFrom?: number;
  lastChange?: LastChange;
}

export interface LayoutManagerOptions {
  readonly files: LayoutFiles;
  readonly presets: readonly LayoutDocument[];
  readonly registry: BlockRegistry;
  readonly history: LayoutHistory;
  readonly emit: (event: BlocksEvent) => void;
  readonly clock?: () => number;
}

const issue = (path: string, message: string): LayoutIssue => ({ path, message });

/**
 * Layouts of one profile: shipped presets, files in the profile, the revision history and the window's layout.
 * The file is the source of truth. An invalid file never replaces the running layout and is never rewritten: while
 * it is invalid, changes stay in memory and the next valid file replaces them.
 */
export class LayoutManager {
  private readonly states = new Map<string, State>();
  private active = DEFAULT_LAYOUT_ID;
  private readonly clock: () => number;

  constructor(private readonly options: LayoutManagerOptions) {
    this.clock = options.clock ?? Date.now;
  }

  start(): void {
    this.active = this.options.files.readWindowLayout() ?? DEFAULT_LAYOUT_ID;
    if (!this.knows(this.active)) this.active = DEFAULT_LAYOUT_ID;
    this.state(this.active);
    this.options.files.watch((id) => this.reloadFromDisk(id));
  }

  stop(): void {
    this.options.files.close();
  }

  activeId(): string {
    return this.active;
  }

  list(): { id: string; title: string; active: boolean; origin: 'preset' | 'file' }[] {
    const presetIds = this.options.presets.map((p) => p.id);
    const profileIds = this.options.files.ids().filter((id) => !presetIds.includes(id)).sort();
    return [...presetIds, ...profileIds].flatMap((id) => {
      const state = this.stateOrUndefined(id);
      return state ? [{ id, title: state.doc.title, active: id === this.active, origin: state.origin }] : [];
    });
  }

  get(layoutId: string = this.active): LayoutView {
    const state = this.stateOrUndefined(layoutId);
    if (!state) throw this.notFound(layoutId);
    return {
      layoutId,
      layout: structuredClone(state.doc),
      revision: state.doc.revision,
      origin: state.origin,
      readOnly: state.readOnly,
      fileIssues: state.fileIssues,
      ...(state.lastChange ? { lastChange: state.lastChange } : {}),
    };
  }

  switchTo(layoutId: string): LayoutView {
    if (!this.stateOrUndefined(layoutId)) throw this.notFound(layoutId);
    if (layoutId !== this.active) {
      this.active = layoutId;
      this.options.files.writeWindowLayout(layoutId);
      this.options.emit({ type: 'layout.applied', layoutId, revision: this.get(layoutId).revision });
    }
    return this.get(layoutId);
  }

  /** Validates a full document or a patch against the layout without applying it. */
  validate(layoutId: string, input: LayoutInput): { report: LayoutReport; diff?: LayoutDiff; summary?: string[] } {
    const state = this.stateOrUndefined(layoutId);
    if (!state) throw this.notFound(layoutId);
    const candidate = this.candidate(layoutId, state, input);
    if (!candidate.ok) return { report: { ok: false, errors: candidate.issues, warnings: [], placeholders: [] } };
    const report = validateLayoutDocument(candidate.value, this.options.registry);
    if (!report.layout) return { report };
    const diff = diffLayouts(state.doc, report.layout);
    return { report, diff, summary: describeDiff(diff) };
  }

  apply(layoutId: string, expectedRevision: number, input: LayoutInput, source: ChangeSource = 'ui'): ApplyResult {
    const state = this.stateOrUndefined(layoutId);
    if (!state) throw this.notFound(layoutId);
    if (state.readOnly) {
      throw new LayoutError('read_only', `layout ${layoutId} was written by a newer version of the app and is open read only`);
    }
    if (expectedRevision !== state.doc.revision) {
      throw new LayoutError(
        'stale_revision',
        `layout ${layoutId} is at revision ${state.doc.revision}, not ${expectedRevision}; call layout_get and apply your change to the current revision`,
        { currentRevision: state.doc.revision },
      );
    }
    const candidate = this.candidate(layoutId, state, input);
    if (!candidate.ok) throw this.invalid(candidate.issues);
    const report = validateLayoutDocument(candidate.value, this.options.registry);
    if (!report.layout) throw this.invalid(report.errors);
    return this.commit(layoutId, state, report.layout, source, report.warnings);
  }

  /** Applies an earlier revision as a new one, so an undo can itself be undone. Default: the revision before the current one. */
  undo(layoutId: string, toRevision?: number): ApplyResult {
    const state = this.stateOrUndefined(layoutId);
    if (!state) throw this.notFound(layoutId);
    const target = toRevision ?? state.doc.revision - 1;
    this.ensureBase(layoutId, state);
    const entry = this.options.history.get(layoutId, target);
    if (!entry) {
      const known = this.options.history.list(layoutId).map((e) => e.revision);
      throw new LayoutError('undo_unavailable', `no revision ${target} of layout ${layoutId} in the history; available: ${known.join(', ') || 'none'}`);
    }
    if (state.readOnly) throw new LayoutError('read_only', `layout ${layoutId} is open read only`);
    return this.commit(layoutId, state, entry.document, 'undo', []);
  }

  /** The document `undo` would apply, or `undefined` when the history lacks the revision. */
  undoTarget(layoutId: string, toRevision?: number): LayoutDocument | undefined {
    const state = this.stateOrUndefined(layoutId);
    if (!state) throw this.notFound(layoutId);
    return this.options.history.get(layoutId, toRevision ?? state.doc.revision - 1)?.document;
  }

  /** The file of a layout changed on disk. Own writes are recognised by content hash and ignored. */
  reloadFromDisk(id: string): void {
    const state = this.states.get(id);
    if (!state) return;
    const file = this.options.files.read(id);
    if (file === undefined) {
      const preset = this.options.presets.find((p) => p.id === id);
      if (preset && state.origin === 'file') {
        delete state.lastWrittenHash;
        delete state.lastSeenHash;
        this.adopt(id, state, { ...preset, revision: state.doc.revision + 1 }, 'preset', 'preset');
      }
      return;
    }
    const known = file.hash === state.lastWrittenHash || file.hash === state.lastSeenHash;
    if (state.fileIssues.length === 0 ? known : file.hash === state.lastSeenHash) return;
    state.lastSeenHash = file.hash;
    const loaded = this.parseFile(file.text);
    if (loaded.kind === 'invalid') {
      state.fileIssues = loaded.issues;
      this.options.emit({ type: 'layout.applied', layoutId: id, revision: state.doc.revision });
      return;
    }
    if (loaded.kind === 'newer') {
      state.fileIssues = [issue('/schemaVersion', `the file has schemaVersion ${loaded.schemaVersion}; this build reads up to 1. The running layout stays`)];
      this.options.emit({ type: 'layout.applied', layoutId: id, revision: state.doc.revision });
      return;
    }
    const revision = Math.max(state.doc.revision + 1, loaded.layout.revision);
    this.ensureBase(id, state);
    if (loaded.migratedFrom !== undefined) state.migratedFrom = loaded.migratedFrom;
    this.adopt(id, state, { ...loaded.layout, id, revision }, 'file', 'file');
  }

  private commit(layoutId: string, state: State, next: LayoutDocument, source: ChangeSource, warnings: readonly LayoutIssue[]): ApplyResult {
    const previous = state.doc;
    const document: LayoutDocument = { ...next, id: layoutId, revision: previous.revision + 1 };
    const diff = diffLayouts(previous, document);
    const undo = { layoutId, toRevision: previous.revision };
    if (isEmptyDiff(diff)) {
      return { layoutId, changed: false, revision: previous.revision, previousRevision: previous.revision, diff, summary: ['no change'], warnings, undo };
    }
    this.ensureBase(layoutId, state);
    const summary = describeDiff(diff);
    if (state.fileIssues.length > 0) {
      const held = [...warnings, issue('/file', 'the file on disk is invalid and was not rewritten; the change lives in memory until the file is valid again')];
      this.adopt(layoutId, state, document, source, state.origin, summary, state.fileIssues);
      return { layoutId, changed: true, revision: document.revision, previousRevision: previous.revision, diff, summary, warnings: held, undo };
    }
    if (state.migratedFrom !== undefined) {
      this.options.files.keepOriginal(layoutId, state.migratedFrom);
      delete state.migratedFrom;
    }
    state.lastWrittenHash = this.options.files.write(layoutId, document);
    this.adopt(layoutId, state, document, source, 'file', summary);
    return { layoutId, changed: true, revision: document.revision, previousRevision: previous.revision, diff, summary, warnings, undo };
  }

  private adopt(
    layoutId: string,
    state: State,
    document: LayoutDocument,
    source: ChangeSource,
    origin: 'preset' | 'file',
    summary?: readonly string[],
    fileIssues: LayoutIssue[] = [],
  ): void {
    const before = state.doc;
    state.doc = document;
    state.origin = origin;
    state.fileIssues = fileIssues;
    state.lastChange = {
      revision: document.revision,
      source,
      summary: summary ?? describeDiff(diffLayouts(before, document)),
      at: this.clock(),
    };
    this.options.history.record({ layoutId, revision: document.revision, document, source, at: this.clock() });
    this.options.emit({ type: 'layout.applied', layoutId, revision: document.revision });
  }

  private ensureBase(layoutId: string, state: State): void {
    if (!this.options.history.get(layoutId, state.doc.revision)) {
      this.options.history.record({ layoutId, revision: state.doc.revision, document: state.doc, source: state.origin === 'file' ? 'file' : 'preset', at: this.clock() });
    }
  }

  private candidate(
    layoutId: string,
    state: State,
    input: LayoutInput,
  ): { ok: true; value: unknown } | { ok: false; issues: LayoutIssue[] } {
    if ('patch' in input) {
      const patched = applyPatch(state.doc, input.patch);
      return patched.ok ? { ok: true, value: patched.value } : { ok: false, issues: [...patched.issues] };
    }
    const document = input.document;
    if (typeof document === 'object' && document !== null && (document as { id?: unknown }).id !== layoutId) {
      return { ok: false, issues: [issue('/id', `the document id must be ${layoutId}, the layout you apply it to`)] };
    }
    return { ok: true, value: document };
  }

  private invalid(issues: readonly LayoutIssue[]): LayoutError {
    return new LayoutError('invalid', `the layout is invalid: ${issues.map((i) => `${i.path || '/'} ${i.message}`).join('; ')}`, { issues });
  }

  private notFound(layoutId: string): LayoutError {
    const ids = this.list().map((l) => l.id);
    return new LayoutError('not_found', `no layout ${layoutId}; layouts: ${ids.join(', ')}`);
  }

  private knows(id: string): boolean {
    return this.options.presets.some((p) => p.id === id) || this.options.files.ids().includes(id);
  }

  private stateOrUndefined(id: string): State | undefined {
    return this.knows(id) ? this.state(id) : undefined;
  }

  private state(id: string): State {
    const existing = this.states.get(id);
    if (existing) return existing;
    const preset = this.options.presets.find((p) => p.id === id);
    const fallback = preset ?? this.options.presets.find((p) => p.id === DEFAULT_LAYOUT_ID);
    if (!fallback) throw new LayoutError('not_found', `no layout ${id}`);
    const state: State = { doc: structuredClone(fallback), origin: 'preset', readOnly: false, fileIssues: [] };
    const file = this.options.files.read(id);
    if (file) {
      state.lastSeenHash = file.hash;
      const loaded = this.parseFile(file.text);
      if (loaded.kind === 'ok') {
        state.doc = { ...loaded.layout, id };
        state.origin = 'file';
        if (loaded.migratedFrom !== undefined) state.migratedFrom = loaded.migratedFrom;
      } else if (loaded.kind === 'newer') {
        state.fileIssues = [issue('/schemaVersion', `the file has schemaVersion ${loaded.schemaVersion}; this build reads up to 1. It opens read only`)];
        state.readOnly = true;
      } else {
        state.fileIssues = loaded.issues;
      }
    }
    this.states.set(id, state);
    return state;
  }

  private parseFile(
    text: string,
  ):
    | { kind: 'ok'; layout: LayoutDocument; migratedFrom?: number }
    | { kind: 'newer'; schemaVersion: number }
    | { kind: 'invalid'; issues: LayoutIssue[] } {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      return { kind: 'invalid', issues: [issue('', `the file is not valid JSON: ${(error as Error).message}`)] };
    }
    const migrated = migrateLayout(raw);
    if (migrated.status === 'newer') return { kind: 'newer', schemaVersion: migrated.schemaVersion };
    if (migrated.status === 'invalid') return { kind: 'invalid', issues: [issue('', migrated.message)] };
    const report = validateLayoutDocument(migrated.document, this.options.registry);
    if (!report.layout) return { kind: 'invalid', issues: [...report.errors] };
    return { kind: 'ok', layout: report.layout, ...(migrated.migratedFrom === undefined ? {} : { migratedFrom: migrated.migratedFrom }) };
  }
}

export { hashText };
