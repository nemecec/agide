// Contrast check for the token values proposed in docs/decisions/0035-visual-design-system.md.
// Standalone: no dependencies. Run with `node notes/scripts/token-contrast.mjs`.
// Prints Markdown tables and exits with status 1 when a pair misses its target.
// Ratios use the WCAG 2 relative luminance formula. All colours are opaque sRGB hex values.

const hex = (h) => {
  h = h.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const toHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (h) => { const [r, g, b] = hex(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mix = (a, b, t) => { const A = hex(a), B = hex(b); return toHex(A.map((v, i) => v + (B[i] - v) * t)); };
// Moves `base` toward `towards` in 2 percent sRGB steps until it reaches `target` against `against`.
const clampTo = (base, towards, against, target) => {
  for (let i = 0; i <= 50; i++) { const c = mix(base, towards, i * 0.02); if (ratio(c, against) >= target) return { colour: c, step: i * 2 }; }
  return { colour: null, step: 100 };
};
const f = (x) => x.toFixed(2);

const THEMES = {
  light: {
    window: '#ececef', sidebar: '#f3f3f5', content: '#ffffff', raised: '#ffffff', overlay: '#ffffff', inset: '#f5f5f7',
    primary: '#1d1d1f', secondary: '#55555c', tertiary: '#62626a', inverse: '#ffffff', tooltipBg: '#1d1d1f', link: '#0058c2',
    borderStrong: '#86868f',
    accent: '#0062cc', accentHover: '#0057b5', accentActive: '#004c9e', accentSubtle: '#e6effa', accentText: '#0058c2', onAccent: '#ffffff',
    successFg: '#1a7034', successBg: '#e8f3eb', warningFg: '#8a4f00', warningBg: '#fcf1de',
    dangerFg: '#c0251a', dangerBg: '#fceceb', infoFg: '#0058c2', infoBg: '#e6effa',
    dangerFill: '#c0251a', selection: '#dbe7f8', selectionInactive: '#e6e6ea', focus: '#0062cc',
  },
  dark: {
    window: '#202023', sidebar: '#252528', content: '#1b1b1e', raised: '#2a2a2e', overlay: '#303035', inset: '#151517',
    primary: '#ececf0', secondary: '#b8b8c0', tertiary: '#a2a2ac', inverse: '#1b1b1e', tooltipBg: '#ececf0', link: '#6eb0ff',
    borderStrong: '#7a7a84',
    accent: '#2f6fd0', accentHover: '#2967c4', accentActive: '#235aad', accentSubtle: '#1e2d45', accentText: '#6eb0ff', onAccent: '#ffffff',
    successFg: '#5cc878', successBg: '#1a2e21', warningFg: '#e6ab45', warningBg: '#352a15',
    dangerFg: '#ff7a70', dangerBg: '#3b1f1d', infoFg: '#6eb0ff', infoBg: '#1e2d45',
    dangerFill: '#c2332a', selection: '#24395a', selectionInactive: '#313136', focus: '#6eb0ff',
  },
};

const rows = [];
let failures = 0;
const check = (theme, fg, bg, target, use) => {
  const t = THEMES[theme];
  const r = ratio(t[fg], t[bg]);
  if (r < target) failures++;
  rows.push({ theme, fg, bg, target, use, r });
};
const SURFACES = ['window', 'sidebar', 'content', 'raised', 'overlay', 'inset', 'selection', 'selectionInactive'];
for (const th of Object.keys(THEMES)) {
  for (const s of SURFACES) for (const t of ['primary', 'secondary', 'tertiary']) check(th, t, s, 4.5, `${t} text`);
  for (const s of ['window', 'content', 'sidebar', 'raised', 'overlay']) check(th, 'link', s, 4.5, 'link');
  for (const a of ['accent', 'accentHover', 'accentActive', 'dangerFill']) check(th, 'onAccent', a, 4.5, 'text on fill');
  check(th, 'inverse', 'tooltipBg', 4.5, 'tooltip text');
  check(th, 'accentText', 'accentSubtle', 4.5, 'accent text on subtle');
  for (const t of ['primary', 'secondary', 'tertiary']) check(th, t, 'accentSubtle', 4.5, `${t} on accent subtle`);
  for (const k of ['success', 'warning', 'danger', 'info']) {
    check(th, `${k}Fg`, `${k}Bg`, 4.5, 'status chip');
    check(th, 'primary', `${k}Bg`, 4.5, 'banner and notice text');
    for (const s of ['window', 'content', 'sidebar', 'raised', 'overlay', 'selection', 'selectionInactive']) check(th, `${k}Fg`, s, 4.5, 'status text and icon');
  }
  for (const s of ['window', 'sidebar', 'content', 'raised', 'overlay', 'inset', 'selection', 'selectionInactive', 'accentSubtle']) check(th, 'focus', s, 3, 'focus ring');
  for (const s of ['window', 'sidebar', 'content', 'raised', 'overlay', 'inset']) check(th, 'borderStrong', s, 3, 'field border');
  for (const s of ['window', 'sidebar', 'content', 'raised', 'overlay', 'selection']) check(th, 'accentText', s, 3, 'accent indicator');
}

// Increased contrast overrides (applied over the base theme when the OS asks for more contrast).
const INCREASED = {
  light: { surfaces: ['window', 'sidebar', 'content', 'raised', 'overlay', 'inset', 'selection', 'selectionInactive'], primary: '#000000', secondary: '#3a3a40', tertiary: '#47474e', borderDefault: '#7a7a83', borderStrong: '#5e5e66', focus: '#004c9e' },
  dark: { surfaces: ['window', 'sidebar', 'content', 'raised', 'overlay', 'inset', 'selection', 'selectionInactive'], primary: '#ffffff', secondary: '#d4d4dc', tertiary: '#c6c6d0', borderDefault: '#82828c', borderStrong: '#a4a4ae', focus: '#9cc8ff' },
};
const increasedRows = [];
for (const [th, o] of Object.entries(INCREASED)) {
  for (const [k, target] of [['primary', 7], ['secondary', 7], ['tertiary', 4.5], ['borderDefault', 3], ['borderStrong', 4.5], ['focus', 4.5]]) {
    const min = Math.min(...o.surfaces.map((s) => ratio(o[k], THEMES[th][s])));
    if (min < target) failures++;
    increasedRows.push({ th, k, v: o[k], min, target });
  }
}

// Profile colours, from the palette in the profile module.
const PROFILE = ['#5b7fa6', '#b5651d', '#4f8a5b', '#a64f7e', '#7a5fb0', '#b0453a', '#2f8f9d', '#8a7a2f'];
const profileRows = PROFILE.map((p) => {
  const tile = clampTo(p, '#000000', '#ffffff', 4.5);
  const markLight = clampTo(p, '#000000', THEMES.light.window, 3);
  const markDark = clampTo(p, '#ffffff', THEMES.dark.window, 3);
  const tintLight = mix(THEMES.light.window, p, 0.12);
  const tintDark = mix(THEMES.dark.window, p, 0.16);
  return { p, tile, markLight, markDark,
    titleLight: Math.min(ratio(THEMES.light.primary, tintLight), ratio(THEMES.light.secondary, tintLight)),
    titleDark: Math.min(ratio(THEMES.dark.primary, tintDark), ratio(THEMES.dark.secondary, tintDark)) };
});
for (const r of profileRows) if (r.titleLight < 4.5 || r.titleDark < 4.5) failures++;

// Terminal palettes.
const TERMINAL = {
  light: { background: '#ffffff', foreground: '#1d1d1f', selectionBackground: '#dde9f9',
    black: '#1d1d1f', red: '#c0251a', green: '#1a7034', yellow: '#805000', blue: '#0058c2', magenta: '#8e3aa8', cyan: '#00687a', white: '#6c6c74',
    brightBlack: '#5b5b62', brightRed: '#a31d14', brightGreen: '#145c2a', brightYellow: '#6b4300', brightBlue: '#00479e', brightMagenta: '#75308b', brightCyan: '#005564', brightWhite: '#3a3a3f' },
  dark: { background: '#1b1b1e', foreground: '#e3e3e8', selectionBackground: '#233756',
    black: '#4a4a52', red: '#ff7a70', green: '#5cc878', yellow: '#e6ab45', blue: '#6eb0ff', magenta: '#d68cf0', cyan: '#4fc8d8', white: '#c8c8d0',
    brightBlack: '#8a8a94', brightRed: '#ff9c94', brightGreen: '#82dc98', brightYellow: '#f2c46e', brightBlue: '#9cc8ff', brightMagenta: '#e5b0f6', brightCyan: '#86dce6', brightWhite: '#ffffff' },
};
const ANSI = ['foreground', 'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'];

// System theme: accent derivation from sample macOS accent values (approximate sRGB values, for the method only).
const OS_ACCENTS = { blue: '#007aff', purple: '#953d96', pink: '#f74f9e', red: '#e0383e', orange: '#f7821b', yellow: '#ffc600', green: '#62ba46', graphite: '#8c8c8c' };
// Rule 5 of section 7.1: selection = mix(sidebar, accent, 18 % light, 30 % dark), lowered in 2 % steps until
// text.tertiary and the four status foregrounds keep 4.5 to 1 on it.
const STATUS_FG = ['successFg', 'warningFg', 'dangerFg', 'infoFg'];
const deriveSelection = (theme, c) => {
  const t = THEMES[theme];
  for (let pct = theme === 'light' ? 18 : 30; pct >= 0; pct -= 2) {
    const sel = mix(t.sidebar, c, pct / 100);
    if (['tertiary', ...STATUS_FG].every((k) => ratio(t[k], sel) >= 4.5)) return { colour: sel, pct };
  }
  return { colour: t.sidebar, pct: 0 };
};
// Rule 3: accent.text reaches 4.5 to 1 on the surfaces that carry text (sidebar, content, raised, overlay)
// and 3 to 1 on the surfaces where it is only a mark (window, the derived selection).
const deriveText = (theme, c, sel) => {
  const t = THEMES[theme];
  const towards = theme === 'light' ? '#000000' : '#ffffff';
  for (let i = 0; i <= 50; i++) {
    const x = mix(c, towards, i * 0.02);
    const text = ['sidebar', 'content', 'raised', 'overlay'].every((s) => ratio(x, t[s]) >= 4.5);
    const mark = [t.window, sel].every((s) => ratio(x, s) >= 3);
    if (text && mark) return { colour: x, step: i * 2, min: Math.min(...['sidebar', 'content', 'raised', 'overlay'].map((s) => ratio(x, t[s]))) };
  }
  return { colour: null, step: 100, min: 0 };
};
const systemRows = Object.entries(OS_ACCENTS).map(([name, c]) => {
  const selLight = deriveSelection('light', c), selDark = deriveSelection('dark', c);
  const textLight = deriveText('light', c, selLight.colour), textDark = deriveText('dark', c, selDark.colour);
  if (!textLight.colour || !textDark.colour) failures++;
  return { name, c, fill: clampTo(c, '#000000', '#ffffff', 4.5), textLight, textDark, selLight, selDark };
});

console.log('## Token pairs\n');
console.log('| Use | Foreground | Background | Target | Agide Light | Agide Dark |');
console.log('|---|---|---|---|---|---|');
const grouped = new Map();
for (const r of rows) { const k = [r.use, r.fg, r.bg, r.target].join('|'); if (!grouped.has(k)) grouped.set(k, {}); grouped.get(k)[r.theme] = r; }
const cell = (r) => (r ? `${f(r.r)}${r.r < r.target ? ' FAIL' : ''}` : '-');
for (const [k, v] of grouped) { const [use, fg, bg, target] = k.split('|'); console.log(`| ${use} | ${fg} | ${bg} | ${target} | ${cell(v.light)} | ${cell(v.dark)} |`); }

console.log('\n## Increased contrast overrides (lowest ratio over every surface and both selections)\n');
console.log('| Theme | Token | Value | Lowest | Target |');
console.log('|---|---|---|---|---|');
for (const r of increasedRows) console.log(`| ${r.th} | ${r.k} | \`${r.v}\` | ${f(r.min)}${r.min < r.target ? ' FAIL' : ''} | ${r.target} |`);

console.log('\n## Profile colours\n');
console.log('| Stored | Rail tile fill (white letter) | Mark on light window | Mark on dark window | Title bar text, light tint | Title bar text, dark tint |');
console.log('|---|---|---|---|---|---|');
for (const r of profileRows) {
  const m = (x, against, white) => `\`${x.colour}\` (${x.step} %) ${f(white ? ratio('#ffffff', x.colour) : ratio(x.colour, against))}`;
  console.log(`| \`${r.p}\` | ${m(r.tile, null, true)} | ${m(r.markLight, THEMES.light.window)} | ${m(r.markDark, THEMES.dark.window)} | ${f(r.titleLight)} | ${f(r.titleDark)} |`);
}

console.log('\n## Terminal (against background and selection)\n');
console.log('| Colour | Light value | On background | On selection | Dark value | On background | On selection |');
console.log('|---|---|---|---|---|---|---|');
for (const k of ANSI) {
  const L = TERMINAL.light, D = TERMINAL.dark;
  console.log(`| ${k} | \`${L[k]}\` | ${f(ratio(L[k], L.background))} | ${f(ratio(L[k], L.selectionBackground))} | \`${D[k]}\` | ${f(ratio(D[k], D.background))} | ${f(ratio(D[k], D.selectionBackground))} |`);
}

console.log('\n## System theme accent derivation\n');
console.log('| OS accent | Value | Fill for white text | Text form, light | Text form, dark | Selection, light | Selection, dark |');
console.log('|---|---|---|---|---|---|---|');
for (const s of systemRows) {
  console.log(`| ${s.name} | \`${s.c}\` | \`${s.fill.colour}\` (${s.fill.step} %) ${f(ratio('#ffffff', s.fill.colour))} | \`${s.textLight.colour}\` (${s.textLight.step} %) ${f(s.textLight.min)} | \`${s.textDark.colour}\` (${s.textDark.step} %) ${f(s.textDark.min)} | \`${s.selLight.colour}\` (${s.selLight.pct} %) | \`${s.selDark.colour}\` (${s.selDark.pct} %) |`);
}

console.log(`\nPairs below target: ${failures}`);
process.exitCode = failures > 0 ? 1 : 0;
