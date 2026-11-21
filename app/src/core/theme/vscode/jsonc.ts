/** Removes comments and trailing commas from JSON with comments, the format of VS Code theme files. String contents stay as written. */
export function stripJsonComments(text: string): string {
  let out = '';
  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    const next = text.charAt(index + 1);
    if (char === '"') {
      let end = index + 1;
      while (end < text.length && text.charAt(end) !== '"') end += text.charAt(end) === '\\' ? 2 : 1;
      out += text.slice(index, end + 1);
      index = end + 1;
    } else if (char === '/' && next === '/') {
      while (index < text.length && text.charAt(index) !== '\n') index++;
    } else if (char === '/' && next === '*') {
      const end = text.indexOf('*/', index + 2);
      index = end === -1 ? text.length : end + 2;
    } else {
      out += char;
      index++;
    }
  }
  return removeTrailingCommas(out);
}

function removeTrailingCommas(text: string): string {
  let out = '';
  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === '"') {
      let end = index + 1;
      while (end < text.length && text.charAt(end) !== '"') end += text.charAt(end) === '\\' ? 2 : 1;
      out += text.slice(index, end + 1);
      index = end + 1;
    } else if (char === ',') {
      let look = index + 1;
      while (/\s/.test(text.charAt(look))) look++;
      if (text.charAt(look) !== '}' && text.charAt(look) !== ']') out += char;
      index++;
    } else {
      out += char;
      index++;
    }
  }
  return out;
}

/** Parses JSON with comments and a leading byte order mark. Throws the engine's error on bad input. */
export function parseJsonc(text: string): unknown {
  return JSON.parse(stripJsonComments(text.replace(/^﻿/, '')));
}
