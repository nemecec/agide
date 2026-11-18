import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { TreeNode } from '../../core/tree/types';
import { api } from '../api';
import { ApprovalBar } from './browser/ApprovalBar';
import { placementRequest, splitUrl } from './browser/model';
import { ObservationControl } from './browser/ObservationControl';
import { installDragSuspension, useStill, useViewSuspension } from './browser/suspension';
import { useBrowserTab } from './browser/useBrowserTab';
import './browser/browser.css';

let dragListeners = 0;
let removeDragListeners: (() => void) | undefined;

/** Installs the drag suspension while at least one browser pane is mounted. */
function useDragSuspension(): void {
  useEffect(() => {
    if (dragListeners++ === 0) removeDragListeners = installDragSuspension();
    return () => {
      if (--dragListeners === 0) {
        removeDragListeners?.();
        removeDragListeners = undefined;
      }
    };
  }, []);
}

/**
 * The `browser-tab` surface (0026 section 1): tab chrome (back, forward, reload or stop, address field, service
 * badge, observation control, Open in Chrome, menu) above a slot whose rectangle goes to `browser_view_place`.
 * The page view never covers the chrome, so a page cannot draw over the address or the permission request.
 */
export function BrowserPane({ node }: { readonly node: TreeNode & { readonly kind: 'leaf' } }) {
  const leafId = node.id;
  const { state, reading, refresh } = useBrowserTab({ leafId });
  const slot = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [menu, setMenu] = useState(false);
  const still = useStill(leafId);
  const known = state?.known === true;
  useDragSuspension();
  useViewSuspension(menu);

  useEffect(() => {
    const element = slot.current;
    if (!element || !known) return;
    let frame = 0;
    let last: string | undefined;
    const report = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const request = placementRequest(element.getBoundingClientRect(), last);
        if (request === undefined) return;
        last = request.key;
        void api().invoke('browser_view_place', { leafId, bounds: request.bounds, visible: request.visible });
      });
    };
    const observer = new ResizeObserver(report);
    observer.observe(element);
    window.addEventListener('resize', report);
    const poll = setInterval(report, 500);
    report();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', report);
      clearInterval(poll);
      cancelAnimationFrame(frame);
      void api().invoke('browser_view_place', { leafId, bounds: { x: 0, y: 0, width: 0, height: 0 }, visible: false });
    };
  }, [known, leafId]);

  if (state === undefined) return <div className="browser-pane" data-testid="browser-pane" data-surface={node.surfaceId} />;
  if (!state.known) {
    return (
      <div className="browser-placeholder" role="alert" data-testid="browser-forged" data-surface={node.surfaceId}>
        {node.title}: this leaf is not a browser tab of this app, so it has no page, no tools and no observation.
      </div>
    );
  }

  const nav = (action: 'back' | 'forward' | 'reload' | 'stop'): void => void api().invoke('browser_nav', { leafId, action }).then(refresh);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void api()
      .invoke('browser_nav', { leafId, action: 'go', address })
      .then((result) => {
        if (result.ok) {
          setError(undefined);
          setEditing(false);
          refresh();
        } else setError(result.error.message);
      });
  };
  const parts = splitUrl(state.url);
  const approval = state.approvals[0];

  return (
    <div className="browser-pane" data-testid="browser-pane" data-surface={node.surfaceId} data-tab={state.tabNumber} data-service={state.service}>
      <div className="browser-chrome" data-testid="browser-chrome">
        <button type="button" className="chrome-button" aria-label="Back" disabled={!state.canGoBack} onClick={() => nav('back')}>
          &larr;
        </button>
        <button type="button" className="chrome-button" aria-label="Forward" disabled={!state.canGoForward} onClick={() => nav('forward')}>
          &rarr;
        </button>
        <button type="button" className="chrome-button" aria-label={state.loading ? 'Stop' : 'Reload'} onClick={() => nav(state.loading ? 'stop' : 'reload')}>
          {state.loading ? '✕' : '↻'}
        </button>
        <span className="service-badge" data-testid="service-badge">
          {state.service}
        </span>
        {editing ? (
          <form className="address-form" onSubmit={submit}>
            <input
              aria-label="Address"
              data-testid="address-input"
              autoFocus
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setEditing(false);
              }}
              onBlur={() => setEditing(false)}
            />
          </form>
        ) : (
          <div
            className="address-display"
            role="textbox"
            aria-label="Address"
            tabIndex={0}
            data-testid="address-display"
            title={state.url}
            onClick={() => {
              setAddress(state.url === 'about:blank' ? '' : state.url);
              setEditing(true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                setAddress(state.url === 'about:blank' ? '' : state.url);
                setEditing(true);
              }
            }}
          >
            {state.url === 'about:blank' ? (
              <span className="dim">Enter an address</span>
            ) : (
              <>
                <span className="dim">{parts.before}</span>
                <span className="host">{parts.host}</span>
                <span className="dim">{parts.after}</span>
              </>
            )}
          </div>
        )}
        {error !== undefined && (
          <span className="address-error" role="alert">
            {error}
          </span>
        )}
        <ObservationControl leafId={leafId} mode={state.mode} reading={reading} forcedOff={state.blocked} />
        <button type="button" className="chrome-button" onClick={() => void api().invoke('browser_open_in_chrome', { nodeId: leafId })} disabled={state.url === 'about:blank'}>
          Open in Chrome
        </button>
        <button type="button" className="chrome-button" aria-label="Tab menu" aria-haspopup="menu" onClick={() => setMenu((open) => !open)}>
          &hellip;
        </button>
        {menu && (
          <div className="browser-menu" role="menu">
            <button type="button" role="menuitem" className="chrome-button" onClick={() => void navigator.clipboard.writeText(state.url).finally(() => setMenu(false))}>
              Copy URL
            </button>
            <button
              type="button"
              role="menuitem"
              className="chrome-button"
              onClick={() => {
                setMenu(false);
                if (window.confirm(`Clear cookies and site data of ${state.service}?`)) void api().invoke('browser_clear_site_data', { leafId });
              }}
            >
              Clear this service&apos;s site data
            </button>
            <button type="button" role="menuitem" className="chrome-button" onClick={() => void api().invoke('browser_devtools', { leafId }).then(() => setMenu(false))}>
              DevTools
            </button>
          </div>
        )}
      </div>
      {approval !== undefined && <ApprovalBar approval={approval} onAnswered={refresh} />}
      {state.acting && (
        <div className="browser-banner" data-testid="acting-banner">
          An agent is acting in this tab.
          <button type="button" onClick={() => void api().invoke('browser_stop_agent', { leafId }).then(refresh)}>
            Stop agent
          </button>
        </div>
      )}
      {state.crashed && (
        <div className="browser-banner" role="alert">
          The page crashed.
          <button type="button" onClick={() => nav('reload')}>
            Reload
          </button>
        </div>
      )}
      {state.dialog && (
        <div className="browser-banner" role="alert">
          The page shows a dialog that the user must answer.
        </div>
      )}
      <div ref={slot} className={`browser-slot${state.acting ? ' acting' : ''}`} data-testid="browser-slot" data-browser-slot={leafId}>
        {still?.dataUrl !== undefined && <img className="browser-still" alt="" src={still.dataUrl} />}
      </div>
    </div>
  );
}
