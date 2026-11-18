/**
 * The Chrome DevTools Protocol seam. `main/browser` implements it over `webContents.debugger`; tests use a
 * fake that records calls and answers from a table. The core never imports Electron.
 */
export interface CdpTransport {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  /** Events of enabled domains, such as `Runtime.consoleAPICalled` and `Network.requestWillBeSent`. Returns an unsubscribe function. */
  onEvent(handler: (method: string, params: Record<string, unknown>) => void): () => void;
}

export class CdpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CdpError';
  }
}

/** Typed shortcut: sends a command and reads the answer as `T`. */
export async function cdp<T>(transport: CdpTransport, method: string, params?: Record<string, unknown>): Promise<T> {
  return (await transport.send(method, params)) as T;
}
