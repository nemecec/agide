import { describe, expect, it } from 'vitest';
import { ratio } from './colour';
import { profileMarkColour, profileTileColour } from './profileColour';

const PALETTE = ['#5b7fa6', '#b5651d', '#4f8a5b', '#a64f7e', '#7a5fb0', '#b0453a', '#2f8f9d', '#8a7a2f'];
const LIGHT_WINDOW = '#ececef';
const DARK_WINDOW = '#202023';

describe('profile colours', () => {
  it('darkens a tile colour until the white letter reads at 4.5 to 1', () => {
    for (const stored of PALETTE) {
      expect(ratio('#ffffff', profileTileColour(stored)), `white letter on the tile of ${stored}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps a tile colour that already reads and moves one that does not by the amount the design record lists', () => {
    expect(profileTileColour('#a64f7e'), 'already readable').toBe('#a64f7e');
    expect(profileTileColour('#5b7fa6'), 'moved 6 percent').toBe('#56779c');
    expect(profileTileColour('#2f8f9d'), 'moved 10 percent').toBe('#2a818d');
  });

  it('moves a mark colour until it reaches 3 to 1 against the window of either appearance', () => {
    for (const stored of PALETTE) {
      expect(ratio(profileMarkColour(stored, LIGHT_WINDOW, false), LIGHT_WINDOW), `mark of ${stored} on the light window`).toBeGreaterThanOrEqual(3);
      expect(ratio(profileMarkColour(stored, DARK_WINDOW, true), DARK_WINDOW), `mark of ${stored} on the dark window`).toBeGreaterThanOrEqual(3);
    }
  });

  it('leaves a mark colour alone when it already reads and moves the red one slightly on the dark window', () => {
    expect(profileMarkColour('#5b7fa6', LIGHT_WINDOW, false), 'blue on light').toBe('#5b7fa6');
    expect(profileMarkColour('#b0453a', DARK_WINDOW, true), 'red on dark').toBe('#b2493e');
  });
});
