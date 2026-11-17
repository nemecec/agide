/**
 * Version ranges of layout instances: `*`, an exact `1.2.3`, or a caret range `^1`, `^1.2`, `^1.2.3`
 * (same major, at least the given minor and patch). Prerelease tags are ignored. Anything else is invalid.
 */
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;
const CARET = /^\^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;

export function isValidRange(range: string): boolean {
  return range === '*' || VERSION.test(range) || CARET.test(range);
}

export function satisfiesRange(version: string, range: string): boolean {
  const v = VERSION.exec(version);
  if (!v) return false;
  const [major, minor, patch] = [Number(v[1]), Number(v[2]), Number(v[3])];
  if (range === '*') return true;
  const exact = VERSION.exec(range);
  if (exact) return major === Number(exact[1]) && minor === Number(exact[2]) && patch === Number(exact[3]);
  const caret = CARET.exec(range);
  if (!caret) return false;
  if (major !== Number(caret[1])) return false;
  const wantMinor = Number(caret[2] ?? 0);
  if (minor !== wantMinor) return minor > wantMinor;
  return patch >= Number(caret[3] ?? 0);
}
