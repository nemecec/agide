import { describe, expect, it } from 'vitest';
import { isFocusRequest } from './focusRequest';

describe('isFocusRequest', () => {
  it('accepts the focus request of the same profile', () => {
    expect(isFocusRequest({ profileId: 'work', action: 'focus' }, 'work'), 'matching request').toBe(true);
  });

  it('refuses a request for another profile or another action', () => {
    expect(isFocusRequest({ profileId: 'home', action: 'focus' }, 'work'), 'other profile').toBe(false);
    expect(isFocusRequest({ profileId: 'work', action: 'quit' }, 'work'), 'other action').toBe(false);
    expect(isFocusRequest({ profileId: 'work' }, 'work'), 'no action').toBe(false);
  });

  it('refuses data that is not an object', () => {
    for (const data of [undefined, null, 'focus', 7, []]) expect(isFocusRequest(data, 'work'), `${JSON.stringify(data)}`).toBe(false);
  });
});
