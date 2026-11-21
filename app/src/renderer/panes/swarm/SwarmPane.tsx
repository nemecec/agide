import { useEffect, useState, type ReactNode } from 'react';
import type { AgentResult, SwarmAgentStatus, SwarmResults, SwarmStatus } from '../../../core/swarm/types';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { StatusChip } from '../../ui/Chip';
import { EmptyState } from '../../ui/EmptyState';
import { IconButton } from '../../ui/IconButton';
import { ACTION_ICONS, PANE_ICONS } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { Tab, TabList, TabPanel, Tabs } from '../../ui/Tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/Table';
import { Toolbar, ToolbarItem } from '../../ui/Toolbar';
import type { PaneProps } from '../paneTypes';
import { BudgetMeter } from './BudgetMeter';
import { interruptAgent, pauseSwarm, resumeSwarm } from './swarmActions';
import { openSwarmDialog } from './swarmDialogStore';
import { RUN_STATUS, RUN_WORDS, SWARM_STATUS, SWARM_WORDS, agentControls, agentDetail, agentSpendText, endReasonText, groupControls, numstatSummary, resultWarnings, tally, tallyText } from './swarmModel';
import { fetchResults, useSwarmById } from './useSwarms';
import './swarm.css';

/**
 * `agide/swarm` (0037 section 10): the goal, the swarm's state, the budget meter, the group controls, a Banner for
 * a paused or stopped swarm, and the Agents and Results tabs. Every string an agent wrote renders as plain text.
 */
export function SwarmPane({ instanceId, config }: PaneProps) {
  const swarmId = typeof config['swarmId'] === 'string' ? config['swarmId'] : '';
  const { swarm, loaded } = useSwarmById(swarmId);
  const shell = (children: ReactNode) => (
    <section className="swarm-pane" data-testid="swarm-pane" data-instance={instanceId} data-swarm={swarmId} aria-label="Swarm">
      {children}
    </section>
  );
  if (swarmId === '') return shell(<EmptyState icon={PANE_ICONS.swarm.icon} title="No swarm selected" help="Open a swarm from its folder in the tree." />);
  if (swarm === undefined) {
    return shell(
      loaded ? (
        <EmptyState icon={PANE_ICONS.swarm.icon} title="This swarm is no longer listed" help="It may have been removed. Start a new one from the tree." data-testid="swarm-missing" />
      ) : (
        <EmptyState icon={PANE_ICONS.swarm.icon} title="Loading the swarm…" data-testid="swarm-loading" />
      ),
    );
  }
  return shell(<SwarmView swarm={swarm} />);
}

