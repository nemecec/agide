import { describe, expect, it } from 'vitest';
import { InMemoryProfileRegistry, InMemoryRegistryHub } from './InMemoryProfileRegistry';
import { InMemoryProfileStore } from './InMemoryProfileStore';
import { profilePaths } from './paths';
import { describeProfileRegistryContract, describeProfileStoreContract } from './profileContracts';
import { profileIdFromName, registryEntrySchema } from './schemas';

describeProfileStoreContract('InMemoryProfileStore', (ownerId) => new InMemoryProfileStore({ ownerId }));

describeProfileRegistryContract('InMemoryProfileRegistry', (liveness) => {
  const hub = new InMemoryRegistryHub();
  return { open: (profileId, pid) => new InMemoryProfileRegistry(hub, { profileId, pid, liveness }) };
});

describe('profile ids and paths', () => {
  it('derives an id that starts with a letter and holds only lowercase letters, digits and hyphens', () => {
    expect(profileIdFromName('  Client: ACME / 2026 '), 'punctuation becomes hyphens').toBe('client-acme-2026');
    expect(profileIdFromName('2026 plan'), 'leading digits are dropped').toBe('plan');
    expect(profileIdFromName('!!!'), 'nothing usable falls back').toBe('profile');
  });

  it('keeps every profile file under its own directory', () => {
    const paths = profilePaths('/root', 'work');
    for (const path of [paths.definition, paths.settings, paths.data, paths.claude, paths.sessionFiles, paths.tools.gitconfig]) {
      expect(path.startsWith('/root/profiles/work/'), `${path} lies under the profile directory`).toBe(true);
    }
  });

  it('refuses a registry entry with fields outside the schema', () => {
    const entry = { schema: 1, profileId: 'work', pid: 1, instanceId: 'abcdefgh', updatedAt: '2026-11-17T12:00:00.000Z' };
    expect(registryEntrySchema.safeParse(entry).success, 'valid entry').toBe(true);
    expect(registryEntrySchema.safeParse({ ...entry, name: 'Work' }).success, 'a name field is refused').toBe(false);
    expect(registryEntrySchema.safeParse({ ...entry, unread: -1 }).success, 'a negative count is refused').toBe(false);
  });
});
