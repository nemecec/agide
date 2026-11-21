import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * The check behind `pnpm check:colours`: after the migration of 0035, no stylesheet or component of the renderer
 * holds a colour literal. Tokens live in `core/theme/builtin`; tests may use literals.
 */

const HEX = /(?<![\w&])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-z_-])/gi;
const COLOUR_FUNCTION = /\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(/gi;
const COLOUR_PROPERTY = /(?:^|[;{\s])(?:color|background(?:-color)?|border(?:-[a-z]+)*|outline(?:-color)?|fill|stroke|box-shadow|text-shadow|caret-color|accent-color)\s*:\s*([^;}]*)/gi;
const NAMED_COLOURS = new Set(
  'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgray darkgreen darkgrey darkorange darkred dodgerblue firebrick forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lightblue lightgray lightgreen lightgrey lightyellow lime limegreen magenta maroon navy olive orange orangered orchid pink plum purple red royalblue salmon seagreen silver skyblue slateblue slategray snow springgreen steelblue tan teal tomato turquoise violet wheat white whitesmoke yellow yellowgreen'.split(' '),
);

const stripComments = (text: string, kind: 'css' | 'code'): string => {
  const blocks = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return kind === 'code' ? blocks.replace(/(^|\s)\/\/.*$/gm, '$1') : blocks;
};

/** The colour literals in a stylesheet (`css`) or a source file (`code`): hex values, colour functions and, in CSS, colour names. */
export function colourLiteralsIn(text: string, kind: 'css' | 'code'): string[] {
  const source = stripComments(text, kind);
  const found = [...(source.match(HEX) ?? []), ...(source.match(COLOUR_FUNCTION) ?? [])];
  if (kind === 'css') {
    for (const declaration of source.matchAll(COLOUR_PROPERTY)) {
      for (const word of (declaration[1] ?? '').toLowerCase().split(/[^a-z-]+/)) if (NAMED_COLOURS.has(word)) found.push(word);
    }
  }
  return found;
}

export interface ColourReport {
  /** Files outside the allowlist that hold a literal, with the first few literals. */
  readonly violations: readonly string[];
  /** Allowlisted files that hold no literal any more; the allowlist must shrink. */
  readonly stale: readonly string[];
}

const isTest = (path: string): boolean => /\.test\.tsx?$/.test(path) || path.split(sep).includes('testing');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

/** Scans the renderer directory. Paths in the report and in `allowlist` are relative to `root`, with `/` separators. */
export function checkColourLiterals(root: string, rendererDir: string, allowlist: readonly string[]): ColourReport {
  const holders = new Map<string, string[]>();
  for (const path of walk(rendererDir)) {
    const kind = path.endsWith('.css') ? 'css' : /\.(?:tsx?|html)$/.test(path) ? 'code' : undefined;
    if (!kind || isTest(path)) continue;
    const literals = colourLiteralsIn(readFileSync(path, 'utf8'), kind);
    if (literals.length > 0) holders.set(relative(root, path).split(sep).join('/'), literals);
  }
  const allowed = new Set(allowlist);
  return {
    violations: [...holders].filter(([file]) => !allowed.has(file)).map(([file, literals]) => `${file}: ${[...new Set(literals)].slice(0, 4).join(' ')}`),
    stale: allowlist.filter((file) => !holders.has(file)),
  };
}
