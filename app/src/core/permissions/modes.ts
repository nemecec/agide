import type { ProviderCapabilities } from '../isolation/types';
import type { PermissionMode } from '../session/types';
import type { DefaultPermissionMode } from './types';

/** Modes a profile can make its default, in the order the setup pane lists them. */
export const DEFAULT_MODE_CHOICES: readonly DefaultPermissionMode[] = ['auto', 'default', 'acceptEdits', 'plan'];

/** From strictest to loosest (0028 section 13). Bypass is looser than every other mode. */
export const MODE_ORDER: readonly PermissionMode[] = ['plan', 'default', 'acceptEdits', 'auto', 'bypassPermissions'];

/** True when `mode` lets more through without asking than `than`. */
export function isLooser(mode: PermissionMode, than: PermissionMode): boolean {
  return MODE_ORDER.indexOf(mode) > MODE_ORDER.indexOf(than);
}

/** Bypass is offered only inside a provider that limits files and the whole process's network (0025, 0028 section 6). */
export function qualifiesForBypass(capabilities: ProviderCapabilities): boolean {
  return capabilities.filesystem === 'enforced' && capabilities.network === 'allowlist';
}

/** The words the UI shows for a mode; the CLI reports `manual` as `default` (P22). */
export function modeLabel(mode: PermissionMode | string): string {
  switch (mode) {
    case 'auto':
      return 'Auto';
    case 'default':
    case 'manual':
      return 'Ask every time';
    case 'acceptEdits':
      return 'Accept edits';
    case 'plan':
      return 'Plan first';
    case 'bypassPermissions':
      return 'Bypass';
    default:
      return mode;
  }
}
