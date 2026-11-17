import { describe, expect, it, vi } from 'vitest';
import { FIRST_PARTY_MANIFEST, PANE_TYPES } from './firstParty';
import { BlockError, type BlockRegistry } from './types';

const thirdParty = (overrides: Record<string, unknown> = {}) => ({
  apiVersion: '1.0',
  id: 'review-board',
  version: '0.3.1',
  title: 'Review board',
  engines: { agide: '>=0.2.0 <0.4.0' },
  panes: [{ type: 'review-board/board', title: 'Board', tier: 'code', entry: 'panes/board/index.html', configVersion: 2 }],
  permissions: ['commands.invoke:ui_focus_node', 'storage.block'],
  ...overrides,
});

const codeOf = (work: () => unknown): string | undefined => {
  try {
    work();
    return undefined;
  } catch (error) {
    return error instanceof BlockError ? error.code : `not a BlockError: ${String(error)}`;
  }
};

/** Behaviour every `BlockRegistry` must show. */
export function describeBlockRegistryContract(name: string, create: () => BlockRegistry): void {
  describe(`${name} (BlockRegistry contract)`, () => {
    it('registers the first-party block and lists its pane types sorted by id', () => {
      const registry = create();
      registry.register(FIRST_PARTY_MANIFEST, 'first-party');
      const types = registry.paneTypes().map((entry) => entry.pane.type);
      expect(types, 'first-party pane types').toEqual([...Object.values(PANE_TYPES)].sort());
      expect(registry.paneType(PANE_TYPES.tree)?.origin, 'origin is kept').toBe('first-party');
    });

    it('refuses an invalid manifest with the JSON paths of its problems', () => {
      const registry = create();
      let error: unknown;
      try {
        registry.register(thirdParty({ panes: [{ type: 'other-block/board', title: 'x', tier: 'builtin', configVersion: 1 }] }), 'plugin');
      } catch (caught) {
        error = caught;
      }
      expect(error, 'a BlockError').toBeInstanceOf(BlockError);
      expect((error as BlockError).code, 'error code').toBe('invalid');
      expect((error as BlockError).issues?.map((issue) => issue.path), 'path of the foreign pane type').toContain('/panes/0/type');
      expect(registry.list(), 'nothing registered').toEqual([]);
    });

    it('refuses a permission outside the closed set', () => {
      const registry = create();
      expect(codeOf(() => registry.register(thirdParty({ permissions: ['fs.read:/'] }), 'plugin')), 'unknown permission').toBe('invalid');
    });

    it('reserves the agide block id for first-party blocks', () => {
      const registry = create();
      expect(codeOf(() => registry.register(FIRST_PARTY_MANIFEST, 'plugin')), 'plugin claiming agide').toBe('reserved');
    });

    it('refuses a second block with a registered id', () => {
      const registry = create();
      registry.register(thirdParty(), 'plugin');
      expect(codeOf(() => registry.register(thirdParty({ version: '0.4.0' }), 'local')), 'same block id again').toBe('exists');
    });

    it('resolves an instance to its pane type, or to a placeholder with the reason', () => {
      const registry = create();
      registry.register(thirdParty(), 'plugin');
      expect(registry.resolve({ type: 'review-board/board', version: '^0.3' }).status, 'version in range').toBe('ok');
      const outOfRange = registry.resolve({ type: 'review-board/board', version: '^1' });
      expect(outOfRange.status === 'placeholder' && outOfRange.reason, 'version out of range').toBe('version');
      const missing = registry.resolve({ type: 'gone/pane', version: '^1' });
      expect(missing.status === 'placeholder' && missing.reason, 'unknown type').toBe('missing');
      registry.setEnabled('review-board', false);
      const disabled = registry.resolve({ type: 'review-board/board', version: '^0.3' });
      expect(disabled.status === 'placeholder' && disabled.reason, 'disabled block').toBe('disabled');
    });

    it('forgets a block on unregister and reports changes to subscribers', () => {
      const registry = create();
      const listener = vi.fn();
      registry.subscribe(listener);
      const unregister = registry.register(thirdParty(), 'plugin');
      registry.setEnabled('review-board', false);
      unregister();
      expect(registry.paneType('review-board/board'), 'pane type gone after unregister').toBeUndefined();
      expect(listener, 'register, disable and unregister each notify').toHaveBeenCalledTimes(3);
      expect(listener, 'event names the block').toHaveBeenLastCalledWith({ type: 'blocks.changed', blockIds: ['review-board'] });
    });

    it('answers not_found when enabling an unknown block', () => {
      expect(codeOf(() => create().setEnabled('nothing', true)), 'unknown block').toBe('not_found');
    });
  });
}
