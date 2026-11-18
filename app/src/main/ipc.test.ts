import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CommandRegistry } from '../core/commands/index';
import { createAppEventBus } from '../core/events/index';
import { IPC } from '../shared/ipc';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
const windows: { isDestroyed: () => boolean; webContents: { send: ReturnType<typeof vi.fn>; getURL: () => string } }[] = [];
const known = new Set<unknown>();

vi.mock('electron', () => ({
  app: { isPackaged: true },
  shell: { openExternal: vi.fn() },
  ipcMain: {
    handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel),
  },
  BrowserWindow: {
    fromWebContents: (contents: unknown) => (known.has(contents) ? {} : null),
    getAllWindows: () => windows,
  },
}));

const { registerIpc } = await import('./ipc');

const PAGE = new URL('../renderer/index.html', `file://${import.meta.dirname}/`).href;

function senderEvent(options: { url?: string; inWindow?: boolean; mainFrame?: boolean } = {}) {
  const frame = { url: options.url ?? PAGE };
  const sender = { mainFrame: options.mainFrame === false ? { url: PAGE } : frame };
  if (options.inWindow !== false) known.add(sender);
  return { sender, senderFrame: frame };
}

function setup() {
  const commands = new CommandRegistry();
  const ran: unknown[] = [];
  commands.register({
    id: 'test_run',
    title: 'Run',
    description: 'Records its input.',
    input: z.object({ n: z.number().optional() }),
    ui: true,
    mcp: false,
    run: (input: unknown) => {
      ran.push(input);
      return 'done';
    },
  } as never);
  const events = createAppEventBus();
  const dispose = registerIpc(commands, events);
  return { commands, events, dispose, ran };
}

beforeEach(() => {
  handlers.clear();
  windows.length = 0;
  known.clear();
});

describe('registerIpc', () => {
  it('runs a command from the main frame of an app window', async () => {
    const { ran } = setup();
    const result = await handlers.get(IPC.invoke)?.(senderEvent(), 'test_run', { n: 1 });
    expect(result, 'result').toEqual({ ok: true, value: 'done' });
    expect(ran, 'command input').toEqual([{ n: 1 }]);
  });

  it('rejects a frame that shows a foreign page', async () => {
    const { ran } = setup();
    const result = await handlers.get(IPC.invoke)?.(senderEvent({ url: 'https://example.com/' }), 'test_run', {});
    expect(result, 'foreign frame').toMatchObject({ ok: false, error: { message: 'rejected' } });
    expect(ran, 'nothing ran').toEqual([]);
  });

  it('rejects a subframe of an app page', async () => {
    const { ran } = setup();
    const event = senderEvent({ mainFrame: false });
    expect(await handlers.get(IPC.invoke)?.(event, 'test_run', {}), 'subframe').toMatchObject({ ok: false, error: { message: 'rejected' } });
    expect(ran, 'nothing ran').toEqual([]);
  });

  it('rejects web contents that belong to no app window', async () => {
    const { ran } = setup();
    const event = senderEvent({ inWindow: false });
    expect(await handlers.get(IPC.invoke)?.(event, 'test_run', {}), 'surface contents').toMatchObject({ ok: false, error: { message: 'rejected' } });
    expect(handlers.get(IPC.list)?.(event), 'no command list either').toEqual([]);
    expect(ran, 'nothing ran').toEqual([]);
  });

  it('lists the commands for the app page', () => {
    setup();
    expect(handlers.get(IPC.list)?.(senderEvent()), 'descriptors').toEqual([expect.objectContaining({ id: 'test_run' })]);
  });

  it('broadcasts bus events to every live window and skips destroyed ones', () => {
    const { events } = setup();
    const live = { isDestroyed: () => false, webContents: { send: vi.fn(), getURL: () => PAGE } };
    const dead = { isDestroyed: () => true, webContents: { send: vi.fn(), getURL: () => PAGE } };
    windows.push(live, dead);
    events.emit({ type: 'tree.changed' } as never);
    expect(live.webContents.send, 'live window').toHaveBeenCalledWith(IPC.event, { type: 'tree.changed' });
    expect(dead.webContents.send, 'destroyed window').not.toHaveBeenCalled();
  });

  it('does not send events to a window that shows a third-party page, such as a sign-in pop-up', () => {
    const { events } = setup();
    const app = { isDestroyed: () => false, webContents: { send: vi.fn(), getURL: () => PAGE } };
    const popup = { isDestroyed: () => false, webContents: { send: vi.fn(), getURL: () => 'https://accounts.example/signin' } };
    windows.push(app, popup);
    events.emit({ type: 'tree.changed' } as never);
    expect(app.webContents.send, 'app window').toHaveBeenCalled();
    expect(popup.webContents.send, 'pop-up window').not.toHaveBeenCalled();
  });

  it('removes its handlers and stops broadcasting when disposed', () => {
    const { events, dispose } = setup();
    const live = { isDestroyed: () => false, webContents: { send: vi.fn(), getURL: () => PAGE } };
    windows.push(live);
    dispose();
    events.emit({ type: 'tree.changed' } as never);
    expect([...handlers.keys()], 'no handlers').toEqual([]);
    expect(live.webContents.send, 'no broadcast').not.toHaveBeenCalled();
  });
});
