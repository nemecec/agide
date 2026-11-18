import type { CdpTransport } from '../../core/browser/cdp';

/** The parts of `webContents.debugger` the transport uses. */
export interface DebuggerLike {
  isAttached(): boolean;
  attach(version: string): void;
  detach(): void;
  sendCommand(method: string, params?: object): Promise<unknown>;
  on(event: 'message', listener: (event: unknown, method: string, params: Record<string, unknown>) => void): unknown;
  removeListener(event: 'message', listener: (event: unknown, method: string, params: Record<string, unknown>) => void): unknown;
}

/**
 * CDP over `webContents.debugger`, in process: no debugging port. `attach` is idempotent because a second
 * `debugger.attach` throws "Debugger is already attached to the target" (probe, 2026-11-17).
 */
export function debuggerTransport(debuggerApi: DebuggerLike): CdpTransport & { attach(): void; detach(): void } {
  return {
    attach(): void {
      if (!debuggerApi.isAttached()) debuggerApi.attach('1.3');
    },
    detach(): void {
      if (debuggerApi.isAttached()) debuggerApi.detach();
    },
    send: (method, params) => debuggerApi.sendCommand(method, params ?? {}),
    onEvent(handler) {
      const listener = (_event: unknown, method: string, params: Record<string, unknown>): void => handler(method, params);
      debuggerApi.on('message', listener);
      return () => {
        debuggerApi.removeListener('message', listener);
      };
    },
  };
}
