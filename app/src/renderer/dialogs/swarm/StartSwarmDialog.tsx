import { useEffect, useMemo, useState } from 'react';
import { modeLabel } from '../../../core/permissions/modes';
import type { SwarmStartResult } from '../../../core/swarm/types';
import { api } from '../../api';
import { openSwarmPane } from '../../panes/swarm/openSwarmPane';
import { Button } from '../../ui/Button';
import { DialogContent } from '../../ui/Dialog';
import { Disclosure } from '../../ui/Disclosure';
import { TextArea, TextField, Field } from '../../ui/Field';
import { Hint } from '../../ui/Hint';
import { Notice } from '../../ui/Notice';
import { Select } from '../../ui/Select';
import { Switch } from '../../ui/Switch';
import { Tab, TabList, TabPanel, Tabs } from '../../ui/Tabs';
import { AgentsEditor } from './AgentsEditor';
import { definitionToForm, emptyForm, formToDefinition, issueFor, issueLine, MODE_CHOICES, previewAgents, previewCommands, validateDefinition, type FormIssue, type ModeChoice, type SwarmForm } from './swarmForm';
import { SWARM_TEMPLATES, templateForm } from './swarmTemplates';
import '../../panes/swarm/swarm.css';
import './swarmDialog.css';

const OTHER = '\u0000other';
const NONE = '';

function parseJson(text: string): { readonly value?: unknown; readonly error?: string } {
  try {
    return { value: JSON.parse(text) as unknown };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'The text is not valid JSON.' };
  }
}

/** The details of a failed start that name fields: a list of issues with a path and message, or an object that holds it. */
function detailIssues(details: unknown): FormIssue[] {
  const issues = Array.isArray(details) ? details : (details as { issues?: unknown } | undefined)?.issues;
  if (!Array.isArray(issues)) return [];
  return issues.flatMap((issue: unknown) => {
    const entry = issue as { path?: unknown; message?: unknown };
    if (typeof entry.message !== 'string') return [];
    const path = Array.isArray(entry.path) ? entry.path.join('.') : typeof entry.path === 'string' ? entry.path : '';
    return [{ path, message: entry.message }];
  });
}

/**
 * The start-swarm dialog of 0037 section 10: a Form tab and a JSON tab that round-trip, a template to begin
 * from, the agents table, a preview of what the app will launch, and Start. The definition is checked with the
 * schema as it is edited; Start sends it to the manager, and the manager's answer shows above the footer.
 */
