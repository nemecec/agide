import { MODE_ORDER } from '../permissions/modes';
import type { PermissionMode } from '../session/types';

/** The strictest of the given modes in the order of `permissions/modes.ts` (0037 section 7.1). */
export function strictestMode(first: PermissionMode, ...rest: readonly PermissionMode[]): PermissionMode {
  return rest.reduce((strictest, mode) => (MODE_ORDER.indexOf(mode) < MODE_ORDER.indexOf(strictest) ? mode : strictest), first);
}
