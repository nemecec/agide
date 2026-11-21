import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { installDomPolyfills } from './polyfills';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Rendered {
  readonly container: HTMLElement;
  readonly rerender: (element: ReactElement) => Promise<void>;
  readonly unmount: () => Promise<void>;
}

/** Renders into a detached container and waits for effects and the promises they started. */
export async function render(element: ReactElement): Promise<Rendered> {
  installDomPolyfills();
  const container = document.createElement('div');
  document.body.append(container);
  const root: Root = createRoot(container);
  await act(async () => root.render(element));
  return {
    container,
    rerender: (next) => act(async () => root.render(next)),
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

export interface HookRender<T> {
  readonly current: () => T;
  readonly rerender: (props?: unknown) => Promise<void>;
  readonly unmount: () => Promise<void>;
}

/** Runs a hook in a component and exposes its latest return value. */
export async function renderHook<T, P = void>(hook: (props: P) => T, props?: P): Promise<HookRender<T>> {
  let latest: T | undefined;
  const Probe = ({ value }: { value: P }) => {
    latest = hook(value);
    return null;
  };
  const rendered = await render(createElement(Probe, { value: props as P }));
  return {
    current: () => latest as T,
    rerender: (next) => rendered.rerender(createElement(Probe, { value: (next ?? props) as P })),
    unmount: rendered.unmount,
  };
}

/** Runs queued effects and promise callbacks. */
export const flush = (): Promise<void> => act(async () => {});
