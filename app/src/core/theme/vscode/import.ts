import { createHash } from 'node:crypto';
import { builtinTheme } from '../builtin/index';
import { contrastIssues, THEME_SCHEMA_VERSION, validateThemeDocument, type ThemeDocument, type ThemeIssue } from '../schema';
import type { Adjustment } from './clamp';
import { licenseFromFile, type LicenseInfo } from './license';
import { parseJsonc } from './jsonc';
import { mapVsCodeTheme } from './mapping';
import { readVsix } from './vsix';
import { ZipError } from './zip';

export const MAX_IMPORT_BYTES = 16 * 1024 * 1024;

export interface ImportRequest {
  readonly bytes: Buffer;
  /** Used to tell a package from a bare theme file by its extension when the content is ambiguous, and as a label. */
  readonly fileName: string;
  /** The theme to take from a package that holds several. */
  readonly themeLabel?: string | undefined;
  /** Required for a bare theme file; a package's own license file is used when this is absent. */
  readonly license?: LicenseInfo | undefined;
  /** Keep the colours of the theme file as they are; the theme then carries contrast warnings. */
  readonly keepOriginalContrast?: boolean | undefined;
  readonly existingIds: ReadonlySet<string>;
  readonly now: Date;
  /** Agide version, recorded in `source.importer`. */
  readonly importer: string;
  /** Overrides for the ported built-in themes. */
  readonly id?: string | undefined;
  readonly name?: string | undefined;
  readonly url?: string | undefined;
  readonly sourceKind?: 'vscode-file' | 'open-vsx' | 'builtin' | undefined;
}

export type ImportOutcome =
  | {
      readonly ok: true;
      readonly theme: ThemeDocument;
      readonly adjustments: readonly Adjustment[];
      readonly warnings: readonly ThemeIssue[];
    }
  | {
      readonly ok: false;
      readonly issues: readonly ThemeIssue[];
      /** The theme labels of a package that holds several, when none was chosen. */
      readonly choices?: readonly string[];
    };

const failure = (code: ThemeIssue['code'], path: string, message: string, hint: string): ImportOutcome => ({
  ok: false,
  issues: [{ code, severity: 'error', path, message, hint }],
});

const isZip = (bytes: Buffer): boolean => bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50;

export function slugify(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replaceAll(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 40)
    .replaceAll(/-+$/g, '');
  return slug.length >= 3 ? slug : slug === '' ? 'imported-theme' : `theme-${slug}`;
}

