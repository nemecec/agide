import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContextValues } from '../../core/blocks/context';
import type { LayoutDocument, LayoutIssue } from '../../core/blocks/layout';
import { api } from '../api';

export interface Resolution {
  readonly status: 'ok' | 'placeholder';
  readonly reason?: string;
  readonly message?: string;
}

export interface LayoutViewState {
  readonly layoutId: string;
  readonly layout: LayoutDocument;
  readonly revision: number;
  readonly readOnly: boolean;
  readonly fileIssues: readonly LayoutIssue[];
  readonly lastChange?: { readonly revision: number; readonly source: string; readonly summary: readonly string[] };
  readonly resolutions: Readonly<Record<string, Resolution>>;
  readonly activeLayoutId: string;
  readonly layouts: readonly { id: string; title: string; active: boolean }[];
}

/** The window's layout from `layout_get` and the shared context, refreshed on `layout.*`, `blocks.*` and `context.*` events. */
export function useLayoutState(): { view: LayoutViewState | undefined; context: Partial<ContextValues> } {
  const [view, setView] = useState<LayoutViewState | undefined>(undefined);
  const [context, setContext] = useState<Partial<ContextValues>>({});
  const viewTicket = useRef(0);
  const contextTicket = useRef(0);

  const refreshView = useCallback(async () => {
    const ticket = ++viewTicket.current;
    const result = await api().invoke<LayoutViewState>('layout_get');
    if (ticket === viewTicket.current && result.ok) setView(result.value);
  }, []);
  const refreshContext = useCallback(async () => {
    const ticket = ++contextTicket.current;
    const result = await api().invoke<Partial<ContextValues>>('ui_get_context');
    if (ticket === contextTicket.current && result.ok) setContext(result.value);
  }, []);

  useEffect(() => {
    void refreshView();
    void refreshContext();
    return api().subscribe((event) => {
      if (event.type === 'layout.applied' || event.type === 'blocks.changed') void refreshView();
      else if (event.type === 'context.changed') void refreshContext();
    });
  }, [refreshView, refreshContext]);

  return { view, context };
}
