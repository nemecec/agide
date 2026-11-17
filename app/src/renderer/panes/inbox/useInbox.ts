import { useCallback, useEffect, useRef, useState } from 'react';
import type { ItemRow } from '../../../core/inbox/viewTypes';
import { api } from '../../api';

export type Filter = 'open' | 'done';

/** The items of one filter and the unread count, refreshed on every inbox event. */
export function useInbox(filter: Filter): { items: ItemRow[]; unread: number; loaded: boolean; refresh: () => void } {
  const [items, setItems] = useState<ItemRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Number of the newest request; an older response is dropped, and so is any response after unmount. */
  const latest = useRef(0);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    const result = await api().invoke<{ items: ItemRow[]; unread: number }>('inbox_list', {
      states: filter === 'open' ? ['new', 'seen', 'snoozed'] : ['done'],
      limit: 200,
    });
    if (mine !== latest.current || !result.ok) return;
    setItems(result.value.items);
    setUnread(result.value.unread);
    setLoaded(true);
  }, [filter]);

  const refresh = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(), 30);
  }, [load]);

  useEffect(() => {
    void load();
    const off = api().subscribe((event) => {
      if (event.type === 'inbox.item_changed') refresh();
      else if (event.type === 'inbox.unread_changed') setUnread(event.count);
    });
    return () => {
      latest.current += 1;
      clearTimeout(timer.current);
      off();
    };
  }, [load, refresh]);

  return { items, unread, loaded, refresh };
}
