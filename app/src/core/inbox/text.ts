/** ANSI CSI, OSC and other ESC sequences. */
const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;
/** C0 and C1 controls except tab and line feed, plus DEL. */
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
/** Unicode format characters: bidi marks, embeddings, overrides and isolates, zero-width characters, the BOM. */
const FORMAT = /\p{Cf}/gu;
/** Line and paragraph separators. */
const SEPARATORS = /[\u2028\u2029]/g;

/** Removes escape sequences, control characters and format characters; line and paragraph separators become line feeds. Keeps tabs and line feeds. */
export function cleanText(text: string): string {
  return text.replace(ANSI, '').replace(/\r\n?/g, '\n').replace(SEPARATORS, '\n').replace(CONTROL, '').replace(FORMAT, '');
}

/** A cleaned single line: line breaks and tabs become spaces, runs of spaces collapse, ends trimmed. */
export function cleanLine(text: string): string {
  return cleanText(text).replace(/\s+/g, ' ').trim();
}
