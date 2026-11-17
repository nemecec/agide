import { describe, expect, it, vi } from 'vitest';
import type { Liveness } from './registryStatus';
import { ProfileError, REGISTRY_STALE_MS, type ProfileId, type ProfileRegistry, type ProfileStore } from './types';

const errorCode = (work: () => unknown): string | undefined => {
  try {
    work();
    return undefined;
  } catch (error) {
    return error instanceof ProfileError ? error.code : `not a ProfileError: ${String(error)}`;
  }
};

/**
 * Behaviour every `ProfileStore` must show. `create(ownerId)` returns a store whose process owns `ownerId`.
 * Each call starts from an empty root.
 */
export function describeProfileStoreContract(name: string, create: (ownerId: ProfileId) => ProfileStore): void {
  describe(`${name} (ProfileStore contract)`, () => {
    it('creates a profile with an id from its name and lists it', () => {
      const store = create('work-client');
      const created = store.create({ name: 'Work Client', colour: '#336699' });
      expect(created.id, 'id derived from the name').toBe('work-client');
      expect(store.list().map((p) => p.id), 'the new profile is listed').toEqual(['work-client']);
      expect(store.get('work-client')?.name, 'definition holds the trimmed name').toBe('Work Client');
    });

    it('makes a derived id unique and refuses an explicit id that is taken', () => {
      const store = create('home');
      store.create({ name: 'Home', colour: '#336699' });
      expect(store.create({ name: 'Home', colour: '#336699' }).id, 'second derived id gets a suffix').toBe('home-2');
      expect(errorCode(() => store.create({ id: 'home', name: 'Other', colour: '#336699' })), 'explicit taken id').toBe('exists');
    });

    it('refuses an invalid id, name or colour and creates nothing', () => {
      const store = create('x');
      expect(errorCode(() => store.create({ id: 'Bad Id', name: 'x', colour: '#336699' })), 'id with a space').toBe('invalid');
      expect(errorCode(() => store.create({ name: ' ', colour: '#336699' })), 'blank name').toBe('invalid');
      expect(errorCode(() => store.create({ name: 'ok', colour: 'red' })), 'colour not in #rrggbb form').toBe('invalid');
      expect(store.list(), 'nothing was created').toEqual([]);
    });

    it('gives the default profile the CLI default login and inherited tools, other profiles their own', () => {
      const own = create('default');
      own.create({ id: 'default', name: 'Default', colour: '#336699' });
      expect(own.readSettings('default').claudeConfig, 'default profile login').toEqual({ mode: 'cli-default' });
      expect(own.readSettings('default').tools.mode, 'default profile tools').toBe('inherit');
      const other = create('second');
      other.create({ id: 'second', name: 'Second', colour: '#336699' });
      const settings = other.readSettings('second');
      expect(settings.claudeConfig.mode, 'new profile has its own Claude directory').toBe('directory');
      expect(settings.tools.mode, 'new profile isolates tool credentials').toBe('isolated');
      expect(settings.isolation.provider, 'local provider by default').toBe('local');
    });

    it('lets only the owning profile read or change its settings and definition', () => {
      const store = create('mine');
      store.create({ id: 'mine', name: 'Mine', colour: '#336699' });
      store.create({ id: 'theirs', name: 'Theirs', colour: '#996633' });
      expect(errorCode(() => store.readSettings('theirs')), 'reading another profile settings').toBe('not_owner');
      expect(errorCode(() => store.updateSettings('theirs', { showBadge: false })), 'changing another profile settings').toBe('not_owner');
      expect(errorCode(() => store.updateDefinition('theirs', { name: 'x' })), 'renaming another profile').toBe('not_owner');
      expect(store.updateSettings('mine', { showBadge: false }).showBadge, 'own settings change').toBe(false);
      expect(store.readSettings('mine').showBadge, 'own settings change is stored').toBe(false);
      expect(store.updateDefinition('mine', { colour: '#000000' }).colour, 'own colour change').toBe('#000000');
    });

    it('refuses settings that fail the schema and keeps the old ones', () => {
      const store = create('mine');
      store.create({ id: 'mine', name: 'Mine', colour: '#336699' });
      const relative = { claudeConfig: { mode: 'directory', path: 'relative/path' } } as const;
      expect(errorCode(() => store.updateSettings('mine', relative)), 'relative Claude directory').toBe('invalid');
      expect(store.readSettings('mine').claudeConfig.mode, 'settings unchanged').toBe('directory');
    });
  });
}

