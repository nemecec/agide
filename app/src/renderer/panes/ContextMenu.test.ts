import { describe, expect, it } from 'vitest';
import { clampToWindow } from './ContextMenu';

describe('clampToWindow', () => {
  it('keeps a menu opened near the bottom or right edge inside the window', () => {
    expect(clampToWindow(150, 600, 180, 200, 1440, 900), 'a menu that fits stays at the pointer').toEqual({ left: 150, top: 600 });
    expect(clampToWindow(150, 800, 180, 200, 1440, 900), 'a menu that would run past the bottom moves up').toEqual({ left: 150, top: 696 });
    expect(clampToWindow(1400, 100, 180, 200, 1440, 900), 'a menu that would run past the right edge moves left').toEqual({ left: 1256, top: 100 });
  });

  it('never moves a menu past the top or left edge when the window is smaller than the menu', () => {
    expect(clampToWindow(10, 10, 500, 500, 300, 300), 'oversize menu').toEqual({ left: 4, top: 4 });
  });
});
