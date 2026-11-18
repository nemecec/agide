import type { ActionClassId, OutwardMode, PermissionSettings } from '../../../core/permissions/types';

export const OUTWARD_MODES: readonly OutwardMode[] = ['allow', 'notify', 'draft', 'approve', 'deny'];

/** One host per line, blank lines dropped. */
export function parseHostLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** Sets one class mode in the settings; a mode equal to the class default removes the override. */
export function withOutwardMode(settings: PermissionSettings, id: ActionClassId, mode: OutwardMode, defaultMode: OutwardMode): PermissionSettings {
  const outward = { ...(settings.outward ?? {}) };
  if (mode === defaultMode) delete outward[id];
  else outward[id] = mode;
  const { outward: _previous, ...rest } = settings;
  return Object.keys(outward).length === 0 ? rest : { ...rest, outward };
}

/** The sentence under the network settings (0028 section 5). */
export function networkSentence(settings: PermissionSettings): string {
  return settings.network.bashSandbox
    ? `Bash commands may reach: ${settings.network.allow.join(', ') || 'no host'}. Connector and web fetch calls are not limited by this list.`
    : 'The network is not limited. Outward Bash commands still ask under the rules below.';
}
