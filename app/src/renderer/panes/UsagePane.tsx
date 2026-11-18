import { HeatMarker } from './agents/HeatMarker';
import { formatCost, formatDuration, planLine } from './agents/format';
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
        <p className="transcript-status">Loading usage</p>
      </section>
    );
  }
  const now = Date.parse(usage.now);
  const rows = usage.ranking.filter((row) => folderId === undefined || row.folderId === folderId);
  return (
    <section className="agents-pane usage-pane" data-testid="usage-pane" data-instance={instanceId} aria-label="Usage">
      <header className="usage-head">
        <p data-testid="profile-rate" title={`estimated over the last ${usage.windowMinutes} minutes, list price`}>
          Profile: {usage.profileCostUsdPerMinute === undefined ? `${Math.round(usage.profileWeightedTokensPerMinute)} weighted tok/min` : `${formatCost(usage.profileCostUsdPerMinute)}/min`}
        </p>
        <p data-testid="app-started-count" title="agents started by the app, against the cap">
          App-started: {usage.appStarted.running} of {usage.appStarted.cap}
        </p>
        <ul className="usage-plan" aria-label="Plan usage">
          {usage.plan.length === 0 ? <li>no plan data</li> : usage.plan.map((window) => <li key={window.window}>{planLine(window, now)}</li>)}
        </ul>
        <p className="usage-note">All dollar figures are estimates at list price, not billed amounts. Rates are estimated over the last {usage.windowMinutes} minutes.</p>
      </header>
      <ol className="usage-ranking" data-testid="usage-ranking">
        {rows.map((row) => {
          const key = row.subject.kind === 'session' ? `session:${row.subject.sessionId}` : `agent:${row.subject.ref.sessionId}:${row.subject.ref.agentKey}`;
          const heat = usage.heat[key];
          return (
            <li key={key} data-testid="usage-row" data-subject={key} data-kind={row.subject.kind}>
              <span className="usage-label">{row.label ?? key}</span>
              <span className="usage-rate" title="estimated cost per minute">
                {formatCost(row.costUsdPerMinute)}/min
              </span>
              <span className="usage-tokens">{Math.round(row.weightedTokensPerMinute)} tok/min</span>
              <span className="usage-share">{Math.round(row.share * 100)}%</span>
              <span className="usage-elapsed">{formatDuration(row.elapsedSeconds)}</span>
              {heat ? <HeatMarker level={heat.level} costUsdPerMinute={heat.costUsdPerMinute} share={heat.share} windowMinutes={usage.windowMinutes} /> : null}
            </li>
          );
        })}
      </ol>
      {rows.length === 0 ? <p className="transcript-status">No activity in the window.</p> : null}
    </section>
  );
}
