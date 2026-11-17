/** What `profile_list` returns. */
export interface ProfileListEntry {
  readonly id: string;
  readonly name: string;
  readonly colour: string;
  readonly running: boolean;
  readonly unread?: number;
}

export interface ProfileList {
  readonly own: string;
  /** False for the in-memory profile of tests: no rail. */
  readonly persistent: boolean;
  readonly palette: readonly string[];
  readonly profiles: readonly ProfileListEntry[];
}

export const initialOf = (name: string): string => (name.trim().charAt(0) || '?').toUpperCase();

/** The badge text: nothing for zero, "99+" past two digits. */
export const badgeText = (unread: number | undefined): string | undefined => (unread === undefined || unread <= 0 ? undefined : unread > 99 ? '99+' : String(unread));
