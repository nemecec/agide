import type { ProviderId } from '../profile/types';
import type { PermissionMode } from '../session/types';
import { ACTION_CLASSES } from './classTable';
import { DEFAULT_MODE_CHOICES, modeLabel } from './modes';
import type { ActionClassId, OutwardMode, PermissionSettings } from './types';

/** One sentence per mode for the setup pane and the new-session dialog (0028 section 1). */
export const MODE_SENTENCES: Readonly<Record<PermissionMode, string>> = {
  auto: 'Claude decides with its safety classifier. Outward actions such as pushes, comments and messages still ask; the profile settings list them.',
  default: 'Every tool call asks before it runs.',
  acceptEdits: 'File edits run without asking; other tool calls ask.',
  plan: 'Claude reads and plans first and asks before it changes anything.',
  bypassPermissions: 'Nothing asks, except outward actions that need a person. Only inside an isolating provider.',
};

/** Providers whose isolation lets bypass mode be offered. The session launch checks the real capabilities again. */
const BYPASS_PROVIDERS: readonly ProviderId[] = ['srt'];

export interface PermissionOptions {
  readonly settings: PermissionSettings;
  readonly modes: readonly { readonly id: PermissionMode; readonly label: string; readonly sentence: string }[];
  readonly bypassOffered: boolean;
  readonly classes: readonly { readonly id: ActionClassId; readonly title: string; readonly defaultMode: OutwardMode }[];
  readonly runsAsUser: boolean;
}

/** What the settings panel and the new-session dialog show. */
export function permissionOptions(settings: PermissionSettings, provider: ProviderId): PermissionOptions {
  const bypassOffered = BYPASS_PROVIDERS.includes(provider);
  const ids: readonly PermissionMode[] = [...DEFAULT_MODE_CHOICES, ...(bypassOffered ? (['bypassPermissions'] as const) : [])];
  return {
    settings,
    modes: ids.map((id) => ({ id, label: modeLabel(id), sentence: MODE_SENTENCES[id] })),
    bypassOffered,
    classes: ACTION_CLASSES.map((row) => ({ id: row.id, title: row.title, defaultMode: row.defaultMode })),
    runsAsUser: provider === 'local' || provider === 'fake',
  };
}
