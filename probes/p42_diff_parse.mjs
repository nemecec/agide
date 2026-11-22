// README: parsers for `git diff --binary --find-renames` output used by P42. naiveParse splits on "diff --git" lines and reads ---/+++ names; parseDiff follows the hunk header counts so file content cannot be mistaken for headers, and decodes quoted C-style paths. Import only.
const unquote = (s) => {
  if (!(s.startsWith('"') && s.endsWith('"'))) return s;
  const bytes = [];
  const body = s.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '\\') { bytes.push(...Buffer.from(c)); continue; }
    const n = body[++i];
    if (/[0-7]/.test(n)) { bytes.push(parseInt(body.slice(i, i + 3), 8)); i += 2; continue; }
    const map = { n: 10, t: 9, '"': 34, '\\': 92, a: 7, b: 8, f: 12, r: 13, v: 11 };
    bytes.push(map[n] ?? n.charCodeAt(0));
  }
  return Buffer.from(bytes).toString('utf8');
};

export function naiveParse(text) {
  return text.split(/^diff --git /m).slice(1).map((chunk) => {
    const head = chunk.split('\n')[0];
    const m = /^a\/(.*) b\/(.*)$/.exec(head);
    const hunks = (chunk.match(/^@@ /gm) || []).length;
    return { path: m ? m[2] : head, hunks };
  });
}

// Path of a header without rename lines: `diff --git a/P b/P`, either part quoted. Files without hunks (empty, binary, mode only) have no ---/+++ lines.
export function headerPath(header) {
  const rest = header.slice('diff --git '.length);
  if (rest.startsWith('"')) {
    const end = rest.slice(1).search(/(?<!\\)"/) + 2;
    return unquote(rest.slice(0, end)).replace(/^a\//, '');
  }
  const len = (rest.length - 5) / 2;
  return rest.slice(2, 2 + len);
}

// Returns files: { oldPath, newPath, status, mode, oldMode, binary, similarity, hunks: [{oldStart, oldLines, newStart, newLines, lines}] }.
export function parseDiff(text) {
  const lines = text.split('\n');
  const files = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith('diff --git ')) { i++; continue; }
    const f = { oldPath: null, newPath: null, status: 'M', mode: null, oldMode: null, binary: false, similarity: null, hunks: [], header: lines[i] };
    i++;
    for (; i < lines.length && !lines[i].startsWith('@@ ') && !lines[i].startsWith('diff --git '); i++) {
      const l = lines[i];
      let m;
      if ((m = /^old mode (\d+)/.exec(l))) f.oldMode = m[1];
      else if ((m = /^new mode (\d+)/.exec(l))) f.mode = m[1];
      else if ((m = /^new file mode (\d+)/.exec(l))) { f.status = 'A'; f.mode = m[1]; }
      else if ((m = /^deleted file mode (\d+)/.exec(l))) { f.status = 'D'; f.oldMode = m[1]; }
      else if ((m = /^similarity index (\d+)%/.exec(l))) f.similarity = Number(m[1]);
      else if ((m = /^rename from (.*)$/.exec(l))) { f.status = 'R'; f.oldPath = unquote(m[1]); }
      else if ((m = /^rename to (.*)$/.exec(l))) f.newPath = unquote(m[1]);
      else if ((m = /^copy from (.*)$/.exec(l))) { f.status = 'C'; f.oldPath = unquote(m[1]); }
      else if ((m = /^copy to (.*)$/.exec(l))) f.newPath = unquote(m[1]);
      else if ((m = /^--- (.*)$/.exec(l))) { const p = unquote(m[1].replace(/\t$/, '')); f.oldPath = p === '/dev/null' ? null : p.replace(/^a\//, ''); }
      else if ((m = /^\+\+\+ (.*)$/.exec(l))) { const p = unquote(m[1].replace(/\t$/, '')); f.newPath = p === '/dev/null' ? null : p.replace(/^b\//, ''); }
      else if (/^Binary files .* differ$/.test(l) || l === 'GIT binary patch') f.binary = true;
      else if (f.binary && /^(literal|delta) \d+$/.test(l)) { /* binary payload follows; skipped until the next header */ }
    }
    if (f.binary) { while (i < lines.length && !lines[i].startsWith('diff --git ')) i++; }
    while (i < lines.length && lines[i].startsWith('@@ ')) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[i]);
      if (!m) break;
      const h = { oldStart: +m[1], oldLines: m[2] === undefined ? 1 : +m[2], newStart: +m[3], newLines: m[4] === undefined ? 1 : +m[4], lines: [] };
      let o = h.oldLines, n = h.newLines;
      i++;
      while (i < lines.length && (o > 0 || n > 0 || lines[i].startsWith('\\'))) {
        const l = lines[i];
        if (l.startsWith('\\')) { h.lines.push(l); i++; continue; }
        const c = l[0];
        if (c === '+') n--; else if (c === '-') o--; else if (c === ' ' || l === '') { o--; n--; } else break;
        h.lines.push(l); i++;
      }
      f.hunks.push(h);
    }
    if (f.status === 'M' && f.hunks.length === 0 && !f.newPath) f.newPath = f.oldPath = headerPath(f.header);
    else if (f.status === 'A' && !f.newPath && !f.hunks.length) f.newPath = headerPath(f.header);
    else if (f.status === 'D' && !f.oldPath && !f.hunks.length) f.oldPath = headerPath(f.header);
    f.path = f.newPath ?? f.oldPath;
    files.push(f);
  }
  return files;
}

// Lines of the new file that appear in the diff as added or context lines, per path.
export function anchorLines(files) {
  const map = new Map();
  for (const f of files) {
    if (!f.newPath) continue;
    const set = new Set();
    for (const h of f.hunks) {
      let n = h.newStart;
      for (const l of h.lines) { if (l.startsWith('\\') || l.startsWith('-')) continue; set.add(n++); }
    }
    map.set(f.newPath, set);
  }
  return map;
}
