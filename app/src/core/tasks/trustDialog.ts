const ESCAPES = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[()][A-Za-z0-9]|[0-9=>@-Z\\-_])/g;

const DIALOG_MARK = 'Quicksafetycheck';
const YES_SELECTED = '❯Yes,Itrustthisfolder';
const NO_SELECTED = '❯No,exit';

/** Down arrow and Enter as the TUI reads them. The dialog's default is `No, exit`. */
export const KEY_DOWN = '\u001b[B';
export const KEY_ENTER = '\r';

/**
 * Terminal output as plain text with every space removed. The TUI places each word with a cursor move, so
 * the words arrive without the spaces between them (0028 section 11, P24).
 */
export function screenText(raw: string): string {
  return raw.replace(ESCAPES, '').replace(/\s+/g, '');
}

/** Whether the text holds the folder-trust dialog (`screenText` form). */
export function showsTrustDialog(text: string): boolean {
  return text.includes(DIALOG_MARK);
}

/** The option the dialog highlights in the latest frame of the text; the later marker wins. */
export function trustHighlight(text: string): 'yes' | 'no' | undefined {
  const yes = text.lastIndexOf(YES_SELECTED);
  const no = text.lastIndexOf(NO_SELECTED);
  if (yes < 0 && no < 0) return undefined;
  return yes > no ? 'yes' : 'no';
}
