import { z } from 'zod';
import { contrastWarnings } from './contrast';
import { DOCKVIEW_VARIABLES } from './dockVariables';
import { closestTokens, isComputedToken, isValidValue, REQUIRED_TOKEN_KEYS, TYPE_DESCRIPTION, tokenDefinition } from './tokens';

export const THEME_SCHEMA_VERSION = 1;

export const THEME_ERROR_CODES = [
  'invalid_json',
  'schema_version_unsupported',
  'missing_field',
  'unknown_token',
  'computed_token',
  'invalid_value',
  'missing_token',
  'unknown_dock_variable',
  'id_conflict',
  'license_missing',
  'include_unsupported',
  'contrast_below_target',
] as const;
export type ThemeErrorCode = (typeof THEME_ERROR_CODES)[number];

export interface ThemeIssue {
  readonly code: ThemeErrorCode;
  readonly severity: 'error' | 'warning';
  /** JSON pointer into the document. */
  readonly path: string;
  readonly message: string;
  readonly hint: string;
}

/** The xterm `ITheme` fields a theme's `terminal` block may set. */
export const TERMINAL_FIELDS = [
  'background',
  'foreground',
  'cursor',
  'cursorAccent',
  'selectionBackground',
  'selectionForeground',
  'selectionInactiveBackground',
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const;

const stringMap = z.record(z.string(), z.string());
const THEME_ID = /^[a-z0-9-]{3,48}$/;

const variantShape = {
  extends: z.string().optional(),
  tokens: stringMap.optional(),
  increasedContrast: stringMap.optional(),
  dock: stringMap.optional(),
  terminal: stringMap.optional(),
};

const licenseSchema = z.object({ spdx: z.string().min(1), copyright: z.string().min(1), text: z.string().min(1) }).strict();

const sourceSchema = z
  .object({
    kind: z.enum(['builtin', 'user', 'vscode-file', 'open-vsx']),
    name: z.string().optional(),
    extension: z.string().optional(),
    version: z.string().optional(),
    url: z.string().optional(),
    sha256: z.string().optional(),
    importedAt: z.string().optional(),
    importer: z.string().optional(),
    adjustments: z.array(z.object({ token: z.string(), from: z.string(), to: z.string(), reason: z.string() }).strict()).optional(),
  })
  .strict();

const VSCODE_COLOUR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export const themeVariantSchema = z.object(variantShape).strict();

export const themeDocumentSchema = z
  .object({
    schema: z.number().int(),
    id: z.string().regex(THEME_ID, 'must be 3 to 48 characters of a-z, 0-9 and -'),
    name: z.string().min(1).max(64),
    kind: z.enum(['light', 'dark', 'system']),
    ...variantShape,
    light: themeVariantSchema.optional(),
    dark: themeVariantSchema.optional(),
    license: licenseSchema.optional(),
    source: sourceSchema.optional(),
    /** The original colours of an imported VS Code theme, by VS Code key; the `--vscode-*` aliases read them. */
    vscode: z.record(z.string().max(80), z.string().regex(VSCODE_COLOUR, 'must be a VS Code colour')).optional(),
  })
  .strict();

export type ThemeVariant = z.infer<typeof themeVariantSchema>;
export type ThemeDocument = z.infer<typeof themeDocumentSchema>;
export type ThemeKind = ThemeDocument['kind'];

/** The JSON Schema that `theme_get` returns. */
export const themeJsonSchema = (): unknown => z.toJSONSchema(themeDocumentSchema);

export interface ValidationResult {
  readonly ok: boolean;
  readonly theme: ThemeDocument | undefined;
  readonly issues: readonly ThemeIssue[];
}

export interface ValidationContext {
  /** Ids of built-in and user themes that exist already. */
  readonly existingIds?: ReadonlySet<string>;
  /** Ids a theme may extend, with the kind each has. */
  readonly extendable?: Readonly<Record<string, 'light' | 'dark'>>;
}

const DEFAULT_EXTENDABLE: Record<string, 'light' | 'dark'> = { 'agide-light': 'light', 'agide-dark': 'dark' };

const pointer = (...parts: (string | number)[]): string => parts.map((part) => `/${String(part).replaceAll('~', '~0').replaceAll('/', '~1')}`).join('');
const issue = (code: ThemeErrorCode, path: string, message: string, hint: string, severity: 'error' | 'warning' = 'error'): ThemeIssue => ({ code, severity, path, message, hint });

/** The error of a VS Code theme that uses `include`, which the importer (step 5) raises. */
export const includeUnsupported = (path = '/include'): ThemeIssue =>
  issue('include_unsupported', path, 'The VS Code theme uses `include`, which the importer does not read.', 'Import the included file, or a theme without `include`.');

/** The offset of the bad token, from the engine's message: either a position or the source text that ends at the token. */
function errorOffset(reason: string, text: string): number | undefined {
  const position = /position (\d+)/.exec(reason);
  if (position) return Number(position[1]);
  if (/^Unexpected end of JSON input/.test(reason)) return text.length;
  const snippet = /^Unexpected token .*?, (?:\.\.\.)?"([\s\S]*)" is not valid JSON$/.exec(reason)?.[1];
  const at = snippet === undefined ? -1 : text.indexOf(snippet);
  return snippet !== undefined && at >= 0 ? at + snippet.length - 1 : undefined;
}

function parseJson(text: string): { value: unknown } | { issue: ThemeIssue } {
  try {
    return { value: JSON.parse(text) as unknown };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const lineColumn = /line (\d+) column (\d+)/.exec(reason);
    const offset = errorOffset(reason, text);
    let where = '';
    if (lineColumn) where = ` at line ${lineColumn[1]}, column ${lineColumn[2]}`;
    else if (offset !== undefined) {
      const lines = text.slice(0, offset).split('\n');
      where = ` at line ${lines.length}, column ${(lines.at(-1) ?? '').length + 1}`;
    }
    return { issue: issue('invalid_json', '', `The file is not valid JSON${where}.`, reason) };
  }
}

function zodIssues(error: z.ZodError): ThemeIssue[] {
  return error.issues.map((found): ThemeIssue => {
    const path = pointer(...(found.path as (string | number)[]));
    const shown = path === '' ? '/' : path;
    if (found.code === 'invalid_type' && found.input === undefined) return issue('missing_field', path, `\`${shown}\` is required.`, `Add \`${shown}\`.`);
    if (found.code === 'unrecognized_keys') return issue('invalid_value', path, `\`${found.keys.join('`, `')}\` is not a field of a theme at \`${shown}\`.`, 'Remove the field; the fields are schema, id, name, kind, extends, tokens, increasedContrast, dock, terminal, light, dark, license, source and vscode.');
    return issue('invalid_value', path, `\`${shown}\` is not valid: ${found.message}.`, 'Change the value to match the schema.');
  });
}

function checkTokenMap(map: Readonly<Record<string, string>>, base: string): ThemeIssue[] {
  return Object.entries(map).flatMap(([key, value]): ThemeIssue[] => {
    const path = `${base}${pointer(key)}`;
    if (isComputedToken(key)) return [issue('computed_token', path, `\`${path}\` is computed from \`text.primary\` and cannot be set.`, 'Remove it; change `text.primary` to change it.')];
    const definition = tokenDefinition(key);
    if (!definition) {
      const near = closestTokens(key);
      return [issue('unknown_token', path, `\`${path}\` is not a token.`, `The closest token names are ${near.map((name) => `\`${name}\``).join(', ')}.`)];
    }
    if (!isValidValue(definition.type, value)) {
      return [issue('invalid_value', path, `\`${path}\` must be ${TYPE_DESCRIPTION[definition.type]}; got \`${value}\`.`, `Use ${TYPE_DESCRIPTION[definition.type]}.`)];
    }
    return [];
  });
}

