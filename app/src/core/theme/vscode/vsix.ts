import { parseJsonc } from './jsonc';
import { ZipError, ZipReader } from './zip';

export type UiTheme = 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';

export interface VsixTheme {
  readonly label: string;
  readonly uiTheme: UiTheme | undefined;
  /** The text of the theme file. */
  readonly text: string;
}

export interface VsixPackage {
  /** `publisher.name`, when the manifest has both. */
  readonly extension: string | undefined;
  readonly version: string | undefined;
  /** The SPDX id the manifest states, if any. */
  readonly manifestLicense: string | undefined;
  readonly themes: readonly VsixTheme[];
  readonly license: { readonly file: string; readonly text: string } | undefined;
}

const LICENSE_NAMES = ['license', 'license.txt', 'license.md', 'licence', 'licence.txt', 'licence.md', 'copying', 'copying.txt'];
const MAX_THEMES = 40;
const MAX_LICENSE_BYTES = 64 * 1024;

const isUiTheme = (value: unknown): value is UiTheme => value === 'vs' || value === 'vs-dark' || value === 'hc-black' || value === 'hc-light';

/** A path inside `extension/`, or undefined for anything that leaves it. */
function insideExtension(path: string): string | undefined {
  const parts: string[] = [];
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') return undefined;
    parts.push(part);
  }
  return parts.length === 0 ? undefined : `extension/${parts.join('/')}`;
}

/**
 * Reads the parts of an extension package that describe a colour theme: `extension/package.json`, the theme files its
 * `contributes.themes` names, and the license file. No other entry is opened, and no code in the package runs.
 */
export function readVsix(bytes: Buffer): VsixPackage {
  const zip = new ZipReader(bytes);
  if (!zip.has('extension/package.json')) throw new ZipError('the package has no extension/package.json');
  let manifest: Record<string, unknown>;
  try {
    manifest = parseJsonc(zip.read('extension/package.json').toString('utf8')) as Record<string, unknown>;
  } catch (error) {
    throw error instanceof ZipError ? error : new ZipError('extension/package.json is not valid JSON');
  }
  const contributes = (manifest['contributes'] ?? {}) as Record<string, unknown>;
  const declared = Array.isArray(contributes['themes']) ? (contributes['themes'] as unknown[]).slice(0, MAX_THEMES) : [];
  const themes: VsixTheme[] = [];
  for (const item of declared) {
    const record = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    const path = typeof record['path'] === 'string' ? insideExtension(record['path']) : undefined;
    if (path === undefined || !zip.has(path) || !/\.jsonc?$/i.test(path)) continue;
    const label = typeof record['label'] === 'string' && record['label'] !== '' ? record['label'] : (path.split('/').at(-1) ?? path);
    themes.push({ label, uiTheme: isUiTheme(record['uiTheme']) ? record['uiTheme'] : undefined, text: zip.read(path).toString('utf8') });
  }
  const licenseEntry = zip.names().find((name) => {
    const parts = name.split('/');
    return parts.length === 2 && parts[0] === 'extension' && LICENSE_NAMES.includes((parts[1] ?? '').toLowerCase());
  });
  let license: VsixPackage['license'];
  if (licenseEntry !== undefined) {
    const data = zip.read(licenseEntry);
    if (data.length <= MAX_LICENSE_BYTES) license = { file: licenseEntry.slice('extension/'.length), text: data.toString('utf8') };
  }
  const publisher = typeof manifest['publisher'] === 'string' ? manifest['publisher'] : undefined;
  const name = typeof manifest['name'] === 'string' ? manifest['name'] : undefined;
  return {
    extension: publisher && name ? `${publisher}.${name}` : undefined,
    version: typeof manifest['version'] === 'string' ? manifest['version'] : undefined,
    manifestLicense: typeof manifest['license'] === 'string' ? manifest['license'] : undefined,
    themes,
    license,
  };
}