export function StartSwarmDialog({ parentFolderId, onClose }: { readonly parentFolderId: string | null; readonly onClose: () => void }) {
  const [form, setForm] = useState<SwarmForm>(emptyForm);
  const [tab, setTab] = useState<'form' | 'json'>('form');
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | undefined>();
  const [repositories, setRepositories] = useState<readonly string[]>([]);
  const [otherRepo, setOtherRepo] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [failure, setFailure] = useState<{ readonly message: string; readonly issues: readonly FormIssue[] } | undefined>();
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof SwarmForm>(key: K, value: SwarmForm[K]): void => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    void api()
      .invoke<{ repositories: string[] }>('task_repositories')
      .then((result) => result.ok && setRepositories(result.value.repositories));
  }, []);

  const parsedJson = useMemo(() => (tab === 'json' ? parseJson(jsonText) : undefined), [tab, jsonText]);
  const input = tab === 'json' ? parsedJson?.value : formToDefinition(form);
  const validation = useMemo(() => (input === undefined ? { issues: [] as FormIssue[] } : validateDefinition(input)), [input]);
  const issues = validation.issues;
  const field = (path: string): string | undefined => (showErrors ? issueFor(issues, path) : undefined);
  const repoValue = otherRepo || (form.repoPath !== '' && !repositories.includes(form.repoPath)) ? OTHER : form.repoPath;

  const switchTab = (next: string): void => {
    if (next === 'json') {
      setJsonText(JSON.stringify(formToDefinition(form), null, 2));
      setJsonError(undefined);
      setTab('json');
      return;
    }
    const parsed = parseJson(jsonText);
    if (parsed.error !== undefined || parsed.value === null || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
      setJsonError(parsed.error ?? 'The definition must be a JSON object.');
      return;
    }
    setForm(definitionToForm(parsed.value));
    setJsonError(undefined);
    setTab('form');
  };

  const start = async (): Promise<void> => {
    setShowErrors(true);
    setFailure(undefined);
    if (input === undefined || validation.definition === undefined) return;
    setBusy(true);
    const result = await api().invoke<SwarmStartResult>('swarm_start', { definition: input, ...(parentFolderId === null ? {} : { parentFolderId }) });
    setBusy(false);
    if (result.ok) {
      onClose();
      void openSwarmPane(result.value.swarmId);
    } else setFailure({ message: result.error.message, issues: detailIssues(result.error.details) });
  };

  const preview = validation.definition;
  const shown: readonly FormIssue[] = showErrors ? issues : tab === 'json' && parsedJson?.error === undefined ? issues : [];
  return (
    <DialogContent
      title="New swarm"
      size={640}
      className="swarm-start-dialog"
      data-testid="start-swarm-dialog"
      data-parent-folder={parentFolderId ?? undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) void start();
      }}
      footer={
        <>
          <Button data-dialog-cancel onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" data-testid="swarm-start" loading={busy}>
            {busy ? 'Starting…' : 'Start'}
          </Button>
        </>
      }
    >
      <Tabs value={tab} onValueChange={switchTab}>
        <TabList aria-label="Definition editor">
          <Tab value="form" data-testid="swarm-tab-form">
            Form
          </Tab>
          <Tab value="json" data-testid="swarm-tab-json">
            JSON
          </Tab>
        </TabList>
        <TabPanel value="form" className="swarm-form">
          <Field label="Template">
            {(control) => (
              <Select
                {...control}
                data-testid="swarm-template"
                value=""
                onValueChange={(id) => {
                  const template = SWARM_TEMPLATES.find((candidate) => candidate.id === id);
                  if (template) {
                    setForm(templateForm(template));
                    setOtherRepo(false);
                  }
                }}
                options={[{ value: '', label: 'Choose a template…' }, ...SWARM_TEMPLATES.map((template) => ({ value: template.id, label: template.label }))]}
              />
            )}
          </Field>
          <TextArea label="Goal" data-autofocus data-testid="swarm-goal-input" rows={2} value={form.goal} error={field('goal')} onChange={(event) => set('goal', event.target.value)} />
          <Field label="Repository" error={field('repository')}>
            {(control) => (
              <Select
                {...control}
                data-testid="swarm-repo"
                value={repoValue}
                onValueChange={(value) => {
                  setOtherRepo(value === OTHER);
                  set('repoPath', value === OTHER ? '' : value);
                }}
                options={[{ value: NONE, label: 'No repository' }, ...repositories.map((path) => ({ value: path, label: path })), { value: OTHER, label: 'Another path…' }]}
              />
            )}
          </Field>
          {repoValue === OTHER && <TextField label="Repository path" mono data-testid="swarm-repo-path" value={form.repoPath} error={field('repository.path')} onChange={(event) => set('repoPath', event.target.value)} />}
          {form.repoPath.trim() !== '' && <TextField label="Base" help="A branch or commit; empty uses the current head." mono data-testid="swarm-base" value={form.base} error={field('repository.base')} onChange={(event) => set('base', event.target.value)} />}
          <Field label="Permission mode" help="An agent never runs with a looser mode than this.">
            {(control) => (
              <Select {...control} data-testid="swarm-mode" value={form.permissionMode} onValueChange={(value) => set('permissionMode', value as ModeChoice)} options={MODE_CHOICES.map((mode) => ({ value: mode, label: modeLabel(mode) }))} />
            )}
          </Field>
          <div className="swarm-budget-fields">
            <TextField label="Total budget (USD)" inputMode="decimal" data-testid="swarm-usd-total" value={form.usdTotal} error={field('budget.usdTotal')} onChange={(event) => set('usdTotal', event.target.value)} />
            <TextField label="Per agent (USD)" inputMode="decimal" placeholder="1.00 or the total" data-testid="swarm-usd-agent" value={form.usdPerAgent} error={field('budget.usdPerAgent')} onChange={(event) => set('usdPerAgent', event.target.value)} />
            <TextField label="Time limit (minutes)" inputMode="numeric" data-testid="swarm-minutes" value={form.wallClockMinutes} error={field('budget.wallClockMinutes')} onChange={(event) => set('wallClockMinutes', event.target.value)} />
            <TextField label="Review share (0 to 0.8)" inputMode="decimal" data-testid="swarm-review-share" value={form.reviewShare} error={field('budget.reviewShare')} onChange={(event) => set('reviewShare', event.target.value)} />
          </div>
          <Hint>Budgets count list-price equivalents of the tokens used. Swarms run on your subscription, so nothing is billed.</Hint>
          <Switch checked={form.connectors} onCheckedChange={(checked) => set('connectors', checked)} label="Agents may use connectors" data-testid="swarm-connectors" />
          <AgentsEditor agents={form.agents} issues={issues} showErrors={showErrors} onChange={(agents) => set('agents', agents)} />
        </TabPanel>
        <TabPanel value="json" className="swarm-form">
          <TextArea
            label="Definition"
            help="The same document the form builds. Edits here come back to the form."
            mono
            rows={18}
            spellCheck={false}
            data-testid="swarm-json"
            value={jsonText}
            error={parsedJson?.error ?? jsonError}
            onChange={(event) => {
              setJsonText(event.target.value);
              setJsonError(undefined);
            }}
          />
        </TabPanel>
      </Tabs>
      <Disclosure label="Preview" open={previewOpen} onOpenChange={setPreviewOpen} data-testid="swarm-preview-disclosure">
        {preview === undefined ? (
          <Hint>The preview shows when the definition is valid.</Hint>
        ) : (
          <div data-testid="swarm-preview" className="swarm-preview">
            <pre>{previewCommands(preview).join('\n') || 'No commands run before the agents start.'}</pre>
            <ul>
              {previewAgents(preview).map((agent) => (
                <li key={agent.name} data-testid="swarm-preview-agent">
                  {agent.name}: {agent.model}, effort {agent.effort}, mode {modeLabel(agent.mode)}
                  {agent.capped ? ', lowered by the highest tier allowed' : ''}
                </li>
              ))}
            </ul>
            <Hint>Models and efforts follow the default tier table; the profile can replace rows.</Hint>
          </div>
        )}
      </Disclosure>
      {shown.length > 0 && (
        <Notice tone="danger" data-testid="swarm-issues">
          <ul className="swarm-issue-list">
            {shown.map((issue) => (
              <li key={`${issue.path}:${issue.message}`}>{issueLine(issue)}</li>
            ))}
          </ul>
        </Notice>
      )}
      {failure !== undefined && (
        <Notice tone="danger" data-testid="swarm-start-error">
          {failure.message}
          {failure.issues.length > 0 && (
            <ul className="swarm-issue-list">
              {failure.issues.map((issue) => (
                <li key={`${issue.path}:${issue.message}`}>{issueLine(issue)}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}
    </DialogContent>
  );
}
