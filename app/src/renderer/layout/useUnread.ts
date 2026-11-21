import { useEffect, useState } from 'react';
import { api } from '../api';

/** The number of unread inbox items, read once and then kept current by the unread events. */
export function useUnread(): number {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let live = true;
    void api()
      .invoke<{ unread: number }>('inbox_list', { states: ['new', 'seen', 'snoozed'], limit: 1 })
      .then((result) => {
        if (live && result.ok) setUnread(result.value.unread);
      });
    const off = api().subscribe((event) => {
      if (event.type === 'inbox.unread_changed') setUnread(event.count);
    });
    return () => {
      live = false;
      off();
    };
  }, []);
  return unread;
}
