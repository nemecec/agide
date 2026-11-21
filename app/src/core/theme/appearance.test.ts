import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE, normaliseAccent, parseAppearanceMessage } from './appearance';

describe('normaliseAccent', () => {
  it('drops the alpha pair of the OS value and lower-cases', () => {
    expect(normaliseAccent('007AFFFF'), 'RRGGBBAA').toBe('#007aff');
    expect(normaliseAccent('#953d96'), 'with hash').toBe('#953d96');
  });

  it('gives null for an empty, malformed or non-string value', () => {
    expect([normaliseAccent(''), normaliseAccent('blue'), normaliseAccent(undefined), normaliseAccent(false)], 'unusable values').toEqual([null, null, null, null]);
  });
});

describe('parseAppearanceMessage', () => {
  it('reads a well-formed message', () => {
    const message = { themeId: 'agide-dark', state: { dark: true, accent: '#007aff', highContrast: true, reducedTransparency: true, differentiateWithoutColour: true } };
    expect(parseAppearanceMessage(message), 'message passes through').toEqual(message);
  });

  it('gives the defaults for unknown shapes and an unusable theme id', () => {
    expect(parseAppearanceMessage(undefined), 'undefined').toEqual({ themeId: 'system', state: DEFAULT_APPEARANCE });
    expect(parseAppearanceMessage({ themeId: 'A B', state: 3 }).themeId, 'bad id').toBe('system');
  });
});
