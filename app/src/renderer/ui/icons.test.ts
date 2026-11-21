import { describe, expect, it } from 'vitest';
import { ACTION_ICONS, INBOX_KIND_ICONS, PANE_ICONS, STATUS_ICONS, STATUS_TONES, SURFACE_ICONS, THEME_ICONS, TONE_ICONS, type IconSpec } from './icons';

const groups: Record<string, Record<string, IconSpec>> = {
  surfaces: SURFACE_ICONS,
  panes: PANE_ICONS,
  statuses: STATUS_ICONS,
  'inbox kinds': INBOX_KIND_ICONS,
  tones: TONE_ICONS,
  actions: ACTION_ICONS,
  themes: THEME_ICONS,
};

describe('icon mapping', () => {
  for (const [name, group] of Object.entries(groups)) {
    it(`gives every ${name} entry a glyph and a name for assistive technology`, () => {
      for (const [key, spec] of Object.entries(group)) {
        expect(spec.icon, `${name} "${key}" has a glyph`).toBeDefined();
        expect(spec.label.trim(), `${name} "${key}" has a name`).not.toBe('');
      }
    });

    it(`keeps the names of ${name} apart, so two meanings never read the same`, () => {
      const labels = Object.values(group).map((spec) => spec.label);
      expect(new Set(labels).size, `${name} names are unique`).toBe(labels.length);
    });
  }

  it('draws each status with its own shape, so a status never rests on colour alone', () => {
    const glyphs = Object.values(STATUS_ICONS).map((spec) => spec.icon);
    expect(new Set(glyphs).size, 'no two statuses share a glyph').toBe(glyphs.length);
  });

  it('keeps the failure kind of the inbox apart from the failed status by shape', () => {
    expect(INBOX_KIND_ICONS.failure.icon, 'failure kind and failed status use different glyphs').not.toBe(STATUS_ICONS.failed.icon);
  });

  it('gives every status a tone, with the user-facing meanings of the record', () => {
    expect(Object.keys(STATUS_TONES).sort(), 'every status has a tone').toEqual(Object.keys(STATUS_ICONS).sort());
    expect(STATUS_TONES.waiting, 'waiting for the user is the warning tone').toBe('warning');
    expect(STATUS_TONES.failed, 'failed is the danger tone').toBe('danger');
    expect(STATUS_TONES.idle, 'idle is neutral').toBe('neutral');
  });

  it('maps the inbox kinds to tones, with failure as danger and approval as warning', () => {
    expect(INBOX_KIND_ICONS.failure.tone, 'failure tone').toBe('danger');
    expect(INBOX_KIND_ICONS.approval.tone, 'approval tone').toBe('warning');
  });
});
