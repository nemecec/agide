import type { ProfileId } from '../core/profile/index';

/**
 * What the profile module needs from the Electron process: opening a profile.
 * `index.ts` installs the real host before the modules start; without one (plain Node tests) opening reports
 * that it is unavailable.
 */
export interface ProfileHost {
  open(id: ProfileId): void;
}

const unavailable: ProfileHost = {
  open: () => {
    throw new Error('opening a profile needs the desktop app');
  },
};

let current: ProfileHost = unavailable;

export const installProfileHost = (host: ProfileHost): void => {
  current = host;
};
export const profileHost = (): ProfileHost => current;
