import { describe, expect, it } from 'vitest';
import { InMemoryTreeService } from '../tree/index';
import { requireInScope } from './scope';
import { CommandError, type Caller } from './types';

function setup() {
  const tree = new InMemoryTreeService();
  const mine = tree.createFolder({ title: 'Mine', parentId: null });
  const theirs = tree.createFolder({ title: 'Theirs', parentId: null });
  const inside = tree.createFolder({ title: 'Inside', parentId: mine.id });
  const agent: Caller = { kind: 'mcp', sessionId: 's1', folderId: mine.id };
  return { tree, mine, theirs, inside, agent };
}

const codeOf = (run: () => void): string | undefined => {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof CommandError ? error.code : 'other';
  }
};

describe('requireInScope', () => {
  it('lets the UI name any node and the top level', () => {
    const { tree, theirs } = setup();
    expect(codeOf(() => requireInScope(tree, { kind: 'ui' }, theirs.id)), 'node anywhere').toBeUndefined();
    expect(codeOf(() => requireInScope(tree, { kind: 'ui' }, null)), 'top level').toBeUndefined();
  });

  it('lets an agent name its folder and nodes below it', () => {
    const { tree, mine, inside, agent } = setup();
    expect(codeOf(() => requireInScope(tree, agent, mine.id)), 'own folder').toBeUndefined();
    expect(codeOf(() => requireInScope(tree, agent, inside.id)), 'nested folder').toBeUndefined();
  });

  it('refuses a node elsewhere in the tree as out of scope', () => {
    const { tree, theirs, agent } = setup();
    expect(codeOf(() => requireInScope(tree, agent, theirs.id)), 'other folder').toBe('out_of_scope');
  });

  it('refuses the top level as out of scope', () => {
    const { tree, agent } = setup();
    expect(codeOf(() => requireInScope(tree, agent, null)), 'top level').toBe('out_of_scope');
  });

  it('answers an id that does not exist as not found, not as out of scope', () => {
    const { tree, agent } = setup();
    expect(codeOf(() => requireInScope(tree, agent, 'missing')), 'unknown id').toBe('not_found');
  });
});
