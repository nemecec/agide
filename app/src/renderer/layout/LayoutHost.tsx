import 'dockview-react/dist/styles/dockview.css';
import { DockviewReact, type DockviewApi, type IDockviewPanelProps } from 'dockview-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type MutableRefObject } from 'react';
import type { PaneProps } from '../panes/paneTypes';
import { api } from '../api';
import { PANE_COMPONENTS } from '../panes/paneComponents';
import { PlaceholderPane } from '../panes/PlaceholderPane';
import { useTheme } from '../theme/themeContext';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Disclosure } from '../ui/Disclosure';
import { dockTheme } from './dockTheme';
import { toDockview } from './dockviewAdapter';
import { arrangementToSave, engineShows, fixedWidth, hidesHeader, resolveInputs, titleOf } from './hostModel';
import { inboxInstanceId } from './inboxInstance';
import { LayoutContext, useLayoutContext } from './LayoutContext';
import { PaneTab } from './PaneTab';
import { TitleBar } from './TitleBar';
import { useLayoutState, type LayoutViewState } from './useLayoutState';
import './dock-theme.css';
import './layout.css';

/** A pane component re-renders only when its own config or inputs change, not on every shared context update. */
const PaneComponent = memo(
  ({ Component, ...props }: PaneProps & { Component: ComponentType<PaneProps> }) => <Component {...props} />,
  (before, after) =>
    before.Component === after.Component &&
    before.instanceId === after.instanceId &&
    JSON.stringify([before.config, before.inputs]) === JSON.stringify([after.config, after.inputs]),
);

/** The body of one panel: the pane component of the instance, or a placeholder. */
function PaneBody({ params }: IDockviewPanelProps<{ instanceId: string }>) {
  const { view, context } = useLayoutContext();
  const { instanceId } = params;
  const instance = view.layout.instances[instanceId];
  const resolution = view.resolutions[instanceId];
  if (!instance) return null;

  const inputs = resolveInputs(instance.bindings, context);
  const Component = resolution?.status === 'ok' ? PANE_COMPONENTS[instance.type as keyof typeof PANE_COMPONENTS] : undefined;
  return (
    <div className="pane-frame" data-instance-id={instanceId}>
      {Component ? (
        <PaneComponent Component={Component} instanceId={instanceId} config={instance.config} inputs={inputs} />
      ) : (
        <PlaceholderPane
          type={instance.type}
          reason={resolution?.reason ?? (resolution?.status === 'ok' ? 'no renderer' : 'unknown')}
          message={resolution?.message ?? `no view for ${instance.type}`}
        />
      )}
    </div>
  );
}

const COMPONENTS = { pane: PaneBody };

/** Hides the header of edge groups such as the rail and holds fixed-width groups at their width. */
function dressEdgeGroups(engine: DockviewApi, view: LayoutViewState): void {
  for (const group of engine.groups) {
    const types = group.panels.map((panel) => view.layout.instances[panel.id]?.type ?? '');
    group.header.hidden = hidesHeader(types);
    const width = fixedWidth(types);
    if (width !== undefined) group.api.setConstraints({ minimumWidth: width, maximumWidth: width });
  }
}

function DockEngine({ view, dock }: { view: LayoutViewState; dock: MutableRefObject<DockviewApi | null> }) {
  const latest = useRef(view);
  latest.current = view;
  const loading = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const sync = useCallback(() => {
    const engine = dock.current;
    if (!engine) return;
    const current = view;
    const shown = engine.toJSON();
    if (engineShows(shown, current.layout, engine.panels)) return;
    loading.current = true;
    engine.fromJSON(toDockview(current.layout, (id) => titleOf(current.layout, id)));
    dressEdgeGroups(engine, current);
    setTimeout(() => {
      loading.current = false;
    }, 0);
  }, [view]);

  useEffect(sync, [sync]);

  const onReady = useCallback(
    (event: { api: DockviewApi }) => {
      dock.current = event.api;
      sync();
      event.api.onDidLayoutChange(() => {
        if (loading.current) return;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          const current = latest.current;
          const arrangement = arrangementToSave(event.api.toJSON(), current.layout);
          if (!arrangement) return;
          void api().invoke('layout_apply', {
            layoutId: current.layoutId,
            expectedRevision: current.revision,
            patch: [{ op: 'replace', path: '/arrangement', value: arrangement }],
          });
        }, 300);
      });
    },
    [sync],
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  const { resolved } = useTheme();

  return (
    <DockviewReact
      className="dock"
      components={COMPONENTS}
      defaultTabComponent={PaneTab}
      onReady={onReady}
      theme={dockTheme(resolved.scheme)}
      disableFloatingGroups
    />
  );
}

function Notices({ view }: { view: LayoutViewState }) {
  const [dismissed, setDismissed] = useState(0);
  const [errorHidden, setErrorHidden] = useState(false);
  const issueKey = JSON.stringify(view.fileIssues);
  useEffect(() => setErrorHidden(false), [issueKey]);
  const change = view.lastChange;
  const showChange = change !== undefined && (change.source === 'mcp' || change.source === 'file') && change.revision > dismissed;
  return (
    <>
      {view.fileIssues.length > 0 && !errorHidden && (
        <Banner
          className="layout-notice"
          tone="danger"
          data-testid="layout-error"
          message={
            <>
              <strong>The layout file is invalid. The previous layout stays and the file is untouched.</strong>
              <Disclosure label="Show what is wrong">
                <ul>
                  {view.fileIssues.map((issue, index) => (
                    <li key={index}>
                      <code>{issue.path || '/'}</code> {issue.message}
                    </li>
                  ))}
                </ul>
              </Disclosure>
            </>
          }
          actions={
            <Button size="sm" data-testid="layout-error-dismiss" onClick={() => setErrorHidden(true)}>
              Dismiss
            </Button>
          }
        />
      )}
      {showChange && (
        <Banner
          className="layout-notice"
          tone="info"
          data-testid="layout-change"
          message={
            <>
              <strong>{change.source === 'mcp' ? 'An agent changed the layout' : 'The layout file changed'}</strong>
              <ul>
                {change.summary.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            </>
          }
          actions={
            <>
              <Button size="sm" onClick={() => void api().invoke('layout_undo', {})}>
                Undo
              </Button>
              <Button size="sm" variant="quiet" onClick={() => setDismissed(change.revision)}>
                Dismiss
              </Button>
            </>
          }
        />
      )}
    </>
  );
}

/** The window: the title bar, notices and the layout engine that shows the panes of the active layout. */
export function LayoutHost() {
  const { view, context } = useLayoutState();
  const value = useMemo(() => (view ? { view, context } : undefined), [view, context]);
  const dock = useRef<DockviewApi | null>(null);
  if (!value) return <div className="layout-host" />;
  const inbox = inboxInstanceId(value.view.layout);
  const showInbox = inbox === undefined ? undefined : () => dock.current?.getPanel(inbox)?.api.setActive();
  return (
    <LayoutContext.Provider value={value}>
      <div className="layout-host" data-layout-id={value.view.layoutId} data-revision={value.view.revision}>
        <TitleBar view={value.view} onShowInbox={showInbox} />
        <Notices view={value.view} />
        <div className="dock-wrap">
          <DockEngine view={value.view} dock={dock} />
        </div>
      </div>
    </LayoutContext.Provider>
  );
}
