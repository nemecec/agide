import { describe, expect, it } from 'vitest';
import { BUILTIN_VIEWS } from './viewTypes';

describe('built-in inbox views', () => {
  it('are All, Needs me and Done, in that order, all built in and not tied to a folder', () => {
    expect(BUILTIN_VIEWS.map((view) => view.id), 'ids').toEqual(['all', 'needs-me', 'done']);
    expect(BUILTIN_VIEWS.every((view) => view.builtin && view.folderId === null), 'built in, no folder').toBe(true);
    expect(BUILTIN_VIEWS.map((view) => view.position), 'positions follow the order').toEqual([0, 1, 2]);
  });

  it('show open items in All, questions and approvals and reviews in Needs me, and done items in Done', () => {
    const byId = Object.fromEntries(BUILTIN_VIEWS.map((view) => [view.id, view]));
    expect(byId['all']?.filter.states, 'All shows open states').toEqual(['new', 'seen', 'snoozed']);
    expect(byId['needs-me']?.filter, 'Needs me').toEqual({ kinds: ['input', 'approval', 'review'], states: ['new', 'seen'] });
    expect(byId['done']?.filter.states, 'Done shows done items').toEqual(['done']);
    expect(byId['done']?.sort, 'done items sort by time').toBe('time');
  });
});
