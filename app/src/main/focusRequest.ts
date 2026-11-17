/** The request a later start of the same profile sends. `argv` is not read, since Electron may reorder it. */
export function isFocusRequest(data: unknown, profileId: string): boolean {
  if (typeof data !== 'object' || data === null) return false;
  const request = data as { profileId?: unknown; action?: unknown };
  return request.profileId === profileId && request.action === 'focus';
}