function SwarmView({ swarm }: { readonly swarm: SwarmStatus }) {
  const controls = groupControls(swarm.state);
  const counts = tally(swarm.agents);
  const minutes = Math.floor(swarm.budget.wallClockMs / 60_000);
  const limit = Math.round(swarm.budget.wallClockLimitMs / 60_000);
  const [failure, setFailure] = useState<string | undefined>();
  const run = async (action: Promise<string | undefined>): Promise<void> => setFailure(await action);
  return (
    <>
      <header className="swarm-header">
        <h2 className="swarm-goal" data-testid="swarm-goal">
          {swarm.goal}
        </h2>
        <div className="swarm-meta">
          <StatusChip status={SWARM_STATUS[swarm.state]} label={SWARM_WORDS[swarm.state]} data-testid="swarm-state" />
          <span data-testid="swarm-tally">{tallyText(counts)}</span>
          <BudgetMeter budget={swarm.budget} />
          <span data-testid="swarm-clock" title="running time of the swarm against its limit">
            {minutes} of {limit} minutes
          </span>
        </div>
        <Toolbar aria-label="Swarm controls" className="swarm-toolbar">
          <ToolbarItem asChild>
            <Button icon={ACTION_ICONS.pause.icon} size="sm" disabled={!controls.pause} data-testid="swarm-pause" onClick={() => void run(pauseSwarm(swarm.id))}>
              Pause
            </Button>
          </ToolbarItem>
          <ToolbarItem asChild>
            <Button icon={ACTION_ICONS.resume.icon} size="sm" disabled={!controls.resume} data-testid="swarm-resume" onClick={() => void run(resumeSwarm(swarm.id))}>
              Resume
            </Button>
          </ToolbarItem>
          <ToolbarItem asChild>
            <Button variant="danger" icon={ACTION_ICONS.stop.icon} size="sm" disabled={!controls.stop} data-testid="swarm-stop" onClick={() => openSwarmDialog({ kind: 'stop-swarm', swarmId: swarm.id })}>
              Stop
            </Button>
          </ToolbarItem>
          <ToolbarItem asChild>
            <Button size="sm" data-testid="swarm-show-definition" onClick={() => openSwarmDialog({ kind: 'definition', swarmId: swarm.id })}>
              Show definition
            </Button>
          </ToolbarItem>
        </Toolbar>
      </header>
      {swarm.state === 'paused' && (
        <Banner
          tone="info"
          icon={ACTION_ICONS.pause.icon}
          message="The swarm is paused. No agent starts and no message is sent until you resume."
          actions={
            <Button size="sm" variant="primary" data-testid="swarm-banner-resume" onClick={() => void run(resumeSwarm(swarm.id))}>
              Resume
            </Button>
          }
          data-testid="swarm-banner"
        />
      )}
      {swarm.state === 'stopped' && (
        <Banner
          tone="warning"
          message={`The swarm was stopped${swarm.stopReason === undefined ? '' : `: ${endReasonText(swarm.stopReason)}`}. Send a message to an agent to continue it.`}
          data-testid="swarm-banner"
        />
      )}
      {swarm.warnings.map((warning) => (
        <Notice key={warning} tone="warning" data-testid="swarm-warning">
          {warning}
        </Notice>
      ))}
      {failure !== undefined && (
        <Notice tone="danger" data-testid="swarm-error">
          {failure}
        </Notice>
      )}
      <Tabs defaultValue="agents">
        <TabList aria-label="Swarm views">
          <Tab value="agents" data-testid="swarm-tab-agents">
            Agents
          </Tab>
          <Tab value="results" data-testid="swarm-tab-results">
            Results
          </Tab>
        </TabList>
        <TabPanel value="agents">
          <AgentsTable swarm={swarm} run={run} />
        </TabPanel>
        <TabPanel value="results">
          <Results swarm={swarm} />
        </TabPanel>
      </Tabs>
    </>
  );
}

function AgentsTable({ swarm, run }: { readonly swarm: SwarmStatus; readonly run: (action: Promise<string | undefined>) => Promise<void> }) {
  return (
    <Table className="swarm-table" aria-label="Agents of the swarm" data-testid="swarm-agents">
      <TableHead>
        <TableRow>
          <TableHeader>Agent</TableHeader>
          <TableHeader>State</TableHeader>
          <TableHeader>Model</TableHeader>
          <TableHeader numeric>Turns</TableHeader>
          <TableHeader numeric>Spend (estimate)</TableHeader>
          <TableHeader numeric>Approvals</TableHeader>
          <TableHeader>
            <span className="swarm-sr-only">Actions</span>
          </TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {swarm.agents.map((agent) => (
          <AgentTableRow key={agent.name} swarmId={swarm.id} agent={agent} run={run} />
        ))}
      </TableBody>
    </Table>
  );
}

