/** Hooks the app registers through `--settings` (0004 decision 1). */
export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'PermissionRequest',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'SessionEnd',
] as const;

export type HookEventName = (typeof HOOK_EVENTS)[number];

/** Suffix of a completed hook payload file. Files still being written have another name. */
export const HOOK_FILE_SUFFIX = '.json';

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * The hook command stores the payload (one JSON document on stdin) as its own file in the inbox directory.
 * It writes to a temporary name and renames the file when complete, so concurrent hooks cannot interleave
 * and a reader never sees a partial payload. It prints nothing and exits 0, so it never answers a permission
 * request: the TUI shows its own prompt. The script runs under `/bin/sh` whatever the user's login shell is.
 */
export function hookCommand(inboxDir: string): string {
  const script = 'f=$(mktemp "$1/tmp-XXXXXX") && cat > "$f" && mv "$f" "$f' + HOOK_FILE_SUFFIX + '"';
  return `/bin/sh -c ${shellQuote(script)} sh ${shellQuote(inboxDir)}`;
}

export interface HookSettings {
  readonly hooks: Record<string, { hooks: { type: 'command'; command: string }[] }[]>;
}

export function hookSettings(inboxDir: string): HookSettings {
  const command = hookCommand(inboxDir);
  const hooks: HookSettings['hooks'] = {};
  for (const event of HOOK_EVENTS) hooks[event] = [{ hooks: [{ type: 'command', command }] }];
  return { hooks };
}
