/**
 * Glob matching for policy paths and rule lists. `**` crosses directories, `*` and `?` stay inside one, `{a,b}`
 * alternates. A pattern without a slash matches the file name at any depth; a leading `/` anchors at the root.
 */

const cache = new Map<string, RegExp>();

function translate(pattern: string): string {
  let out = '';
  let braces = 0;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        while (pattern[i + 1] === '*') i++;
        if (pattern[i + 1] === '/') {
          out += '(?:.*/)?';
          i++;
        } else {
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else if (c === '{') {
      braces++;
      out += '(?:';
    } else if (c === '}' && braces > 0) {
      braces--;
      out += ')';
    } else if (c === ',' && braces > 0) {
      out += '|';
    } else {
      out += c.replace(/[.+^$()|[\]\\{}]/g, '\\$&');
    }
  }
  return out + ')'.repeat(braces);
}

export function compileGlob(pattern: string, caseInsensitive = false): RegExp {
  const key = `${caseInsensitive ? 'i' : 's'}:${pattern}`;
  const known = cache.get(key);
  if (known !== undefined) return known;
  let body = pattern.replace(/^\.\//, '');
  let anchored = false;
  if (body.startsWith('/')) {
    body = body.slice(1);
    anchored = true;
  }
  const prefix = !anchored && !body.includes('/') ? '(?:.*/)?' : '';
  const compiled = new RegExp(`^${prefix}${translate(body)}$`, caseInsensitive ? 'i' : '');
  cache.set(key, compiled);
  return compiled;
}

export const matchesGlob = (path: string, glob: string, caseInsensitive = false): boolean => compileGlob(glob, caseInsensitive).test(path);

/** The first glob that matches, or undefined. */
export const firstMatch = (path: string, globs: readonly string[], caseInsensitive = false): string | undefined => globs.find((glob) => matchesGlob(path, glob, caseInsensitive));
