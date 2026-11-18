import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import type { BrowserTabView } from './model';

const POLL_MS = 700;
const READ_FLASH_MS = 2000;

/**
 * State of one browser tab from `browser_tab_state`, refreshed by polling and on every `browser.*` event, plus
 * `reading`, true for two seconds after an agent read the tab (the filled eye of the indicator).
 */
export function useBrowserTab(key: { readonly leafId?: string; readonly surfaceId?: string }, options: { readonly poll?: boolean } = {}): { state: BrowserTabView | undefined; reading: boolean; refresh: () => void } {
  const [state, setState] = useState<BrowserTabView | undefined>(undefined);
  const [reading, setReading] = useState(false);
  const leaf = useRef<string | undefined>(key.leafId);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { leafId, surfaceId } = key;

  const refresh = useCallback(() => {
    void api()
      .invoke<BrowserTabView>('browser_tab_state', { ...(leafId === undefined ? {} : { leafId }), ...(surfaceId === undefined ? {} : { surfaceId }) })
      .then((result) => {
        if (!result.ok) return;
        if (result.value.known) leaf.current = result.value.leafId;
        setState((current) => (JSON.stringify(current) === JSON.stringify(result.value) ? current : result.value));
      });
  }, [leafId, surfaceId]);

  useEffect(() => {
    refresh();
    const interval = options.poll === false ? undefined : setInterval(refresh, POLL_MS);
    const stop = api().subscribe((event) => {
      if (event.type === 'browser.accessed') {
        if (event.entry.nodeId === leaf.current && event.entry.outcome === 'ok' && event.entry.kind !== 'act') {
          setReading(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setReading(false), READ_FLASH_MS);
        }
        refresh();
      } else if (event.type === 'browser.observation_changed') refresh();
    });
    return () => {
      if (interval) clearInterval(interval);
      clearTimeout(timer.current);
      stop();
    };
  }, [refresh, options.poll]);

  return { state, reading, refresh };
}
