import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { ProfileList } from './profileModel';

/** `profile_list`, fetched again when any profile's registry entry changes and when the window gets focus. */
export function useProfiles(): { list: ProfileList | undefined; reload: () => void } {
  const [list, setList] = useState<ProfileList | undefined>(undefined);
  const reload = useCallback(() => {
    void api()
      .invoke<ProfileList>('profile_list', {})
      .then((result) => {
        if (result.ok) setList(result.value);
      });
  }, []);
  useEffect(() => {
    reload();
    const off = api().subscribe((event) => {
      if (event.type === 'profile.statuses_changed') reload();
    });
    window.addEventListener('focus', reload);
    return () => {
      off();
      window.removeEventListener('focus', reload);
    };
  }, [reload]);
  return { list, reload };
}
