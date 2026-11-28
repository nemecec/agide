// P59: static census of the chrome.* members that an unpacked extension's scripts reference, grouped by entry
// (background service worker, popup, content scripts, offscreen document, other). Plain Node, no Electron, no network.
// Usage: node probes/p59_ext_static_apis.mjs <extension dir> <out json>
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const [dir, out] = process.argv.slice(2);
if (!dir || !out) throw new Error('usage: p59_ext_static_apis.mjs <extension dir> <out json>');

function walk(d) {
  return readdirSync(d).flatMap((name) => {
    const p = join(d, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const groupOf = (rel) => (rel.startsWith('popup/') ? 'popup' : rel.startsWith('content/') ? 'content' : rel.startsWith('offscreen-document/') ? 'offscreen' : /^(\d+\.)?background\.js$/.test(rel) || /^\d+\.background\.js$/.test(rel) ? 'background' : rel.startsWith('notification/') || rel.startsWith('overlay/') ? 'page' : 'other');
const pattern = /\b(?:chrome|browser)\.([a-zA-Z]+)\.([a-zA-Z_]+)/g;
const census = {};
for (const file of walk(dir)) {
  const rel = relative(dir, file);
  if (!rel.endsWith('.js') || rel.endsWith('.map')) continue;
  const text = readFileSync(file, 'utf8');
  const group = groupOf(rel);
  for (const m of text.matchAll(pattern)) {
    const ns = m[1];
    const member = m[2];
    const entry = ((census[ns] ??= {})[member] ??= {});
    entry[group] = (entry[group] ?? 0) + 1;
  }
}
const namespaces = Object.fromEntries(Object.entries(census).sort().map(([ns, members]) => [ns, Object.fromEntries(Object.entries(members).sort().map(([member, groups]) => [member, Object.keys(groups).sort()]))]));
writeFileSync(out, JSON.stringify(namespaces, null, 2));
console.log(Object.entries(namespaces).map(([ns, members]) => `${ns}: ${Object.keys(members).join(', ')}`).join('\n'));
