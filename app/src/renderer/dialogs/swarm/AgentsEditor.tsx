import { Button } from '../../ui/Button';
import { Disclosure } from '../../ui/Disclosure';
import { TextArea, TextField } from '../../ui/Field';
import { IconButton } from '../../ui/IconButton';
import { ACTION_ICONS } from '../../ui/icons';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Select } from '../../ui/Select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/Table';
import { emptyAgent, issueFor, type AgentRow, type FormIssue, type Role, type TierChoice, type WorkspaceChoice } from './swarmForm';

const ROLES: readonly { value: Role; label: string }[] = [
  { value: 'worker', label: 'Worker' },
  { value: 'reviewer', label: 'Reviewer' },
  { value: 'mechanical', label: 'Mechanical' },
];
const TIERS: readonly { value: TierChoice; label: string }[] = [
  { value: 'default', label: 'By role' },
  { value: 'strong', label: 'Strong' },
  { value: 'mid', label: 'Mid' },
  { value: 'small', label: 'Small' },
];
const WORKSPACES = [
  { value: 'worktree', label: 'Worktree', testId: 'swarm-workspace-worktree' },
  { value: 'readonly', label: 'Read-only' },
  { value: 'scratch', label: 'Scratch' },
] as const;

export interface AgentsEditorProps {
  readonly agents: readonly AgentRow[];
  readonly issues: readonly FormIssue[];
  readonly showErrors: boolean;
  readonly onChange: (agents: readonly AgentRow[]) => void;
}

/** The reason a cell is invalid, as text beside the field, so it does not depend on colour or a tooltip. */
function CellError({ id, message }: { readonly id: string; readonly message: string | undefined }) {
  if (message === undefined) return null;
  return (
    <p id={id} className="ui-field-note" data-kind="error" data-testid={id}>
      {message}
    </p>
  );
}

/** The agents table of the start dialog (0037 section 10): one row per agent, a Disclosure per row for the long fields. */
export function AgentsEditor({ agents, issues, showErrors, onChange }: AgentsEditorProps) {
  const update = (index: number, change: Partial<AgentRow>): void => onChange(agents.map((agent, at) => (at === index ? { ...agent, ...change } : agent)));
  const error = (index: number, field: string): string | undefined => (showErrors ? issueFor(issues, `agents.${index}.${field}`) : undefined);
  return (
    <div className="swarm-agents-editor" data-testid="swarm-agents-editor">
      <Table aria-label="Agents">
        <TableHead>
          <TableRow>
            <TableHeader>Name</TableHeader>
            <TableHeader>Role</TableHeader>
            <TableHeader>Tier</TableHeader>
            <TableHeader>Workspace</TableHeader>
            <TableHeader numeric>Stage</TableHeader>
            <TableHeader>
              <span className="swarm-sr-only">Remove</span>
            </TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {agents.flatMap((agent, index) => [
            <TableRow key={`${index}-main`} data-testid="swarm-agent-form-row">
              <TableCell>
                <input
                  className="ui-input"
                  data-mono
                  aria-label={`Name of agent ${index + 1}`}
                  aria-invalid={error(index, 'name') === undefined ? undefined : true}
                  aria-describedby={error(index, 'name') === undefined ? undefined : `swarm-agent-name-${index}-error`}
                  data-testid={`swarm-agent-name-${index}`}
                  value={agent.name}
                  onChange={(event) => update(index, { name: event.target.value })}
                />
                <CellError id={`swarm-agent-name-${index}-error`} message={error(index, 'name')} />
              </TableCell>
              <TableCell>
                <Select aria-label={`Role of agent ${index + 1}`} value={agent.role} onValueChange={(value) => update(index, { role: value as Role })} options={ROLES} data-testid={`swarm-agent-role-${index}`} />
              </TableCell>
              <TableCell>
                <Select aria-label={`Tier of agent ${index + 1}`} value={agent.tier} onValueChange={(value) => update(index, { tier: value as TierChoice })} options={TIERS} data-testid={`swarm-agent-tier-${index}`} />
              </TableCell>
              <TableCell>
                <SegmentedControl aria-label={`Workspace of agent ${index + 1}`} value={agent.workspace} onValueChange={(value) => update(index, { workspace: value as WorkspaceChoice })} segments={WORKSPACES.map((segment) => ({ ...segment, testId: `swarm-agent-workspace-${index}-${segment.value}` }))} />
              </TableCell>
              <TableCell numeric>
                <input
                  className="ui-input swarm-stage-input"
                  inputMode="numeric"
                  aria-label={`Stage of agent ${index + 1}`}
                  aria-invalid={error(index, 'stage') === undefined ? undefined : true}
                  aria-describedby={error(index, 'stage') === undefined ? undefined : `swarm-agent-stage-${index}-error`}
                  data-testid={`swarm-agent-stage-${index}`}
                  value={agent.stage}
                  onChange={(event) => update(index, { stage: event.target.value })}
                />
                <CellError id={`swarm-agent-stage-${index}-error`} message={error(index, 'stage')} />
              </TableCell>
              <TableCell>
                <IconButton label={`Remove agent ${index + 1}`} title="Remove" icon={ACTION_ICONS.remove.icon} size="sm" variant="danger-quiet" tooltip={false} disabled={agents.length === 1} data-testid={`swarm-agent-remove-${index}`} onClick={() => onChange(agents.filter((_, at) => at !== index))} />
              </TableCell>
            </TableRow>,
            <TableRow key={`${index}-more`}>
              <TableCell colSpan={6}>
                <Disclosure label={`Prompt and limits of ${agent.name || `agent ${index + 1}`}`} data-testid={`swarm-agent-more-${index}`} defaultOpen={showErrors && (error(index, 'prompt') !== undefined || error(index, 'dependsOn') !== undefined)}>
                  <div className="swarm-agent-fields">
                    <TextArea label="Prompt" rows={3} data-testid={`swarm-agent-prompt-${index}`} value={agent.prompt} error={error(index, 'prompt')} onChange={(event) => update(index, { prompt: event.target.value })} />
                    <TextArea label="Owned paths" help="One glob per line, relative to the repository root." rows={2} mono data-testid={`swarm-agent-owns-${index}`} value={agent.owns} error={error(index, 'owns')} onChange={(event) => update(index, { owns: event.target.value })} />
                    <TextField label="Depends on" help="Agent names, separated by commas." mono data-testid={`swarm-agent-depends-${index}`} value={agent.dependsOn} error={error(index, 'dependsOn')} onChange={(event) => update(index, { dependsOn: event.target.value })} />
                    <TextField label="Tools available" help="Tool names, separated by commas. Empty keeps the default set." mono value={agent.toolsAvailable} onChange={(event) => update(index, { toolsAvailable: event.target.value })} />
                    <TextArea label="Denied tool rules" help="One rule per line." rows={2} mono value={agent.toolsDeny} onChange={(event) => update(index, { toolsDeny: event.target.value })} />
                    <TextField label="Budget of this agent (USD)" inputMode="decimal" value={agent.budgetUsd} error={error(index, 'budget')} onChange={(event) => update(index, { budgetUsd: event.target.value })} />
                  </div>
                </Disclosure>
              </TableCell>
            </TableRow>,
          ])}
        </TableBody>
      </Table>
      <Button size="sm" icon={ACTION_ICONS.add.icon} data-testid="swarm-add-agent" onClick={() => onChange([...agents, emptyAgent(agents.length)])}>
        Add agent
      </Button>
    </div>
  );
}
