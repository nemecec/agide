import { parseAppearanceMessage, type AppearanceMessage } from '../core/theme/appearance';

/** The channels of the appearance adapter. The renderer reads the OS state and the theme choice; the theme commands change the choice. */
export const APPEARANCE_IPC = {
  /** invoke() -> AppearanceMessage. */
  get: 'appearance:get',
  /** main -> renderer, one message per change of the OS state or the choice. */
  changed: 'appearance:changed',
} as const;

/** What the preload exposes as `window.appearance`. */
export interface AppearanceApi {
  get(): Promise<AppearanceMessage>;
  /** Receives every change. Returns a function that unsubscribes. */
  subscribe(listener: (message: AppearanceMessage) => void): () => void;
}

type Listener = (event: unknown, ...args: unknown[]) => void;

/** The part of Electron's `ipcRenderer` the API uses. */
export interface AppearanceIpcRenderer {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: Listener): unknown;
  removeListener(channel: string, listener: Listener): unknown;
}

export function createAppearanceApi(ipc: AppearanceIpcRenderer): AppearanceApi {
  return {
    get: async () => parseAppearanceMessage(await ipc.invoke(APPEARANCE_IPC.get)),
    subscribe: (listener) => {
      const handler: Listener = (_event, message) => listener(parseAppearanceMessage(message));
      ipc.on(APPEARANCE_IPC.changed, handler);
      return () => {
        ipc.removeListener(APPEARANCE_IPC.changed, handler);
      };
    },
  };
}
