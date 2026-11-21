import { describe, expect, it } from 'vitest';
import type { LayoutDocument } from '../../core/blocks/layout';
import { inboxInstanceId } from './inboxInstance';

const layout = (types: Record<string, string>): LayoutDocument =>
  ({ instances: Object.fromEntries(Object.entries(types).map(([id, type]) => [id, { type, version: '^1', configVersion: 1, config: {} }])) }) as unknown as LayoutDocument;

describe('inboxInstanceId', () => {
  it('finds the inbox pane of a layout', () => {
    expect(inboxInstanceId(layout({ tree: 'agide/tree', mail: 'agide/inbox' })), 'inbox instance').toBe('mail');
  });

  it('returns nothing for a layout without an inbox', () => {
    expect(inboxInstanceId(layout({ tree: 'agide/tree' })), 'no inbox').toBeUndefined();
  });
});
