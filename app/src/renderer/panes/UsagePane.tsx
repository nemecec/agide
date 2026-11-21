import { HeatMarker } from './agents/HeatMarker';
import { EmptyState } from '../ui/EmptyState';
import { Hint } from '../ui/Hint';
import { PANE_ICONS } from '../ui/icons';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/Table';
import { formatCost, formatCount, formatDuration, planLine } from './agents/format';
import { useUsageState } from './agents/useAgents';
import type { PaneProps } from './paneTypes';
import './agents/agents.css';

/**
 * `agide/usage-ranking` (0027 section 9): sessions and agents with the highest cost rate, the profile rate, the
 * app-started count and the plan windows. A `folderId` in the config limits the list to that folder. Dollar
 * figures are estimates at list price; under a subscription they are list-price equivalents, not billed.
 */
export function UsagePane({ instanceId, config }: PaneProps) {
  const usage = useUsageState();
  const folderId = typeof config['folderId'] === 'string' ? config['folderId'] : undefined;
  if (!usage) {
    return (
      <section className="agents-pane" data-testid="usage-pane" data-instance={instanceId} aria-label="Usage">
        <Hint>Loading usage</Hint>
      </section>
    );
  }
  const now = Date.parse(usage.now);
  const rows = usage.ranking.filter((row) => folderId === undefined || row.folderId === folderId);
  return (
    <section className="agents-pane usage-pane" data-testid="usage-pane" data-instance={instanceId} aria-label="Usage">
      <header className="usage-head">
        <p data-testid="profile-rate" title={`estimated over the last ${usage.windowMinutes} minutes, list price`}>
          Profile: {usage.profileCostUsdPerMinute === undefined ? `${formatCount(usage.profileWeightedTokensPerMinute)} weighted tok/min` : `${formatCost(usage.profileCostUsdPerMinute)}/min`}
        </p>
        <p data-testid="app-started-count" title="agents started by the app, against the cap">
          Started by Agide: {usage.appStarted.running} of {usage.appStarted.cap} allowed
        </p>
        <ul className="usage-plan" aria-label="Plan usage">
          {usage.plan.length === 0 ? <li>No plan data</li> : usage.plan.map((window) => <li key={window.window}>{planLine(window, now)}</li>)}
        </ul>
        <Hint className="usage-note">All dollar figures are estimates at list price, not billed amounts. Rates are estimated over the last {usage.windowMinutes} minutes.</Hint>
      </header>
      {rows.length === 0 ? (
        <EmptyState className="usage-empty" icon={PANE_ICONS.usage.icon} title="No activity in the window" help="Sessions and agents appear here while they use tokens." data-testid="usage-empty" />
      ) : (
        <Table className="usage-table" data-testid="usage-ranking" aria-label="Usage ranking">
          <TableHead>
            <tr>
              <TableHeader>Session or agent</TableHeader>
              <TableHeader numeric>Cost</TableHeader>
              <TableHeader numeric>Tokens</TableHeader>
              <TableHeader numeric>Share</TableHeader>
              <TableHeader numeric>Running</TableHeader>
              <TableHeader>Level</TableHeader>
            </tr>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const key = row.subject.kind === 'session' ? `session:${row.subject.sessionId}` : `agent:${row.subject.ref.sessionId}:${row.subject.ref.agentKey}`;
              const heat = usage.heat[key];
              return (
                <TableRow key={key} data-testid="usage-row" data-subject={key} data-kind={row.subject.kind}>
                  <TableCell className="usage-label" title={row.label ?? key}>
                    {row.label ?? key}
                  </TableCell>
                  <TableCell numeric title="estimated cost per minute">
                    {formatCost(row.costUsdPerMinute)}/min
                  </TableCell>
                  <TableCell numeric>{formatCount(row.weightedTokensPerMinute)} tok/min</TableCell>
                  <TableCell numeric>{Math.round(row.share * 100)}%</TableCell>
                  <TableCell numeric>{formatDuration(row.elapsedSeconds)}</TableCell>
                  <TableCell>{heat ? <HeatMarker level={heat.level} costUsdPerMinute={heat.costUsdPerMinute} share={heat.share} windowMinutes={usage.windowMinutes} /> : null}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
