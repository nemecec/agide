/**
 * The paths Claude Code protects from writes without a prompt, and the shell profile files an agent could use to run
 * code later. Compared against the permissions documentation of Claude Code when built (0040 section 7.2); a change
 * there is a change here. Matching ignores case, since the user's file system may.
 */
export const PROTECTED_DIRECTORIES: readonly string[] = ['.git', '.claude', '.vscode', '.idea', '.husky'];

export const PROTECTED_FILES: readonly string[] = ['.bashrc', '.bash_profile', '.bash_login', '.bash_logout', '.profile', '.zshrc', '.zprofile', '.zshenv', '.zlogin', '.zlogout', '.mcp.json', '.claude.json', 'config.fish'];

/** The protected entry that holds the path, or undefined. A `.git` file (a worktree pointer) counts like the directory. */
export function protectedEntry(path: string): string | undefined {
  const parts = path.toLowerCase().split('/');
  const directory = PROTECTED_DIRECTORIES.find((name) => parts.slice(0, -1).includes(name) || parts.at(-1) === name);
  if (directory !== undefined) return directory;
  const name = parts.at(-1) ?? '';
  return PROTECTED_FILES.find((file) => file === name);
}
