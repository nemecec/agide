import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { TreeNode } from '../../core/tree/types';
import { api } from '../api';
import { ApprovalBar } from './browser/ApprovalBar';
import { placementRequest, splitUrl } from './browser/model';
import { ObservationControl } from './browser/ObservationControl';
import { installDragSuspension, useStill } from './browser/suspension';
import { useBrowserTab } from './browser/useBrowserTab';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Hint } from '../ui/Hint';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { ACTION_ICONS, CONTROL_ICONS, SURFACE_ICONS } from '../ui/icons';
import { Menu } from '../ui/Menu';
import { Notice } from '../ui/Notice';
import { Toolbar, ToolbarItem } from '../ui/Toolbar';
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
  const still = useStill(leafId);
  const known = state?.known === true;
  useDragSuspension();

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
      <Notice className="browser-placeholder" tone="danger" data-testid="browser-forged" data-surface={node.surfaceId}>
        {node.title}: this leaf is not a browser tab of this app, so it has no page, no tools and no observation.
      </Notice>
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
      <Toolbar className="browser-chrome" data-testid="browser-chrome" aria-label="Browser">
        <ToolbarItem asChild>
          <IconButton label={ACTION_ICONS.back.label} icon={ACTION_ICONS.back.icon} suspendViews disabled={!state.canGoBack} onClick={() => nav('back')} />
        </ToolbarItem>
        <ToolbarItem asChild>
          <IconButton label={ACTION_ICONS.forward.label} icon={ACTION_ICONS.forward.icon} suspendViews disabled={!state.canGoForward} onClick={() => nav('forward')} />
        </ToolbarItem>
        <ToolbarItem asChild>
          <IconButton
            label={state.loading ? ACTION_ICONS.stop.label : ACTION_ICONS.reload.label}
            icon={state.loading ? ACTION_ICONS.stop.icon : ACTION_ICONS.reload.icon}
            suspendViews
            onClick={() => nav(state.loading ? 'stop' : 'reload')}
          />
        </ToolbarItem>
        <div className="address-field" data-editing={editing || undefined}>
          <Chip className="service-badge" icon={SURFACE_ICONS['browser-tab'].icon} label={state.service} data-testid="service-badge" />
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
        </div>
        {error !== undefined && (
          <span className="address-error" role="alert">
            <Icon icon={CONTROL_ICONS.invalid} size="xs" />
            {error}
          </span>
        )}
        <ObservationControl leafId={leafId} mode={state.mode} reading={reading} forcedOff={state.blocked} />
        <IconButton
          label={ACTION_ICONS['open-in-chrome'].label}
          icon={ACTION_ICONS['open-in-chrome'].icon}
          suspendViews
          disabled={state.url === 'about:blank'}
          onClick={() => void api().invoke('browser_open_in_chrome', { nodeId: leafId })}
        />
        <Menu
          trigger={<IconButton label="Tab menu" icon={ACTION_ICONS.more.icon} suspendViews />}
          entries={[
            { label: 'Copy URL', icon: ACTION_ICONS.copy.icon, run: () => void navigator.clipboard.writeText(state.url) },
            { label: 'DevTools', icon: ACTION_ICONS.devtools.icon, run: () => void api().invoke('browser_devtools', { leafId }) },
            {
              label: 'Clear this service\'s site data…',
              danger: true,
              icon: ACTION_ICONS.remove.icon,
              run: () => {
                if (window.confirm(`Clear cookies and site data of ${state.service}?`)) void api().invoke('browser_clear_site_data', { leafId });
              },
            },
          ]}
        />
      </Toolbar>
      {approval !== undefined && <ApprovalBar approval={approval} onAnswered={refresh} />}
      {state.acting && (
        <Banner
          tone="warning"
          icon={SURFACE_ICONS.agent.icon}
          data-testid="acting-banner"
          message="An agent is acting in this tab."
          actions={
            <Button size="sm" onClick={() => void api().invoke('browser_stop_agent', { leafId }).then(refresh)}>
              Stop agent
            </Button>
          }
        />
      )}
      {state.crashed && (
        <Banner
          tone="danger"
          message="The page crashed."
          actions={
            <Button size="sm" onClick={() => nav('reload')}>
              Reload
            </Button>
          }
        />
      )}
      {state.dialog && <Banner tone="warning" message="The page shows a dialog that the user must answer." />}
      <div className="browser-frame" data-testid="browser-frame" data-agent-driven={state.acting || approval !== undefined || undefined}>
        <div ref={slot} className="browser-slot" data-testid="browser-slot" data-browser-slot={leafId}>
          {still?.dataUrl !== undefined && <img className="browser-still" alt="" src={still.dataUrl} />}
          {still !== undefined && still.dataUrl === undefined && (
            <div className="browser-still browser-still-fallback" data-testid="browser-still-fallback">
              <Hint>The page is hidden while panes are rearranged.</Hint>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
