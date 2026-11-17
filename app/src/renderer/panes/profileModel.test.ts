import { describe, expect, it } from 'vitest';
import { badgeText, initialOf } from './profileModel';

describe('initialOf', () => {
  it('uppercases the first letter of the trimmed name', () => {
    expect(initialOf('work'), 'plain name').toBe('W');
    expect(initialOf('  home'), 'leading space').toBe('H');
  });

  it('falls back to a question mark for a blank name', () => {
    expect(initialOf(''), 'empty').toBe('?');
    expect(initialOf('   '), 'spaces').toBe('?');
  });
});

describe('badgeText', () => {
  it('shows nothing for no unread items', () => {
    expect(badgeText(undefined), 'unknown count').toBeUndefined();
    expect(badgeText(0), 'zero').toBeUndefined();
    expect(badgeText(-3), 'negative').toBeUndefined();
  });

  it('shows the count up to 99 and 99+ beyond', () => {
    expect(badgeText(1), 'one').toBe('1');
    expect(badgeText(99), 'upper bound').toBe('99');
    expect(badgeText(100), 'past the bound').toBe('99+');
  });
});
