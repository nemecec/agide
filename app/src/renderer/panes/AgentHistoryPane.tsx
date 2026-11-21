import { useMemo, useState } from 'react';
import { historyOf, type HistoryFilter } from '../../core/agents/view';
import { api } from '../api';
import { setAgentsView, useAgentsView } from './agents/agentsStore';
import { elapsedSeconds, formatCost, formatDuration, formatTokens, outcomeText, totalTokens } from './agents/format';
import { TranscriptView } from './agents/TranscriptView';
import { useAgents } from './agents/useAgents';
import { Checkbox } from '../ui/Checkbox';
import { EmptyState } from '../ui/EmptyState';
import { Icon } from '../ui/Icon';
import { PANE_ICONS, STATUS_ICONS } from '../ui/icons';
import { Select } from '../ui/Select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/Table';
import type { PaneProps } from './paneTypes';
import './agents/agents.css';

type StateFilter = 'all' | 'done' | 'failed';
type OriginFilter = 'all' | 'session-started' | 'app-started';
const RANGES = { all: 0, hour: 3_600_000, day: 86_400_000 } as const;

/**
 * `agide/agent-history` (0027 section 4): finished agents with filters for state, origin, folder scope and time
 * range, and the removal delay setting. A row opens its transcript below the list, read-only.
 */
export function AgentHistoryPane({ instanceId, config }: PaneProps) {
  const { agents, settings, now, reload } = useAgents();
  const { selected, showFinished } = useAgentsView();
  const [state, setState] = useState<StateFilter>('all');
  const [origin, setOrigin] = useState<OriginFilter>('all');
  const [range, setRange] = useState<keyof typeof RANGES>('all');
  const [text, setText] = useState('');
  const folderId = typeof config['folderId'] === 'string' ? config['folderId'] : undefined;

  const rows = useMemo(() => {
    const filter: HistoryFilter = {
      ...(state === 'all' ? {} : { states: [state] }),
      ...(origin === 'all' ? {} : { origin }),
      ...(folderId === undefined ? {} : { folderIds: [folderId] }),
      ...(range === 'all' ? {} : { endedSince: new Date(now - RANGES[range]).toISOString() }),
      ...(text ? { text } : {}),
    };
    return historyOf(agents, filter);
  }, [agents, state, origin, folderId, range, text, now]);

  const saveDelay = (key: 'removeDoneAfterSeconds' | 'removeFailedAfterSeconds', value: string): void => {
    const seconds = Number(value);
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 3600) return;
    void api()
      .invoke('agents_settings_set', { [key]: seconds })
      .then(reload);
  };

  return (
    <section className="agents-pane agent-history" data-testid="agent-history-pane" data-instance={instanceId} aria-label="Agent history">
      <div className="history-filters" role="group" aria-label="Filters">
        <label className="history-filter">
          <span>State</span>
          <Select
            data-testid="history-state"
            aria-label="State"
            value={state}
            onValueChange={(value) => setState(value as StateFilter)}
            options={[
              { value: 'all', label: 'All' },
              { value: 'done', label: 'Done' },
              { value: 'failed', label: 'Failed' },
            ]}
          />
        </label>
        <label className="history-filter">
          <span>Origin</span>
          <Select
            data-testid="history-origin"
            aria-label="Origin"
            value={origin}
            onValueChange={(value) => setOrigin(value as OriginFilter)}
            options={[
              { value: 'all', label: 'All' },
              { value: 'session-started', label: 'Started by a session' },
              { value: 'app-started', label: 'Started by Agide' },
            ]}
          />
        </label>
        <label className="history-filter">
          <span>Time</span>
          <Select
            data-testid="history-range"
            aria-label="Time"
            value={range}
            onValueChange={(value) => setRange(value as keyof typeof RANGES)}
            options={[
              { value: 'all', label: 'All time' },
              { value: 'hour', label: 'Last hour' },
              { value: 'day', label: 'Last day' },
            ]}
          />
        </label>
        <input className="ui-input history-search" type="search" placeholder="Search" aria-label="Search finished agents" value={text} onChange={(event) => setText(event.target.value)} />
        <Checkbox data-testid="show-finished" checked={showFinished} onCheckedChange={(checked) => setAgentsView({ showFinished: checked })} label="Show finished agents in the tree" />
      </div>
      <div className="history-settings">
        <label className="history-filter">
          <span>Remove done agents from the tree after (s)</span>
          <input className="ui-input history-seconds" type="number" min={0} max={3600} defaultValue={settings.removeDoneAfterSeconds} key={`done-${settings.removeDoneAfterSeconds}`} data-testid="remove-done-after" onBlur={(event) => saveDelay('removeDoneAfterSeconds', event.target.value)} />
        </label>
        <label className="history-filter">
          <span>failed (s)</span>
          <input className="ui-input history-seconds" type="number" min={0} max={3600} defaultValue={settings.removeFailedAfterSeconds} key={`failed-${settings.removeFailedAfterSeconds}`} data-testid="remove-failed-after" onBlur={(event) => saveDelay('removeFailedAfterSeconds', event.target.value)} />
        </label>
      </div>
      {rows.length === 0 ? (
        <EmptyState className="history-empty" icon={PANE_ICONS['agent-history'].icon} title="No finished agents match" help="Finished agents appear here after the removal delay." data-testid="history-empty" />
      ) : (
        <Table className="history-table" data-testid="history-table" aria-label="Finished agents">
          <TableHead>
            <tr>
              <TableHeader>Agent</TableHeader>
              <TableHeader>State</TableHeader>
              <TableHeader numeric>Started</TableHeader>
              <TableHeader numeric>Duration</TableHeader>
              <TableHeader numeric>Tokens</TableHeader>
              <TableHeader numeric title="estimated from tokens, list price">
                Cost (estimate)
              </TableHeader>
            </tr>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const chosen = selected?.sessionId === row.sessionId && selected.agentKey === row.agentKey;
              const open = (): void => setAgentsView({ selected: { sessionId: row.sessionId, agentKey: row.agentKey } });
              const status = row.state === 'failed' ? STATUS_ICONS.failed : STATUS_ICONS.done;
              return (
                <TableRow key={`${row.sessionId}:${row.agentKey}`} data-testid="history-row" data-state={row.state} selected={chosen} tabIndex={0} onClick={open} onKeyDown={(event) => event.key === 'Enter' && open()}>
                  <TableCell title={row.description ?? row.label}>{row.label}</TableCell>
                  <TableCell>
                    <span className="history-state" data-state={row.state}>
                      <Icon icon={status.icon} size="sm" />
                      {outcomeText(row)}
                    </span>
                  </TableCell>
                  <TableCell numeric>{new Date(row.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</TableCell>
                  <TableCell numeric>{formatDuration(elapsedSeconds(row, now))}</TableCell>
                  <TableCell numeric>{formatTokens(totalTokens(row.tokens))}</TableCell>
                  <TableCell numeric>{formatCost(row.costUsd)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {selected ? (
        <div className="history-transcript">
          <TranscriptView sessionId={selected.sessionId} agentKey={selected.agentKey} />
        </div>
      ) : null}
    </section>
  );
}
