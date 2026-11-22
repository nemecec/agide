import { chmodSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeTempDirs, tempDir, write } from './gitFixtures';
import { sweepCheckLeftovers } from './checkLeftovers';
import type { CheckProcesses, SweepOutcome } from './ProcessSweep';

afterEach(() => removeTempDirs());

const NOTHING: SweepOutcome = { count: 0, names: [], remaining: 0 };

function leftovers() {
  const root = tempDir('leftovers');
  const checkoutRoot = join(root, 'review-checks', 'p');
  const settingsDir = join(root, 'srt-checks');
  const other = join(root, 'review-checks', 'other-profile');
  write(join(checkoutRoot, 'sw1', 'chk_aaaaaaaaaaaaaaaa', 'file'), 'checkout\n');
  write(join(checkoutRoot, 'sw1', 'chk_aaaaaaaaaaaaaaaa-tmp', 'scratch'), 'what the check wrote\n');
  write(join(settingsDir, 'chk_aaaaaaaaaaaaaaaa-command.json'), '{}\n');
  write(join(other, 'sw9', 'chk_bbbbbbbbbbbbbbbb', 'file'), 'a checkout of another profile\n');
  const events: string[] = [];
  const processes: CheckProcesses = {
    endRun: async () => NOTHING,
    endStale: async (live) => {
      events.push(`processes:${live.size}:checkout-present=${existsSync(join(checkoutRoot, 'sw1', 'chk_aaaaaaaaaaaaaaaa'))}`);
      return NOTHING;
    },
  };
  const clones = { sweep: async () => void events.push('clones') };
  return { root, checkoutRoot, settingsDir, other, events, processes, clones };
}

describe('what a killed app leaves behind', () => {
  it('ends the processes first, then removes the checkouts with their temporary directories, the settings files and the clones', async () => {
    const l = leftovers();
    await sweepCheckLeftovers(l);
    expect(l.events, 'the processes were ended while the checkout still existed, with no run live').toEqual(['processes:0:checkout-present=true', 'clones']);
    expect([readdirSync(l.checkoutRoot), readdirSync(l.settingsDir)], 'checkouts, temporary directories and settings files are gone').toEqual([[], []]);
    expect(existsSync(join(l.other, 'sw9', 'chk_bbbbbbbbbbbbbbbb', 'file')), 'another profile has its own root and is not touched').toBe(true);
  });

  it('removes a tree whose files the check made read-only', async () => {
    const l = leftovers();
    write(join(l.checkoutRoot, 'sw1', 'chk_aaaaaaaaaaaaaaaa-tmp', 'locked', 'file'), 'x\n');
    const locked = join(l.checkoutRoot, 'sw1', 'chk_aaaaaaaaaaaaaaaa-tmp', 'locked');
    chmodSync(locked, 0o555);
    try {
      await sweepCheckLeftovers(l);
      expect(readdirSync(l.checkoutRoot), 'removed although a directory had no write bit').toEqual([]);
    } finally {
      // The fixture directory stays removable when the sweep failed.
      if (existsSync(locked)) chmodSync(locked, 0o755);
    }
  });

  it('does nothing and does not fail when the directories do not exist', async () => {
    const l = leftovers();
    await expect(sweepCheckLeftovers({ ...l, checkoutRoot: join(l.root, 'none'), settingsDir: join(l.root, 'none-either') }), 'no directories, no error').resolves.toBeUndefined();
  });

  it('removes the directories although the process list cannot be read, and reports the error', async () => {
    const l = leftovers();
    const failing: CheckProcesses = { endRun: async () => NOTHING, endStale: async () => Promise.reject(new Error('ps failed')) };
    await expect(sweepCheckLeftovers({ ...l, processes: failing }), 'the first error is thrown at the end').rejects.toThrow('ps failed');
    expect(readdirSync(l.checkoutRoot), 'the other steps ran').toEqual([]);
  });
});
