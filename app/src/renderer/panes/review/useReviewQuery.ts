import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import type { Outcome } from './reviewApi';

export type Query<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly value: T };

const REFRESH_DELAY_MS = 30;

/**
 * Loads `fetch` once the key is set and again after every review event; an older answer never replaces a newer
 * one. While it reloads the previous value stays on screen, so the view does not flash. A null key loads nothing.
 */
export function useReviewQuery<T>(key: string | null, fetch: () => Promise<Outcome<T>>): Query<T> & { readonly reload: () => void } {
  const [state, setState] = useState<Query<T>>({ status: 'loading' });
  const latest = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fetchRef = useRef(fetch);
  fetchRef.current = fetch;

  const load = useCallback(async () => {
    const mine = ++latest.current;
    const result = await fetchRef.current();
    if (mine !== latest.current) return;
    setState(result.ok ? { status: 'ready', value: result.value } : { status: 'error', message: result.failure.message });
  }, []);

  const reload = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(), REFRESH_DELAY_MS);
  }, [load]);

  useEffect(() => {
    if (key === null) return undefined;
    setState({ status: 'loading' });
    void load();
    const off = api().subscribe((event) => {
      if (event.type === 'review.changed' || event.type === 'review.seen') reload();
    });
    return () => {
      latest.current += 1;
      clearTimeout(timer.current);
      off();
    };
  }, [key, load, reload]);

  return { ...state, reload: () => void load() };
}