/** A free id: the slug, then the slug with `-2`, `-3` and so on. */
export function freeId(slug: string, taken: ReadonlySet<string>): string {
  if (!taken.has(slug)) return slug;
  for (let n = 2; ; n++) {
    const candidate = `${slug.slice(0, 44)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

interface Picked {
  readonly text: string;
  readonly label: string;
  readonly uiTheme?: Parameters<typeof mapVsCodeTheme>[0]['uiTheme'];
  readonly extension?: string | undefined;
  readonly version?: string | undefined;
  readonly license?: LicenseInfo | undefined;
}

/** Opens a package or takes a bare file. */
function pick(request: ImportRequest): Picked | ImportOutcome {
  if (!isZip(request.bytes)) {
    return { text: request.bytes.toString('utf8'), label: request.fileName.replace(/\.[^.]*$/, '') };
  }
  let pkg;
  try {
    pkg = readVsix(request.bytes);
  } catch (error) {
    if (error instanceof ZipError) return failure('invalid_json', '', `The package cannot be read: ${error.message}.`, 'Use a .vsix of a VS Code colour theme.');
    throw error;
  }
  if (pkg.themes.length === 0) return failure('missing_field', '/contributes/themes', 'The package contributes no colour theme.', 'Use an extension that lists `contributes.themes`.');
  const chosen = request.themeLabel === undefined ? (pkg.themes.length === 1 ? pkg.themes[0] : undefined) : pkg.themes.find((theme) => theme.label === request.themeLabel);
  if (!chosen) {
    const labels = pkg.themes.map((theme) => theme.label);
    return {
      ok: false,
      choices: labels,
      issues: [
        {
          code: 'invalid_value',
          severity: 'error',
          path: '/themeLabel',
          message: request.themeLabel === undefined ? 'The package holds several themes.' : `The package has no theme labelled \`${request.themeLabel}\`.`,
          hint: `Choose one of ${labels.map((label) => `\`${label}\``).join(', ')}.`,
        },
      ],
    };
  }
  return {
    text: chosen.text,
    label: chosen.label,
    uiTheme: chosen.uiTheme,
    extension: pkg.extension,
    version: pkg.version,
    license: pkg.license ? licenseFromFile(pkg.license.text, pkg.manifestLicense) : undefined,
  };
}

/** Reads a VS Code theme file or package and builds the Agide theme document, without writing anything. */
export function importVsCodeTheme(request: ImportRequest): ImportOutcome {
  if (request.bytes.length > MAX_IMPORT_BYTES) return failure('invalid_value', '', 'The file is larger than the importer reads.', 'Use a theme file or package under 16 MiB.');
  const picked = pick(request);
  if ('ok' in picked) return picked;

  let file: unknown;
  try {
    file = parseJsonc(picked.text);
  } catch (error) {
    return failure('invalid_json', '', 'The theme file is not valid JSON.', error instanceof Error ? error.message : String(error));
  }
  const mapped = mapVsCodeTheme({ file, uiTheme: picked.uiTheme });
  if (!mapped.ok) return { ok: false, issues: mapped.issues };
  const { theme: result } = mapped;

  const license = request.license ?? picked.license;
  if (!license) return failure('license_missing', '/license', '`/license` is required for an imported theme.', 'Give the license of the theme, or `LicenseRef-unknown` for personal use.');

  const label = request.name ?? picked.label;
  const sourceKind = request.sourceKind ?? 'vscode-file';
  const keep = request.keepOriginalContrast === true;
  const base = builtinTheme(`agide-${result.kind}`);
  const raw = typeof file === 'object' && file !== null && typeof (file as { name?: unknown }).name === 'string' ? (file as { name: string }).name : undefined;
  const document: ThemeDocument = {
    schema: THEME_SCHEMA_VERSION,
    id: request.id ?? freeId(slugify(label), request.existingIds),
    name: label.slice(0, 64),
    kind: result.kind,
    extends: `agide-${result.kind}`,
    tokens: keep ? result.original : result.tokens,
    ...(result.highContrast && base?.increasedContrast ? { increasedContrast: { ...base.increasedContrast } } : {}),
    license,
    source: {
      kind: sourceKind,
      name: raw ?? picked.label,
      ...(picked.extension === undefined ? {} : { extension: picked.extension }),
      ...(picked.version === undefined ? {} : { version: picked.version }),
      ...(request.url === undefined ? {} : { url: request.url }),
      sha256: createHash('sha256').update(request.bytes).digest('hex'),
      importedAt: request.now.toISOString(),
      importer: request.importer,
      ...(keep || result.adjustments.length === 0 ? {} : { adjustments: result.adjustments.map((adjustment) => ({ ...adjustment })) }),
    },
    ...(Object.keys(result.vscode).length === 0 ? {} : { vscode: result.vscode }),
  };
  const checked = validateThemeDocument(document, { existingIds: request.existingIds });
  if (!checked.ok || !checked.theme) return { ok: false, issues: checked.issues };
  return { ok: true, theme: checked.theme, adjustments: keep ? [] : result.adjustments, warnings: keep ? contrastOf(result.original, result.kind) : result.warnings };
}

function contrastOf(original: Record<string, string>, kind: 'light' | 'dark'): ThemeIssue[] {
  const base = builtinTheme(`agide-${kind}`)?.tokens ?? {};
  return contrastIssues({ ...base, ...original }, kind === 'dark');
}