/** A clock and pid table the test controls. */
export class TestLiveness implements Liveness {
  time = Date.parse('2026-11-17T12:00:00.000Z');
  readonly dead = new Set<number>();
  readonly now = (): Date => new Date(this.time);
  readonly isAlive = (pid: number): boolean => !this.dead.has(pid);
}

export interface RegistryHarness {
  /** A registry as seen by the process of `profileId` with `pid`. All registries of one harness share state. */
  open(profileId: ProfileId, pid: number): ProfileRegistry;
  cleanup?(): void;
}

/** Behaviour every `ProfileRegistry` must show. */
export function describeProfileRegistryContract(name: string, setup: (liveness: TestLiveness) => RegistryHarness): void {
  describe(`${name} (ProfileRegistry contract)`, () => {
    const withHarness = (test: (h: RegistryHarness, liveness: TestLiveness) => Promise<void> | void) => async () => {
      const liveness = new TestLiveness();
      const harness = setup(liveness);
      try {
        await test(harness, liveness);
      } finally {
        harness.cleanup?.();
      }
    };

    it(
      'shows a published entry to other profiles as running with its unread count',
      withHarness((h) => {
        const work = h.open('work', 101);
        const home = h.open('home', 102);
        work.publish({ unread: 3 });
        expect(home.statuses(), 'home sees work').toEqual([{ profileId: 'work', running: true, unread: 3 }]);
        work.dispose();
        home.dispose();
      }),
    );

    it(
      'omits the unread count when the publisher leaves it out',
      withHarness((h) => {
        const work = h.open('work', 101);
        work.publish({});
        expect(work.statuses()[0], 'no unread field').toEqual({ profileId: 'work', running: true });
        work.dispose();
      }),
    );

    it(
      'replaces the own entry on each publish and removes it on withdraw',
      withHarness((h) => {
        const work = h.open('work', 101);
        const home = h.open('home', 102);
        work.publish({ unread: 1 });
        work.publish({ unread: 5 });
        expect(home.statuses(), 'one entry with the latest count').toEqual([{ profileId: 'work', running: true, unread: 5 }]);
        work.withdraw();
        expect(home.statuses(), 'withdrawn entry is gone').toEqual([]);
        work.dispose();
        home.dispose();
      }),
    );

    it(
      'shows a profile as not running when its pid is dead or its entry is old',
      withHarness((h, liveness) => {
        const work = h.open('work', 101);
        const home = h.open('home', 102);
        const reader = h.open('reader', 103);
        work.publish({});
        home.publish({});
        liveness.dead.add(101);
        expect(reader.statuses().find((s) => s.profileId === 'work')?.running, 'dead pid').toBe(false);
        expect(reader.statuses().find((s) => s.profileId === 'home')?.running, 'live pid with a fresh entry').toBe(true);
        liveness.time += REGISTRY_STALE_MS + 1;
        expect(reader.statuses().find((s) => s.profileId === 'home')?.running, 'entry older than the stale limit').toBe(false);
        expect(reader.statuses().map((s) => s.profileId), 'readers keep stale entries').toEqual(['home', 'work']);
        for (const r of [work, home, reader]) r.dispose();
      }),
    );

    it(
      'lists statuses sorted by profile id',
      withHarness((h) => {
        const registries = ['zeta', 'alpha', 'mid'].map((id, index) => h.open(id, 200 + index));
        for (const registry of registries) registry.publish({});
        expect(registries[0]?.statuses().map((s) => s.profileId), 'sorted ids').toEqual(['alpha', 'mid', 'zeta']);
        for (const registry of registries) registry.dispose();
      }),
    );

    it(
      'tells subscribers when another profile publishes',
      withHarness(async (h) => {
        const work = h.open('work', 101);
        const home = h.open('home', 102);
        const listener = vi.fn();
        home.subscribe(listener);
        work.publish({ unread: 2 });
        await vi.waitFor(
          () => expect(listener, 'subscriber called with the new entry').toHaveBeenCalledWith([{ profileId: 'work', running: true, unread: 2 }]),
          { timeout: 8000 },
        );
        work.dispose();
        home.dispose();
      }),
    );
  });
}
