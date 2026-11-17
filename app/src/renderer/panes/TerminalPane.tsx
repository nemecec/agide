import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITheme } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';
import type { SessionInfo, SessionStatus } from '../../core/session/types';
import { api } from '../api';
import './TerminalPane.css';

const DARK: ITheme = { background: '#1e1e1e', foreground: '#e5e5e7', cursor: '#e5e5e7' };
const LIGHT: ITheme = { background: '#ffffff', foreground: '#1d1d1f', cursor: '#1d1d1f', selectionBackground: '#b4d5fe' };

const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

/** Terminal of one Claude session, or a placeholder when none is selected. */
export function TerminalPane({ sessionId }: { sessionId?: string | undefined }) {
  if (!sessionId) return <div className="placeholder">No session selected</div>;
  return <SessionTerminal key={sessionId} sessionId={sessionId} />;
}

type View = { kind: 'loading' } | { kind: 'missing' } | { kind: 'ready'; status: SessionStatus };

function SessionTerminal({ sessionId }: { sessionId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const [view, setView] = useState<View>({ kind: 'loading' });

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const term = new Terminal({
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: false,
      theme: prefersDark() ? DARK : LIGHT,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element);
    terminal.current = term;

    let live = true;
    // Output that arrives before the snapshot is part of the snapshot: events and the snapshot reply travel
    // the same channel in order, so everything received before the reply was emitted before the snapshot was taken.
    let replayed = false;

    const sendSize = () => {
      void api().invoke('session_resize', { sessionId, cols: term.cols, rows: term.rows });
    };
    const refit = () => {
      if (element.clientWidth === 0 || element.clientHeight === 0) return;
      fit.fit();
    };

    const input = term.onData((data) => {
      void api().invoke('session_write', { sessionId, data });
    });
    const resized = term.onResize(sendSize);
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(refit);
    });
    observer.observe(element);

    const unsubscribe = api().subscribe((event) => {
      if (event.type === 'session.output' && event.sessionId === sessionId) {
        if (replayed) term.write(event.data);
      } else if (event.type === 'session.status_changed' && event.session.id === sessionId) {
        setView({ kind: 'ready', status: event.session.status });
        if (event.previous === 'exited') sendSize();
      } else if (event.type === 'session.closed' && event.sessionId === sessionId) {
        setView({ kind: 'missing' });
      }
    });

    void api()
      .invoke<{ session: SessionInfo | undefined; data: string }>('session_read_output', { sessionId })
      .then((result) => {
        if (!live) return;
        replayed = true;
        if (!result.ok || !result.value.session) {
          setView({ kind: 'missing' });
          return;
        }
        term.write(result.value.data);
        setView({ kind: 'ready', status: result.value.session.status });
        refit();
        if (result.value.session.status !== 'exited') sendSize();
        term.focus();
      });

    return () => {
      live = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      unsubscribe();
      input.dispose();
      resized.dispose();
      term.dispose();
      terminal.current = null;
    };
  }, [sessionId]);

  const resume = () => {
    terminal.current?.write('\r\n');
    void api().invoke('session_resume', { sessionId });
  };

  return (
    <div className="terminal-pane" data-testid="terminal-pane" onClick={() => terminal.current?.focus()}>
      <div className="terminal-bar">
        <span className="terminal-status" data-testid="terminal-status" data-status={view.kind === 'ready' ? view.status : view.kind}>
          {view.kind === 'ready' ? view.status : view.kind === 'missing' ? 'session not found' : 'loading'}
        </span>
        {view.kind === 'ready' && view.status === 'exited' && (
          <button type="button" onClick={resume}>
            Resume
          </button>
        )}
      </div>
      <div className="terminal-host" ref={host} data-testid="terminal-host" />
    </div>
  );
}
