import { lstatSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { z } from 'zod';
import type { CommandRegistry } from '../commands/CommandRegistry';
import { CommandError, type Caller } from '../commands/types';
import { ThemeError, type ThemeService } from './service';
import { MAX_IMPORT_BYTES } from './vscode/import';

const documentSchema = z.record(z.string(), z.unknown());
const licenseSchema = z.strictObject({
  spdx: z.string().min(1).max(64).describe('An SPDX id, or LicenseRef-unknown when the license is not known (personal use)'),
  copyright: z.string().min(1).max(200),
  text: z.string().min(1).max(65_536).describe('The full license text, kept with the theme'),
});
const IMPORT_EXTENSIONS = new Set(['.json', '.jsonc', '.vsix']);

/** Maps theme errors to command errors an agent can act on. */
function guarded<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (!(error instanceof ThemeError)) throw error;
    throw new CommandError(error.code === 'not_found' ? 'not_found' : 'invalid_input', error.message, error.details);
  }
}

const source = (caller: Caller): 'ui' | 'mcp' => caller.kind;

function readImportFile(path: string): Buffer {
  if (!IMPORT_EXTENSIONS.has(extname(path).toLowerCase())) throw new CommandError('invalid_input', 'the file must be a .json or .jsonc theme file or a .vsix package');
  let info;
  try {
    info = lstatSync(path);
  } catch {
    throw new CommandError('not_found', `no file at ${path}`);
  }
  if (!info.isFile()) throw new CommandError('invalid_input', 'the path is not a regular file');
  if (info.size > MAX_IMPORT_BYTES) throw new CommandError('invalid_input', 'the file is larger than the importer reads (16 MiB)');
  return readFileSync(path);
}

export function registerThemeCommands(registry: CommandRegistry, service: ThemeService): (() => void)[] {
  const oneOf = (input: Record<string, unknown>, names: readonly string[]): void => {
    if (names.filter((name) => input[name] !== undefined).length !== 1) throw new CommandError('invalid_input', `give exactly one of ${names.join(', ')}`);
  };

  return [
    registry.register({
      id: 'theme_list',
      title: 'List themes',
      description: 'List the themes of this profile, built-in and imported: id, name, kind, source kind, license, a one-line detail of license and source, whether it is the active theme and whether it has low contrast. Also returns the revision of the theme choice.',
      input: z.strictObject({}),
      ui: false,
      mcp: true,
      run: () => ({ themes: service.list(), revision: service.state().revision, problems: service.userThemeProblems() }),
    }),
    registry.register({
      id: 'theme_get',
      title: 'Get theme',
      description: 'Return a theme document (the active one without an id), its resolved token values for the current appearance, the colour pairs under their contrast target, the revision of the theme choice and the JSON Schema of a theme file.',
      input: z.strictObject({ id: z.string().min(1).optional() }),
      ui: false,
      mcp: true,
      run: (input) => guarded(() => service.get(input.id)),
    }),
    registry.register({
      id: 'theme_validate',
      title: 'Validate theme',
      description: 'Check a theme document without saving or showing it. Returns ok, errors and warnings (code, JSON Pointer path, message, hint) and the values the contrast clamp would use.',
      input: z.strictObject({ document: documentSchema }),
      ui: false,
      mcp: true,
      run: (input) => service.validate(input.document),
    }),
    registry.register({
      id: 'theme_preview',
      title: 'Preview theme',
      description: 'Show a saved theme (id) or a theme document in the window without saving it. The window shows a notice with Keep and Revert; the preview ends on Revert, on Escape in the notice, when the window closes, or after 60 seconds without Keep. Returns a previewId for theme_apply. Without windowId every window of this profile shows it.',
      input: z.strictObject({ id: z.string().min(1).optional(), document: documentSchema.optional(), windowId: z.number().int().optional() }),
      ui: false,
      mcp: true,
      run: (input) => {
        oneOf(input, ['id', 'document']);
        return guarded(() => service.startPreview(input.id === undefined ? { document: input.document } : { id: input.id }, input.windowId));
      },
    }),
    registry.register({
      id: 'theme_revert_preview',
      title: 'Revert theme preview',
      description: 'End the preview and show the saved theme again. Without previewId it ends the current preview. Returns whether a preview was ended.',
      input: z.strictObject({ previewId: z.string().min(1).optional() }),
      ui: false,
      mcp: true,
      run: (input) => ({ reverted: service.endPreview(input.previewId) }),
    }),
    registry.register({
      id: 'theme_apply',
      title: 'Apply theme',
      description: 'Save the theme choice of this profile as a new revision: a saved theme (id) or the theme of a preview (previewId). expectedRevision must be the revision from theme_get or theme_list; a stale revision is refused with the current one. Returns the new revision and the theme_undo arguments that restore the previous choice. The window shows a notice with Undo.',
      input: z.strictObject({ id: z.string().min(1).optional(), previewId: z.string().min(1).optional(), expectedRevision: z.number().int().min(1) }),
      ui: false,
      mcp: true,
      run: (input, { caller }) => {
        oneOf(input, ['id', 'previewId']);
        return guarded(() => service.apply(input.id === undefined ? { previewId: input.previewId ?? '' } : { id: input.id }, source(caller), input.expectedRevision));
      },
    }),
    registry.register({
      id: 'theme_undo',
      title: 'Undo theme change',
      description: 'Apply an earlier revision of the theme choice (by default the one before the current) as a new revision, so the undo can be undone. Returns the new revision.',
      input: z.strictObject({ revision: z.number().int().min(1).optional() }),
      ui: false,
      mcp: true,
      run: (input) => guarded(() => service.undo(input.revision)),
    }),
    registry.register({
      id: 'theme_import',
      title: 'Import VS Code theme',
      description:
        'Import a VS Code colour theme from a .json or .vsix file (path), or from base64 file content (data with fileName). Only the theme JSON files and the license file of a package are read; no code runs. The mapping fills missing colours and moves colours that miss their contrast target (listed as adjustments; keepOriginalContrast keeps the original colours). A bare .json needs a license; a package uses its license file. A package with several themes needs themeLabel. dryRun returns the result without saving. Fetching from Open VSX is not supported: import a file.',
      input: z.strictObject({
        path: z.string().min(1).optional(),
        data: z.string().min(1).optional().describe('Base64 content of the file'),
        fileName: z.string().min(1).max(200).optional(),
        themeLabel: z.string().min(1).max(200).optional(),
        license: licenseSchema.optional(),
        keepOriginalContrast: z.boolean().optional(),
        dryRun: z.boolean().optional(),
      }),
      ui: false,
      mcp: true,
      run: (input) => {
        oneOf(input, ['path', 'data']);
        const bytes = input.path === undefined ? Buffer.from(input.data ?? '', 'base64') : readImportFile(input.path);
        const fileName = input.fileName ?? (input.path === undefined ? 'theme.json' : (input.path.split(/[\\/]/).at(-1) ?? 'theme.json'));
        const outcome = service.importTheme(
          { bytes, fileName, themeLabel: input.themeLabel, license: input.license, keepOriginalContrast: input.keepOriginalContrast },
          input.dryRun !== true,
        );
        if (!outcome.ok) {
          const first = outcome.issues[0];
          throw new CommandError('invalid_input', first ? `${first.message} ${first.hint}` : 'the theme cannot be imported', { issues: outcome.issues, ...(outcome.choices ? { labels: outcome.choices } : {}) });
        }
        return { saved: input.dryRun !== true, theme: outcome.theme, adjustments: outcome.adjustments, warnings: outcome.warnings };
      },
    }),
  ];
}
