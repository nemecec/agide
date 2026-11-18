import { isLooser, qualifiesForBypass } from './modes';
import { PermissionError, type ModeRequest, type PermissionSettings } from './types';
import type { PermissionMode } from '../session/types';

/**
 * The mode a new or resumed session launches with. The new-session or new-task choice wins, then an explicit
 * test override (`AGIDE_PERMISSION_MODE`), then the profile's default. Bypass needs an isolating provider and a
 * confirmation, and no session starts looser than the session that started it (0028 sections 1 and 13).
 */
export function resolveSessionMode(request: ModeRequest, settings: PermissionSettings, override: PermissionMode | undefined): PermissionMode {
  const { requested } = request;
  if (requested === 'bypassPermissions') {
    if (!qualifiesForBypass(request.capabilities)) {
      throw new PermissionError('bypass_refused', 'bypassPermissions is offered only inside a provider that limits files and the network of the whole process');
    }
    if (request.inspectorAvailable === false) {
      throw new PermissionError('bypass_refused', 'bypassPermissions needs the tool-call inspector, which cannot run for this launch');
    }
    if (request.confirmBypassPermissions !== true) throw new PermissionError('confirmation_needed', 'bypassPermissions needs confirmBypassPermissions: true');
  }
  const mode = requested ?? override ?? settings.defaultMode;
  if (request.callerMode !== undefined && isLooser(mode, request.callerMode)) {
    throw new PermissionError('looser_than_caller', `a session started by a ${request.callerMode} session cannot run in ${mode} mode`);
  }
  return mode;
}
