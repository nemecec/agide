import { vi } from 'vitest';
import type { CommandResult } from '../../core/commands/types';
import type { AppEvent } from '../../core/events/index';
import type { RendererApi } from '../../shared/ipc';

type Responder = unknown | ((input: unknown) => unknown | Promise<unknown>);

export interface FakeApi {
  readonly invoke: ReturnType<typeof vi.fn>;
  /** Delivers an app event to every subscriber, as the preload does. */
  readonly emit: (event: AppEvent) => void;
  readonly subscriberCount: () => number;
  /** Replaces the answer of one command. */
  readonly respond: (commandId: string, responder: Responder) => void;
}

/**
 * Installs `window.api`. A command answers `{ ok: true, value }` with the responder's value; a responder that
 * returns a `CommandResult` object is passed through, so a test can answer a failure.
 */
export function installFakeApi(responders: Record<string, Responder> = {}): FakeApi {
  const table = new Map(Object.entries(responders));
  const subscribers = new Set<(event: AppEvent) => void>();
  const invoke = vi.fn(async (commandId: string, input?: unknown): Promise<CommandResult> => {
    const responder = table.get(commandId);
    const value = typeof responder === 'function' ? await (responder as (input: unknown) => unknown)(input) : responder;
    if (typeof value === 'object' && value !== null && 'ok' in value && typeof (value as { ok: unknown }).ok === 'boolean') return value as CommandResult;
    return { ok: true, value };
  });
  const api: RendererApi = {
    invoke: invoke as unknown as RendererApi['invoke'],
    listCommands: async () => [],
    subscribe: (listener) => {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
  };
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true });
  return {
    invoke,
    emit: (event) => subscribers.forEach((listener) => listener(event)),
    subscriberCount: () => subscribers.size,
    respond: (commandId, responder) => void table.set(commandId, responder),
  };
}
