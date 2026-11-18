import { describe, expect, it } from 'vitest';
import { DOWNLOAD_QUIET_MS, isAbortedLoad, isAgentDownload, nativeBounds, pickEvictionVictim } from './viewPlacement';

describe('nativeBounds', () => {
  it('scales by the window zoom and rounds to whole pixels', () => {
    expect(nativeBounds({ x: 10.4, y: 20.6, width: 100.5, height: 50 }, 1.5), 'zoom 1.5').toEqual({ x: 16, y: 31, width: 151, height: 75 });
    expect(nativeBounds({ x: 10, y: 20, width: 100, height: 50 }, 1), 'zoom 1').toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('keeps at least one pixel of width and height', () => {
    expect(nativeBounds({ x: 0, y: 0, width: 0, height: 0.2 }, 1), 'empty slot').toMatchObject({ width: 1, height: 1 });
  });

  it('keeps a negative origin, as a partly scrolled-out slot has', () => {
    expect(nativeBounds({ x: -5, y: -3, width: 10, height: 10 }, 2), 'negative origin').toMatchObject({ x: -10, y: -6 });
  });
});

describe('pickEvictionVictim', () => {
  const entry = (leafId: string, placed: boolean, lastUsed: number) => ({ leafId, placed, lastUsed });

  it('picks nothing below the limit', () => {
    expect(pickEvictionVictim([entry('a', false, 1)], 2), 'below limit').toBeUndefined();
  });

  it('picks the longest unused view that no surface shows', () => {
    expect(pickEvictionVictim([entry('a', false, 30), entry('b', false, 10), entry('c', false, 20)], 3), 'oldest parked').toBe('b');
  });

  it('never picks a placed view, however old', () => {
    expect(pickEvictionVictim([entry('a', true, 1), entry('b', false, 50)], 2), 'placed view stays').toBe('b');
  });

  it('picks nothing when every view is shown', () => {
    expect(pickEvictionVictim([entry('a', true, 1), entry('b', true, 2)], 2), 'all shown').toBeUndefined();
  });
});

describe('isAgentDownload', () => {
  it('counts a download during an agent call and shortly after one', () => {
    expect(isAgentDownload({ acting: true, lastActed: 0, now: 1_000_000 }), 'acting').toBe(true);
    expect(isAgentDownload({ acting: false, lastActed: 1000, now: 1000 + DOWNLOAD_QUIET_MS - 1 }), 'just after').toBe(true);
  });

  it('leaves a download after the quiet time to the user', () => {
    expect(isAgentDownload({ acting: false, lastActed: 1000, now: 1000 + DOWNLOAD_QUIET_MS }), 'at the limit').toBe(false);
    expect(isAgentDownload({ acting: false, lastActed: 0, now: 1_000_000 }), 'never acted').toBe(false);
  });
});

describe('isAbortedLoad', () => {
  it('recognises the abort of a replaced load and no other error', () => {
    expect(isAbortedLoad(new Error('ERR_ABORTED (-3) loading https://x.test/')), 'aborted').toBe(true);
    expect(isAbortedLoad(new Error('ERR_NAME_NOT_RESOLVED (-105)')), 'dns').toBe(false);
    expect(isAbortedLoad('ERR_CERT_AUTHORITY_INVALID'), 'certificate').toBe(false);
  });
});
