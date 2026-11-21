// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseOption, click, setValue } from '../../testing/dom';
import { installFakeApi } from '../../testing/fakeApi';
import { render, type Rendered } from '../../testing/render';
import { AgentsEditor } from './AgentsEditor';
import { emptyAgent, type AgentRow, type FormIssue } from './swarmForm';

let rendered: Rendered | undefined;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
});

const byId = <T extends HTMLElement>(id: string): T => document.querySelector<T>(`[data-testid="${id}"]`)!;
const mount = async (agents: readonly AgentRow[], issues: readonly FormIssue[] = [], showErrors = false) => {
  const onChange = vi.fn();
  installFakeApi({ browser_views_suspend: { stills: [] }, browser_views_resume: {} });
  rendered = await render(createElement(AgentsEditor, { agents, issues, showErrors, onChange }));
  return onChange;
};
const lastRows = (onChange: ReturnType<typeof vi.fn>): AgentRow[] => onChange.mock.calls.at(-1)![0] as AgentRow[];

describe('AgentsEditor', () => {
  it('changes only the row that was edited', async () => {
    const onChange = await mount([emptyAgent(0), emptyAgent(1)]);
    await setValue(byId<HTMLInputElement>('swarm-agent-name-1'), 'second');
    expect(lastRows(onChange).map((row) => row.name), 'the second row changed and the first stayed').toEqual(['agent-1', 'second']);
    await setValue(byId<HTMLInputElement>('swarm-agent-stage-0'), '2');
    expect(lastRows(onChange)[0]!.stage, 'the stage of the first row').toBe('2');
  });

  it('edits the long fields of a row inside its disclosure', async () => {
    const onChange = await mount([emptyAgent(0)]);
    await click(document.querySelector('[data-testid="swarm-agent-more-0"] button')!);
    await setValue(byId<HTMLTextAreaElement>('swarm-agent-prompt-0'), 'do it');
    expect(lastRows(onChange)[0]!.prompt, 'prompt').toBe('do it');
    await setValue(byId<HTMLTextAreaElement>('swarm-agent-owns-0'), 'src/**');
    expect(lastRows(onChange)[0]!.owns, 'owned paths').toBe('src/**');
    await setValue(byId<HTMLInputElement>('swarm-agent-depends-0'), 'a, b');
    expect(lastRows(onChange)[0]!.dependsOn, 'dependencies').toBe('a, b');
  });

  it('picks the role, the tier and the workspace', async () => {
    const onChange = await mount([emptyAgent(0)]);
    await chooseOption(byId('swarm-agent-role-0'), 'Reviewer');
    expect(lastRows(onChange)[0]!.role, 'role').toBe('reviewer');
    await chooseOption(byId('swarm-agent-tier-0'), 'Small');
    expect(lastRows(onChange)[0]!.tier, 'tier').toBe('small');
    await click(byId('swarm-agent-workspace-0-readonly'));
    expect(lastRows(onChange)[0]!.workspace, 'workspace').toBe('readonly');
  });

  it('adds a row named after its position and removes a row, but never the last one', async () => {
    const onChange = await mount([emptyAgent(0), emptyAgent(1)]);
    await click(byId('swarm-add-agent'));
    expect(lastRows(onChange).map((row) => row.name), 'a third row is appended').toEqual(['agent-1', 'agent-2', 'agent-3']);
    await click(byId('swarm-agent-remove-0'));
    expect(lastRows(onChange).map((row) => row.name), 'the first row is gone').toEqual(['agent-2']);
    await rendered!.unmount();
    await mount([emptyAgent(0)]);
    expect(byId<HTMLButtonElement>('swarm-agent-remove-0').disabled, 'the only row cannot be removed').toBe(true);
  });

  it('marks a field invalid only once errors are shown', async () => {
    const issues = [{ path: 'agents.0.name', message: 'name: use lower case' }];
    await mount([emptyAgent(0)], issues, false);
    expect(byId('swarm-agent-name-0').getAttribute('aria-invalid'), 'no mark before Start was pressed').toBeNull();
    expect(rendered!.container.querySelector('[data-testid="swarm-agent-name-0-error"]'), 'no message before Start was pressed').toBeNull();
    await rendered!.unmount();
    await mount([emptyAgent(0)], issues, true);
    expect(byId('swarm-agent-name-0').getAttribute('aria-invalid'), 'marked after Start').toBe('true');
    expect(byId('swarm-agent-name-0-error').textContent, 'the message is written next to the field').toBe('name: use lower case');
    expect(byId('swarm-agent-name-0').getAttribute('aria-describedby'), 'the field points to its message').toBe('swarm-agent-name-0-error');
  });
});
