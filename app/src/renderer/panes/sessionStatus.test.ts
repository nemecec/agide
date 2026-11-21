import { describe, expect, it } from 'vitest';
import { sessionStatusKind } from './sessionStatus';

describe('sessionStatusKind', () => {
  it('maps every session status to the chip status that shows its glyph and word', () => {
    expect(sessionStatusKind('idle'), 'idle').toBe('idle');
    expect(sessionStatusKind('busy'), 'busy').toBe('busy');
    expect(sessionStatusKind('waiting'), 'waiting').toBe('waiting');
    expect(sessionStatusKind('exited'), 'exited').toBe('exited');
    expect(sessionStatusKind('starting'), 'a starting session works, so it reads as busy').toBe('busy');
    expect(sessionStatusKind('closed'), 'a session that is gone reads as exited').toBe('exited');
    expect(sessionStatusKind('loading'), 'the peek starts as loading and reads as busy').toBe('busy');
    expect(sessionStatusKind('unexpected'), 'an unknown state reads as idle').toBe('idle');
  });
});
