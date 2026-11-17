import { createContext, useContext } from 'react';
import type { ContextValues } from '../../core/blocks/context';
import type { LayoutViewState } from './useLayoutState';

export interface LayoutContextValue {
  readonly view: LayoutViewState;
  readonly context: Partial<ContextValues>;
}

export const LayoutContext = createContext<LayoutContextValue | undefined>(undefined);

export function useLayoutContext(): LayoutContextValue {
  const value = useContext(LayoutContext);
  if (!value) throw new Error('pane rendered outside the layout host');
  return value;
}
