/** The browser APIs that Radix reads and jsdom lacks. Installed once per test file that renders a component. */
export function installDomPolyfills(): void {
  if (typeof window === 'undefined') return;
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto['hasPointerCapture'] ??= () => false;
  proto['setPointerCapture'] ??= () => undefined;
  proto['releasePointerCapture'] ??= () => undefined;
  proto['scrollIntoView'] ??= () => undefined;
  const globals = globalThis as unknown as Record<string, unknown>;
  globals['ResizeObserver'] ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