function checkVariant(variant: ThemeVariant, base: string, kind: 'light' | 'dark' | undefined, extendable: Record<string, 'light' | 'dark'>): ThemeIssue[] {
  const issues: ThemeIssue[] = [];
  const tokens = variant.tokens ?? {};
  issues.push(...checkTokenMap(tokens, `${base}/tokens`));
  if (variant.increasedContrast) issues.push(...checkTokenMap(variant.increasedContrast, `${base}/increasedContrast`));
  for (const [name, value] of Object.entries(variant.dock ?? {})) {
    const path = `${base}/dock${pointer(name)}`;
    if (!DOCKVIEW_VARIABLES.includes(name)) issues.push(issue('unknown_dock_variable', path, `\`${path}\` is not a dockview 8.9 variable.`, 'Use a variable named in the dockview 8.9.0 stylesheet.'));
    else if (!/^[^;{}<>]{1,200}$/.test(value)) issues.push(issue('invalid_value', path, `\`${path}\` must be a plain CSS value.`, 'Remove the characters ; { } < >.'));
  }
  for (const [name, value] of Object.entries(variant.terminal ?? {})) {
    const path = `${base}/terminal${pointer(name)}`;
    if (!(TERMINAL_FIELDS as readonly string[]).includes(name)) issues.push(issue('invalid_value', path, `\`${path}\` is not an xterm theme field.`, `The fields are ${TERMINAL_FIELDS.join(', ')}.`));
    else if (!isValidValue('colour', value)) issues.push(issue('invalid_value', path, `\`${path}\` must be a hex colour; got \`${value}\`.`, 'Use #rgb or #rrggbb.'));
  }
  if (variant.extends !== undefined) {
    const baseKind = extendable[variant.extends];
    if (baseKind === undefined || (kind !== undefined && baseKind !== kind)) {
      const options = Object.entries(extendable).filter(([, k]) => kind === undefined || k === kind).map(([id]) => `\`${id}\``);
      issues.push(issue('invalid_value', `${base}/extends`, `\`${base}/extends\` must name a built-in theme of the same kind; got \`${variant.extends}\`.`, `Use ${options.join(' or ')}.`));
    }
  } else {
    for (const key of REQUIRED_TOKEN_KEYS) {
      if (!(key in tokens)) issues.push(issue('missing_token', `${base}/tokens${pointer(key)}`, `\`${base}/tokens${pointer(key)}\` is required when \`extends\` is absent.`, 'Add the token, or set `extends` to a built-in theme.'));
    }
  }
  return issues;
}

