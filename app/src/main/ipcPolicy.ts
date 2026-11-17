import type { CommandRegistry } from '../core/commands/index';
import type { CommandResult } from '../core/commands/types';

export interface InvokeSource {
  /** The sender belongs to an app window; the web content of a browser surface does not. */
  readonly inAppWindow: boolean;
  readonly isMainFrame: boolean;
  readonly frameUrl: string;
}

/** Only the main frame of an app window, showing an app page, may call commands. */
export function isTrustedSource(source: InvokeSource, isAppFrame: (url: string) => boolean): boolean {
  return source.inAppWindow && source.isMainFrame && isAppFrame(source.frameUrl);
}

const REJECTED: CommandResult = { ok: false, error: { code: 'not_found', message: 'rejected' } };

/** Runs a command as the UI caller. A foreign source or a non-string command id gets the same answer as an unknown command. */
export function invokeFromRenderer(commands: CommandRegistry, trusted: boolean, commandId: unknown, input: unknown): Promise<CommandResult> {
  if (!trusted || typeof commandId !== 'string') return Promise.resolve(REJECTED);
  return commands.invoke(commandId, input, { kind: 'ui' });
}

/** The command list is for trusted sources only. */
export function listFromRenderer(commands: CommandRegistry, trusted: boolean) {
  return trusted ? commands.describe() : [];
}
