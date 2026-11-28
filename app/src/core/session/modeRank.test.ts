import { describe, expect, it } from 'vitest';
import { isLooser, MODE_ORDER } from '../permissions/modes';
import { MODE_RANK, type PermissionMode } from './types';

describe('MODE_RANK', () => {
  it('numbers the modes from the strictest to the loosest in the order of MODE_ORDER', () => {
    expect(MODE_RANK, 'the ranks of the five modes').toEqual({ plan: 0, default: 1, acceptEdits: 2, auto: 3, bypassPermissions: 4 });
  });

  it('agrees with isLooser for every pair of modes', () => {
    for (const a of MODE_ORDER) {
      for (const b of MODE_ORDER as readonly PermissionMode[]) {
        expect(MODE_RANK[a] > MODE_RANK[b], `${a} against ${b}`).toBe(isLooser(a, b));
      }
    }
  });
});