/** Checks a parsed document. Reports every problem, so a file can be fixed in one pass. */
export function validateThemeDocument(input: unknown, context: ValidationContext = {}): ValidationResult {
  const extendable = context.extendable ?? DEFAULT_EXTENDABLE;
  const version = typeof input === 'object' && input !== null ? (input as { schema?: unknown }).schema : undefined;
  if (typeof version === 'number' && version > THEME_SCHEMA_VERSION) {
    return { ok: false, theme: undefined, issues: [issue('schema_version_unsupported', '/schema', `Theme schema ${version} is newer than this app reads (${THEME_SCHEMA_VERSION}).`, `Update Agide or use schema ${THEME_SCHEMA_VERSION}.`)] };
  }
  if (typeof input === 'object' && input !== null && 'include' in input) return { ok: false, theme: undefined, issues: [includeUnsupported()] };

  const parsed = themeDocumentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, theme: undefined, issues: zodIssues(parsed.error) };
  const theme = parsed.data;
  const issues: ThemeIssue[] = [];
  if (theme.schema !== THEME_SCHEMA_VERSION) issues.push(issue('invalid_value', '/schema', `\`/schema\` must be ${THEME_SCHEMA_VERSION}; got ${theme.schema}.`, `Use schema ${THEME_SCHEMA_VERSION}.`));
  if (context.existingIds?.has(theme.id)) {
    issues.push(issue('id_conflict', '/id', `A theme with id \`${theme.id}\` exists.`, 'Choose another id, or `theme_apply` the existing one.'));
  }

  if (theme.kind === 'system') {
    for (const side of ['light', 'dark'] as const) {
      const variant = theme[side];
      if (!variant) issues.push(issue('missing_field', `/${side}`, `\`/${side}\` is required for a system theme.`, `Add \`/${side}\` with its own tokens.`));
      else issues.push(...checkVariant(variant, `/${side}`, side, extendable));
    }
    if (theme.tokens !== undefined || theme.extends !== undefined) issues.push(issue('invalid_value', '/tokens', 'A system theme keeps its tokens in `/light` and `/dark`.', 'Move `tokens` and `extends` into `/light` and `/dark`.'));
  } else {
    issues.push(...checkVariant(theme, '', theme.kind, extendable));
    if (theme.light !== undefined || theme.dark !== undefined) issues.push(issue('invalid_value', '/light', '`/light` and `/dark` belong to a system theme.', 'Remove them, or set `kind` to `system`.'));
  }

  const imported = theme.source !== undefined && (theme.source.kind === 'vscode-file' || theme.source.kind === 'open-vsx' || (theme.source.kind === 'user' && theme.source.url !== undefined));
  if (imported && theme.license === undefined) issues.push(issue('license_missing', '/license', '`/license` is required for an imported theme.', 'Add `spdx`, `copyright` and `text`; `LicenseRef-unknown` is allowed for personal use.'));
  return { ok: !issues.some((found) => found.severity === 'error'), theme, issues };
}

/** Parses and checks a theme file. */
export function validateThemeText(text: string, context: ValidationContext = {}): ValidationResult {
  const parsed = parseJson(text);
  if ('issue' in parsed) return { ok: false, theme: undefined, issues: [parsed.issue] };
  return validateThemeDocument(parsed.value, context);
}

/** Warnings for the pairs of table 1.8 that a resolved token set misses. Built-in themes treat these as errors in tests. */
export function contrastIssues(tokens: Readonly<Record<string, string>>, dark: boolean): ThemeIssue[] {
  return contrastWarnings(tokens, dark).map((warning) =>
    issue(
      'contrast_below_target',
      pointer('tokens', warning.foreground),
      `\`${warning.foreground}\` on \`${warning.background}\` is ${warning.ratio.toFixed(2)} to 1; target ${warning.target}.`,
      warning.adjusted ? `The clamp would use \`${warning.adjusted}\`.` : 'No lighter or darker value reaches the target.',
      'warning',
    ),
  );
}
