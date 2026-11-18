import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KEY_DOWN, screenText, showsTrustDialog, trustHighlight } from './trustDialog';

const fixture = (name: string): string => (JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as { frame: string }).frame;

describe('folder-trust dialog detection', () => {
  it('recognises the recorded dialog although cursor moves split its words', () => {
    const text = screenText(fixture('trust-dialog.json'));
    expect(showsTrustDialog(text), 'dialog shown').toBe(true);
    expect(trustHighlight(text), 'default highlight is No, exit').toBe('no');
  });

  it('does not see a dialog in the output of a TUI that started without one', () => {
    const text = screenText(fixture('no-dialog.json'));
    expect(showsTrustDialog(text), 'no dialog').toBe(false);
    expect(trustHighlight(text), 'no highlight').toBeUndefined();
  });

  it('reads the highlight from the later marker', () => {
    expect(trustHighlight(screenText('\u001b[2G❯\u001b[4GNo, exit\r\n\u001b[2G❯\u001b[4GYes, I trust this folder')), 'yes after no').toBe('yes');
    expect(trustHighlight(screenText('❯ Yes, I trust this folder ❯ No, exit')), 'no after yes').toBe('no');
  });

  it('sends the down arrow as the TUI reads it', () => {
    expect(KEY_DOWN, 'down arrow').toBe('\u001b[B');
  });
});
