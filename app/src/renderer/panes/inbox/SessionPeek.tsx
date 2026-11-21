import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';
import type { SessionInfo } from '../../../core/session/types';
import { api } from '../../api';
import { currentTerminalOptions, followTheme } from '../../theme/terminalOptions';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { ACTION_ICONS, STATUS_ICONS, STATUS_TONES } from '../../ui/icons';
import { sessionStatusKind } from '../sessionStatus';

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
      ...currentTerminalOptions(false),
      fontSize: 12,
      disableStdin: true,
      cursorBlink: false,
      cursorInactiveStyle: 'none',
      scrollback: 2000,
    });
    const stopTheme = followTheme(term, false);
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
      stopTheme();
      term.dispose();
      void api().invoke('inbox_set_viewing', {});
    };
  }, [sessionId]);

  const kind = sessionStatusKind(status);
  return (
    <aside className="inbox-peek" data-testid="inbox-peek" aria-label="Session peek" onKeyDown={(event) => event.key === 'Escape' && onBack()}>
      <div className="inbox-peek-bar">
        <Button variant="quiet" size="sm" icon={ACTION_ICONS.back.icon} onClick={onBack} data-testid="inbox-peek-back">
          Back to message
        </Button>
        <Chip
          tone={STATUS_TONES[kind]}
          icon={STATUS_ICONS[kind].icon}
          spin={kind === 'busy'}
          label={status === 'closed' ? 'session not found' : status}
          data-testid="inbox-peek-status"
          data-status={status}
        />
        <Chip icon={ACTION_ICONS['permission-mode'].icon} label="read only" />
      </div>
      <div className="inbox-peek-host" ref={host} data-testid="inbox-peek-host" />
    </aside>
  );
}