function AgentTableRow({ swarmId, agent, run }: { readonly swarmId: string; readonly agent: SwarmAgentStatus; readonly run: (action: Promise<string | undefined>) => Promise<void> }) {
  const controls = agentControls(agent.state);
  const detail = agentDetail(agent);
  return (
    <TableRow data-testid="swarm-agent-row" data-agent={agent.name} data-state={agent.state}>
      <TableCell>
        <span className="swarm-agent-name">{agent.name}</span>
        <span className="swarm-cell-note">
          {agent.role}, stage {agent.stage}, {agent.workspace}
        </span>
      </TableCell>
      <TableCell>
        <StatusChip status={RUN_STATUS[agent.state]} label={RUN_WORDS[agent.state]} data-testid="swarm-agent-state" />
        {detail !== '' && <span className="swarm-cell-note">{detail}</span>}
      </TableCell>
      <TableCell>
        {agent.model}
        <span className="swarm-cell-note">
          {agent.tier}, effort {agent.effort}, mode {agent.permissionMode}
        </span>
      </TableCell>
      <TableCell numeric>{agent.turns}</TableCell>
      <TableCell numeric>{agentSpendText(agent.spend)}</TableCell>
      <TableCell numeric>{agent.openApprovals.length}</TableCell>
      <TableCell>
        <span className="swarm-row-actions">
          <IconButton label={`Send a message to ${agent.name}`} title="Send message" icon={ACTION_ICONS['send-message'].icon} size="sm" tooltip={false} disabled={!controls.send} data-testid="swarm-agent-send" onClick={() => openSwarmDialog({ kind: 'send', swarmId, agent: agent.name })} />
          <IconButton label={`Interrupt ${agent.name}`} title="Interrupt" icon={ACTION_ICONS.pause.icon} size="sm" tooltip={false} disabled={!controls.interrupt} data-testid="swarm-agent-interrupt" onClick={() => void run(interruptAgent(swarmId, agent.name))} />
          <IconButton label={`Stop ${agent.name}`} title="Stop" icon={ACTION_ICONS.stop.icon} size="sm" variant="danger-quiet" tooltip={false} disabled={!controls.stop} data-testid="swarm-agent-stop" onClick={() => openSwarmDialog({ kind: 'stop-agent', swarmId, agent: agent.name })} />
        </span>
      </TableCell>
    </TableRow>
  );
}

/** A signature that changes when an agent changes state, so the results reload without polling. */
const signature = (swarm: SwarmStatus): string => `${swarm.state}|${swarm.agents.map((agent) => `${agent.name}:${agent.state}:${agent.turns}`).join(',')}`;

function Results({ swarm }: { readonly swarm: SwarmStatus }) {
  const [state, setState] = useState<{ readonly results?: SwarmResults; readonly error?: string; readonly loading: boolean }>({ loading: true });
  const key = signature(swarm);
  useEffect(() => {
    let live = true;
    void fetchResults(swarm.id).then((answer) => live && setState({ ...answer, loading: false }));
    return () => {
      live = false;
    };
  }, [swarm.id, key]);
  if (state.error !== undefined) {
    return (
      <Notice tone="danger" data-testid="swarm-results-error">
        {state.error}
      </Notice>
    );
  }
  if (state.results === undefined) return <p data-testid="swarm-results-loading">{state.loading ? 'Loading results…' : ''}</p>;
  const ended = state.results.agents.filter((agent) => agent.state === 'done' || agent.state === 'failed' || agent.state === 'stopped');
  if (ended.length === 0) {
    return <EmptyState icon={ACTION_ICONS.results.icon} title="No results yet" help="An agent's result shows here when it ends." data-testid="swarm-results-empty" />;
  }
  return (
    <div className="swarm-results" data-testid="swarm-results">
      {ended.map((result) => (
        <ResultCard key={result.name} result={result} />
      ))}
    </div>
  );
}

function ResultCard({ result }: { readonly result: AgentResult }) {
  const warnings = resultWarnings(result);
  return (
    <article className="swarm-result" data-testid="swarm-result" data-agent={result.name}>
      <h3>
        {result.name}
        <StatusChip status={RUN_STATUS[result.state]} label={RUN_WORDS[result.state]} />
      </h3>
      {warnings.map((warning) => (
        <Notice key={warning} tone="warning" data-testid="swarm-result-warning">
          {warning}
        </Notice>
      ))}
      <dl className="swarm-facts">
        {result.reason !== undefined && (
          <>
            <dt>Ended</dt>
            <dd>{endReasonText(result.reason)}</dd>
          </>
        )}
        {result.branch !== undefined && (
          <>
            <dt>Branch</dt>
            <dd>{result.branch}</dd>
          </>
        )}
        <dt>Changes</dt>
        <dd>{numstatSummary(result.numstat)}</dd>
        {result.commits.length > 0 && (
          <>
            <dt>Commits</dt>
            <dd>{result.commits.map((commit) => commit.subject).join('; ')}</dd>
          </>
        )}
      </dl>
      {result.text !== undefined && result.text !== '' && <pre data-testid="swarm-result-text">{result.text}</pre>}
    </article>
  );
}
