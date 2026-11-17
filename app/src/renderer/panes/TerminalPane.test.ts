// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionInfo } from '../../core/session/types';
import { installFakeApi, type FakeApi } from '../testing/fakeApi';
import { flush, render, type Rendered } from '../testing/render';

const terminals = vi.hoisted(() => [] as FakeTerminal[]);

interface FakeTerminal {
  cols: number;
  rows: number;
  written: string[];
  focused: number;
  disposed: boolean;
  emitData: (data: string) => void;
  emitResize: () => void;
}

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    written: string[] = [];
    focused = 0;
    disposed = false;
    private dataListener: (data: string) => void = () => {};
    private resizeListener: () => void = () => {};
    constructor() {
      terminals.push(this as unknown as FakeTerminal);
    }
    loadAddon() {}
    open() {}
    write(data: string) {
      this.written.push(data);
    }
    focus() {
      this.focused += 1;
    }
    dispose() {
      this.disposed = true;
    }
    onData(listener: (data: string) => void) {
      this.dataListener = listener;
      return { dispose() {} };
    }
    onResize(listener: () => void) {
      this.resizeListener = listener;
      return { dispose() {} };
    }
    emitData(data: string) {
      this.dataListener(data);
    }
    emitResize() {
      this.resizeListener();
    }
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));

const { TerminalPane } = await import('./TerminalPane');

const session = (status: SessionInfo['status']) => ({ id: 's1', status }) as SessionInfo;
let rendered: Rendered | undefined;
let fake: FakeApi;

beforeEach(() => {
  terminals.length = 0;
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
  vi.unstubAllGlobals();
});

async function mount(sessionId: string | undefined, snapshot: unknown) {
  fake = installFakeApi({ session_read_output: snapshot, session_resize: {}, session_write: {}, session_resume: {} });
  rendered = await render(createElement(TerminalPane, { sessionId }));
}
const status = () => rendered?.container.querySelector('[data-testid="terminal-status"]');
const calls = (id: string) => fake.invoke.mock.calls.filter((c) => c[0] === id).map((c) => c[1]);

describe('TerminalPane', () => {
  it('shows a placeholder and starts no terminal without a session', async () => {
    await mount(undefined, undefined);
    expect(rendered?.container.textContent, 'placeholder').toContain('No session selected');
    expect(terminals, 'no terminal').toHaveLength(0);
  });

  it('writes the snapshot, shows the status, sends its size and takes focus', async () => {
    await mount('s1', { session: session('idle'), data: 'history' });
    expect(terminals[0]?.written, 'snapshot written').toEqual(['history']);
    expect(status()?.textContent, 'status label').toBe('idle');
    expect(calls('session_resize'), 'size announced').toEqual([{ sessionId: 's1', cols: 80, rows: 24 }]);
    expect(terminals[0]?.focused, 'terminal focused').toBe(1);
  });

  it('does not send a size for an exited session and offers Resume', async () => {
    await mount('s1', { session: session('exited'), data: '' });
    expect(calls('session_resize'), 'no size for an exited session').toEqual([]);
    const resume = rendered?.container.querySelector('button');
    expect(resume?.textContent, 'resume button').toBe('Resume');
    await act(async () => resume?.click());
    expect(calls('session_resume'), 'resume command').toEqual([{ sessionId: 's1' }]);
    expect(terminals[0]?.written.at(-1), 'new line before the resumed process prints').toBe('\r\n');
  });

  it('reports a session that does not exist', async () => {
    await mount('s1', { session: undefined, data: '' });
    expect(status()?.textContent, 'status label').toBe('session not found');
  });

  it('shows output that arrives after the snapshot and drops output that arrived before it', async () => {
    let release: (value: unknown) => void = () => {};
    fake = installFakeApi({ session_read_output: () => new Promise((resolve) => (release = resolve)), session_resize: {} });
    rendered = await render(createElement(TerminalPane, { sessionId: 's1' }));
    fake.emit({ type: 'session.output', sessionId: 's1', data: 'early' });
    release({ session: session('idle'), data: 'snapshot-with-early' });
    await flush();
    fake.emit({ type: 'session.output', sessionId: 's1', data: 'late' });
    fake.emit({ type: 'session.output', sessionId: 'other', data: 'foreign' });
    expect(terminals[0]?.written, 'snapshot then later output only').toEqual(['snapshot-with-early', 'late']);
  });

  it('follows the status of its own session and ignores others', async () => {
    await mount('s1', { session: session('idle'), data: '' });
    await act(async () => fake.emit({ type: 'session.status_changed', session: { id: 'other', status: 'busy' }, previous: 'idle' } as never));
    expect(status()?.textContent, 'other session ignored').toBe('idle');
    await act(async () => fake.emit({ type: 'session.status_changed', session: { id: 's1', status: 'busy' }, previous: 'idle' } as never));
    expect(status()?.textContent, 'own status').toBe('busy');
  });

  it('announces its size again when an exited session restarts, and shows missing when closed', async () => {
    await mount('s1', { session: session('exited'), data: '' });
    await act(async () => fake.emit({ type: 'session.status_changed', session: { id: 's1', status: 'starting' }, previous: 'exited' } as never));
    expect(calls('session_resize'), 'size after restart').toHaveLength(1);
    await act(async () => fake.emit({ type: 'session.closed', sessionId: 's1' }));
    expect(status()?.textContent, 'closed session').toBe('session not found');
  });

  it('sends typed input and size changes to the session', async () => {
    await mount('s1', { session: session('idle'), data: '' });
    fake.invoke.mockClear();
    terminals[0]?.emitData('ls\r');
    terminals[0]!.cols = 100;
    terminals[0]?.emitResize();
    expect(calls('session_write'), 'typed data').toEqual([{ sessionId: 's1', data: 'ls\r' }]);
    expect(calls('session_resize'), 'new size').toEqual([{ sessionId: 's1', cols: 100, rows: 24 }]);
  });

  it('disposes the terminal and unsubscribes on unmount', async () => {
    await mount('s1', { session: session('idle'), data: '' });
    await rendered?.unmount();
    rendered = undefined;
    expect(terminals[0]?.disposed, 'terminal disposed').toBe(true);
    expect(fake.subscriberCount(), 'unsubscribed').toBe(0);
  });

  it('starts a new terminal when the session changes', async () => {
    await mount('s1', { session: session('idle'), data: '' });
    await rendered?.rerender(createElement(TerminalPane, { sessionId: 's2' }));
    expect(terminals, 'one terminal per session').toHaveLength(2);
    expect(terminals[0]?.disposed, 'first terminal disposed').toBe(true);
  });
});
