import { KEY_DOWN, KEY_ENTER, screenText, showsTrustDialog, trustHighlight } from './trustDialog';
import type { TrustState } from './types';

export interface TrustAutomationDeps {
  write(sessionId: string, data: string): void;
  setTimer(work: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** Reports each change of what the session pane shows. */
  onState(sessionId: string, state: TrustState): void;
}

export interface TrustWatchOptions {
  /** The app answers the question (a folder it created, and the profile allows it). Otherwise the user does. */
  readonly answer: boolean;
}

/** Waits for the highlight after Down, and for `SessionStart` after Enter. */
export const HIGHLIGHT_WAIT_MS = 2_000;
export const START_WAIT_MS = 3_000;
const WINDOW = 4_000;

type Phase = 'watching' | 'asked_user' | 'moving' | 'confirming' | 'failed';

interface Watch {
  readonly options: TrustWatchOptions;
  phase: Phase;
  text: string;
  timer?: unknown;
}

/**
 * Handles Claude's folder-trust dialog for the sessions it watches (0028 section 11). While no `SessionStart` has
 * arrived it reads the terminal output; on the dialog it either answers (Down, wait for a frame that
 * highlights `Yes, I trust this folder`, Enter) or tells the user to answer in the terminal. Any mismatch stops
 * the automation and hands the question to the user.
 */
export class TrustAutomation {
  private readonly watches = new Map<string, Watch>();

  constructor(private readonly deps: TrustAutomationDeps) {}

  watch(sessionId: string, options: TrustWatchOptions): void {
    this.stop(sessionId);
    this.watches.set(sessionId, { options, phase: 'watching', text: '' });
  }

  watching(sessionId: string): boolean {
    return this.watches.has(sessionId);
  }

  output(sessionId: string, data: string): void {
    const watch = this.watches.get(sessionId);
    if (!watch || watch.phase === 'failed' || watch.phase === 'asked_user') return;
    watch.text = (watch.text + screenText(data)).slice(-WINDOW);
    if (watch.phase === 'watching') {
      if (!showsTrustDialog(watch.text)) return;
      if (!watch.options.answer) {
        watch.phase = 'asked_user';
        this.deps.onState(sessionId, 'user_input');
        return;
      }
      watch.phase = 'moving';
      watch.text = '';
      this.deps.onState(sessionId, 'answering');
      this.deps.write(sessionId, KEY_DOWN);
      this.arm(sessionId, watch, HIGHLIGHT_WAIT_MS);
    } else if (watch.phase === 'moving' && trustHighlight(watch.text) === 'yes') {
      watch.phase = 'confirming';
      this.deps.write(sessionId, KEY_ENTER);
      this.arm(sessionId, watch, START_WAIT_MS);
    }
  }

  /** The session started: the question is answered or never came. */
  started(sessionId: string): void {
    const watch = this.watches.get(sessionId);
    if (!watch) return;
    this.stop(sessionId);
    if (watch.phase !== 'watching') this.deps.onState(sessionId, 'none');
  }

  /** The session ended or was removed. */
  ended(sessionId: string): void {
    this.started(sessionId);
  }

  /** Clears every watch and its timer. */
  dispose(): void {
    for (const sessionId of [...this.watches.keys()]) this.stop(sessionId);
  }

  private stop(sessionId: string): void {
    const watch = this.watches.get(sessionId);
    if (watch?.timer !== undefined) this.deps.clearTimer(watch.timer);
    this.watches.delete(sessionId);
  }

  private arm(sessionId: string, watch: Watch, ms: number): void {
    if (watch.timer !== undefined) this.deps.clearTimer(watch.timer);
    watch.timer = this.deps.setTimer(() => {
      watch.timer = undefined;
      watch.phase = 'failed';
      this.deps.onState(sessionId, 'needs_user');
    }, ms);
  }
}
