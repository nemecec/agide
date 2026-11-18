import { api } from '../api';
import { openDialog } from './dialogStore';

type Outcome = { readonly leafId: string } | { readonly error: string };

let pending: ((outcome: Outcome) => void) | undefined;
let defaultTitle = 'Claude session';

/** The title the dialog starts with. */
export function newSessionTitle(): string {
  return defaultTitle;
}

/**
 * What the tree's "New Claude session" does: opens the new-session dialog and resolves when the dialog creates the
 * session (the leaf id) or is cancelled (an empty error, which the tree shows as nothing).
 */
export function startNewSession(folderId: string, title: string): Promise<Outcome> {
  pending?.({ error: '' });
  defaultTitle = title;
  return new Promise((resolve) => {
    pending = resolve;
    openDialog({ kind: 'new-session', folderId });
  });
}

/** Called by the dialog when it ends. */
export function finishNewSession(outcome: Outcome): void {
  const resolve = pending;
  pending = undefined;
  resolve?.(outcome);
}

export interface NewSessionRequest {
  readonly folderId: string;
  readonly title: string;
  readonly cwd?: string;
  readonly permissionMode: string;
  readonly confirmBypassPermissions?: boolean;
}

/** Creates the session from the dialog's choices. */
export async function createSession(request: NewSessionRequest): Promise<Outcome> {
  const result = await api().invoke<{ leafId: string }>('session_create', {
    folderId: request.folderId,
    title: request.title,
    ...(request.cwd === undefined || request.cwd.trim() === '' ? {} : { cwd: request.cwd.trim() }),
    permissionMode: request.permissionMode,
    ...(request.confirmBypassPermissions ? { confirmBypassPermissions: true } : {}),
  });
  return result.ok ? { leafId: result.value.leafId } : { error: result.error.message };
}
