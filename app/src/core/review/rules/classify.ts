import { matchesGlob } from './glob';

/** Path classes of the catalogue (0040 section 7.2). Names that Claude Code, git or a CI system read are matched ignoring case. */

const base = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

export const isAgentConfig = (path: string): boolean => {
  const lower = path.toLowerCase();
  const name = base(lower);
  return name === 'claude.md' || name === 'agents.md' || name === 'claude.local.md' || name === '.mcp.json' || lower.split('/').slice(0, -1).some((part) => part === '.claude' || part === '.agents');
};

export const isGitConfig = (path: string): boolean => {
  const lower = path.toLowerCase();
  const name = base(lower);
  return name === '.gitattributes' || name === '.gitmodules' || name === '.gitconfig' || lower.split('/').slice(0, -1).some((part) => part === '.githooks' || part === '.husky');
};

const CI_GLOBS = ['.github/workflows/**', '.github/actions/**', '.gitlab-ci.yml', '.circleci/**', 'azure-pipelines.yml', 'Jenkinsfile'];
export const isCiConfig = (path: string): boolean => CI_GLOBS.some((glob) => matchesGlob(path, glob, true));

const TEST_LINT_GLOBS = [
  'vitest.config.*',
  'vitest.workspace.*',
  'jest.config.*',
  'playwright.config.*',
  'eslint.config.*',
  '.eslintrc*',
  'tsconfig*.json',
  'pytest.ini',
  'setup.cfg',
  '.golangci.*',
  'detekt*.yml',
  'sonar-project.properties',
  'conftest.py',
];
export const isTestLintConfig = (path: string): boolean => TEST_LINT_GLOBS.some((glob) => matchesGlob(path, glob, true));

const DEPENDENCY_GLOBS = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  '*.gradle',
  '*.gradle.kts',
  'gradle/libs.versions.toml',
  'pom.xml',
  'Cargo.toml',
  'Cargo.lock',
  'go.mod',
  'go.sum',
  'requirements*.txt',
  'pyproject.toml',
  'uv.lock',
  'poetry.lock',
  'Gemfile',
  'Gemfile.lock',
];
export const isDependencyFile = (path: string): boolean => DEPENDENCY_GLOBS.some((glob) => matchesGlob(path, glob, true));

const BUILD_GLOBS = ['Makefile', 'Dockerfile*', '*.mk'];
export const isBuildFile = (path: string): boolean => BUILD_GLOBS.some((glob) => matchesGlob(path, glob, true));

export const isPackageJson = (path: string): boolean => base(path) === 'package.json';

const SOURCE_EXTENSIONS = /\.(?:ts|tsx|js|jsx|mjs|cjs|kt|kts|java|py|go|rs|rb|php|cs|swift|scala|c|cc|cpp|h|hpp)$/i;
export const isSourceFile = (path: string): boolean => SOURCE_EXTENSIONS.test(path);

/** The path with control and bidirectional characters written out, for subjects and evidence the UI shows. */
export function escapePath(path: string): string {
  return Array.from(path, (char) => {
    const code = char.codePointAt(0)!;
    if (char === '\n') return '\\n';
    if (char === '\t') return '\\t';
    if (code < 0x20 || code === 0x7f) return `\\x${code.toString(16).padStart(2, '0')}`;
    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) || code === 0x200e || code === 0x200f || code === 0x061c) return `\\u${code.toString(16).padStart(4, '0')}`;
    return char;
  }).join('');
}

export type PackageJsonChange = { readonly scripts: boolean; readonly dependencies: boolean };

const DEPENDENCY_SECTIONS = new Set(['dependencies', 'devdependencies', 'peerdependencies', 'optionaldependencies', 'overrides', 'resolutions', 'bundleddependencies']);
const ENTRY = /^[+-]?(\s*)"([^"]+)"\s*:\s*(.*?),?\s*$/;
/** Top-level fields that are neither scripts nor dependencies; another entry outside a visible block counts as both. */
const TOP_LEVEL_FIELDS = new Set(['name', 'version', 'description', 'private', 'type', 'main', 'module', 'types', 'typings', 'license', 'author', 'homepage', 'keywords', 'files', 'packageManager', 'sideEffects', 'browser']);

/**
 * Which part of a `package.json` the changed lines of its hunks belong to. The section comes from the opening line
 * when the hunk shows it; a changed entry whose block the hunk does not show counts as both a script and a
 * dependency, unless it is a known top-level field, so an edited check command is never missed.
 */
export function packageJsonChange(hunkBodies: readonly string[]): PackageJsonChange {
  let scripts = false;
  let dependencies = false;
  for (const body of hunkBodies) {
    const stack: { indent: number; name: string }[] = [];
    for (const line of body.split('\n')) {
      const mark = line[0];
      if (mark === '\\') continue;
      const content = mark === '+' || mark === '-' || mark === ' ' ? line.slice(1) : line;
      const closing = /^(\s*)\},?\s*$/.exec(content);
      if (closing !== null) {
        while (stack.length > 0 && stack.at(-1)!.indent >= closing[1]!.length) stack.pop();
        continue;
      }
      const opening = /^(\s*)"([^"]+)"\s*:\s*\{\s*$/.exec(content);
      if (opening !== null) {
        stack.push({ indent: opening[1]!.length, name: opening[2]!.toLowerCase() });
        if (mark === '+' || mark === '-') {
          if (opening[2] === 'scripts') scripts = true;
          else if (DEPENDENCY_SECTIONS.has(opening[2]!.toLowerCase())) dependencies = true;
        }
        continue;
      }
      if (mark !== '+' && mark !== '-') continue;
      const entry = ENTRY.exec(line);
      if (entry === null) continue;
      const section = stack.at(-1)?.name;
      if (section === 'scripts') scripts = true;
      else if (section !== undefined && DEPENDENCY_SECTIONS.has(section)) dependencies = true;
      else if (section === undefined && !TOP_LEVEL_FIELDS.has(entry[2]!)) {
        // The hunk does not show which block the entry is in, so it may be either.
        scripts = true;
        dependencies = true;
      }
    }
  }
  return { scripts, dependencies };
}
