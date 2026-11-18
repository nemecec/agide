import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITheme } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';
import type { SessionInfo } from '../../../core/session/types';
import { api } from '../../api';

const DARK: ITheme = { background: '#1e1e1e', foreground: '#e5e5e7' };
const LIGHT: ITheme = { background: '#ffffff', foreground: '#1d1d1f' };

/**
 * A read-only view of a session's terminal beside the message card. It never takes keyboard focus, sends no
 * input and never resizes the session's process; it only redraws the recorded output and follows new output.
 * While it is shown the session counts as viewed.
 */
export function SessionPeek({ sessionId, onBack }: { sessionId: string; onBack: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<string>('loading');

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const term = new Terminal({
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 12,
      disableStdin: true,
      cursorBlink: false,
      cursorInactiveStyle: 'none',
      scrollback: 2000,
      theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? DARK : LIGHT,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element);
    term.textarea?.setAttribute('tabindex', '-1');
    let live = true;
    let replayed = false;
    const refit = () => {
      if (element.clientWidth > 0 && element.clientHeight > 0) fit.fit();
    };
    const observer = new ResizeObserver(refit);
    observer.observe(element);

    const off = api().subscribe((event) => {
      if (event.type === 'session.output' && event.sessionId === sessionId) {
        if (replayed) term.write(event.data);
      } else if (event.type === 'session.status_changed' && event.session.id === sessionId) setStatus(event.session.status);
      else if (event.type === 'session.closed' && event.sessionId === sessionId) setStatus('closed');
    });
    void api()
      .invoke<{ session: SessionInfo | undefined; data: string }>('session_read_output', { sessionId })
      .then((result) => {
        if (!live) return;
        replayed = true;
        if (!result.ok || !result.value.session) {
          setStatus('closed');
          return;
        }
        term.write(result.value.data);
        setStatus(result.value.session.status);
        refit();
      });
    void api().invoke('inbox_set_viewing', { sessionId });

    return () => {
      live = false;
      observer.disconnect();
      off();
      term.dispose();
      void api().invoke('inbox_set_viewing', {});
    };
  }, [sessionId]);

  return (
    <aside className="inbox-peek" data-testid="inbox-peek" aria-label="Session peek" onKeyDown={(event) => event.key === 'Escape' && onBack()}>
      <div className="inbox-peek-bar">
        <button type="button" onClick={onBack} data-testid="inbox-peek-back">
          Back to message
        </button>
        <span className="inbox-peek-status chip" data-tone={status === 'busy' ? 'busy' : status === 'waiting' ? 'waiting' : 'idle'} data-testid="inbox-peek-status" data-status={status}>
          {status === 'closed' ? 'session not found' : status}
        </span>
        <span className="inbox-peek-note">read only</span>
      </div>
      <div className="inbox-peek-host" ref={host} data-testid="inbox-peek-host" />
    </aside>
  );
}
