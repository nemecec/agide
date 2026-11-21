import { lstatSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, readOwnRegularFile, writeFileAtomic } from '../profile/fsio';
import { BUILTIN_THEMES } from './builtin/index';
import { validateThemeText, type ThemeDocument, type ThemeIssue } from './schema';

const MAX_THEME_BYTES = 1024 * 1024;
const FILE_EXTENSION = '.json';

export interface UserThemeProblem {
  readonly file: string;
  readonly issues: readonly ThemeIssue[];
}

/** The themes of a profile: one JSON file each under `<profile data directory>/themes/`. Invalid files are skipped and reported. */
export class UserThemeStore {
  constructor(private readonly directory: string) {}

  private fileOf(id: string): string {
    return join(this.directory, `${id}${FILE_EXTENSION}`);
  }

  /** Reads every file. A file whose content fails validation, or whose id differs from its name, is a problem and not a theme. */
  scan(): { themes: ThemeDocument[]; problems: UserThemeProblem[] } {
    const themes: ThemeDocument[] = [];
    const problems: UserThemeProblem[] = [];
    let names: string[] = [];
    try {
      names = readdirSync(this.directory).filter((name) => name.endsWith(FILE_EXTENSION)).sort();
    } catch {
      return { themes, problems };
    }
    const taken = new Set(BUILTIN_THEMES.map((theme) => theme.id));
    for (const name of names) {
      const text = readOwnRegularFile(join(this.directory, name), { maxBytes: MAX_THEME_BYTES });
      if (text === undefined) {
        problems.push({ file: name, issues: [{ code: 'invalid_json', severity: 'error', path: '', message: 'The file cannot be read.', hint: 'Use a regular file of this user under 1 MiB.' }] });
        continue;
      }
      const result = validateThemeText(text);
      if (!result.ok || !result.theme) {
        problems.push({ file: name, issues: result.issues });
      } else if (`${result.theme.id}${FILE_EXTENSION}` !== name) {
        problems.push({ file: name, issues: [{ code: 'invalid_value', severity: 'error', path: '/id', message: `\`/id\` is \`${result.theme.id}\` but the file is named \`${name}\`.`, hint: 'Name the file after the id.' }] });
      } else if (taken.has(result.theme.id)) {
        problems.push({ file: name, issues: [{ code: 'id_conflict', severity: 'error', path: '/id', message: `A theme with id \`${result.theme.id}\` exists.`, hint: 'Choose another id.' }] });
      } else {
        taken.add(result.theme.id);
        themes.push(result.theme);
      }
    }
    return { themes, problems };
  }

  write(theme: ThemeDocument): void {
    ensureDir(this.directory);
    writeFileAtomic(this.fileOf(theme.id), `${JSON.stringify(theme, null, 2)}\n`);
  }

  has(id: string): boolean {
    try {
      return lstatSync(this.fileOf(id)).isFile();
    } catch {
      return false;
    }
  }

  remove(id: string): void {
    rmSync(this.fileOf(id), { force: true });
  }
}
