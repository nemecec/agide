// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseOption, click, setValue } from '../../testing/dom';
import { installFakeApi, type FakeApi } from '../../testing/fakeApi';
import { flush, render, type Rendered } from '../../testing/render';
import { DialogRoot } from '../../ui/Dialog';
import { StartSwarmDialog } from './StartSwarmDialog';

let rendered: Rendered | undefined;
let fake: FakeApi;
const onClose = vi.fn();
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
  onClose.mockReset();
});

const layoutAnswers = {
  layout_get: { layoutId: 'default', revision: 1, layout: { instances: { main: { type: 'agide/surface-host', config: {} } }, arrangement: { tabs: { panes: ['main'] } } } },
  layout_apply: {},
};

async function mount(responders: Record<string, unknown> = {}, parentFolderId: string | null = null) {
  fake = installFakeApi({ task_repositories: { repositories: ['/repos/one', '/repos/two'] }, swarm_start: { swarmId: 's1', folderId: 'f1', agents: [], warnings: [] }, ...layoutAnswers, ...responders });
  rendered = await render(createElement(DialogRoot, { open: true, onOpenChange: () => undefined, children: createElement(StartSwarmDialog, { parentFolderId, onClose }) }));
}
const byId = <T extends HTMLElement>(id: string): T | null => document.querySelector<T>(`[data-testid="${id}"]`);
const input = (id: string) => byId<HTMLInputElement>(id)!;
const area = (id: string) => byId<HTMLTextAreaElement>(id)!;
const mouseDown = (element: Element) => act(async () => void element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
const sentDefinition = () => (fake.invoke.mock.calls.find((call) => call[0] === 'swarm_start')?.[1] as { definition: Record<string, unknown>; parentFolderId?: string }) ?? undefined;

async function fillMinimal() {
  await setValue(area('swarm-goal-input'), 'Research the options');
  await click(document.querySelector('[data-testid="swarm-agent-more-0"] button')!);
  await setValue(area('swarm-agent-prompt-0'), 'Read and summarise');
  await click(document.querySelector('[data-testid="swarm-agent-workspace-0-scratch"]')!);
}

describe('StartSwarmDialog', () => {
  it('opens on the form with the goal focused, a parent for the swarm and one agent row', async () => {
    await mount({}, 'f9');
    expect(byId('start-swarm-dialog')?.getAttribute('data-parent-folder'), 'parent folder').toBe('f9');
    expect(document.activeElement, 'goal has focus').toBe(area('swarm-goal-input'));
    expect(document.querySelectorAll('[data-testid="swarm-agent-form-row"]'), 'one agent row').toHaveLength(1);
    expect(byId('swarm-tab-form')?.getAttribute('aria-selected'), 'Form tab is selected').toBe('true');
  });

  it('shows the problems of an empty definition only after Start was pressed, on their fields and above the footer', async () => {
    await mount();
    expect(byId('swarm-issues'), 'no notice before Start').toBeNull();
    await click(byId('swarm-start')!);
    expect(fake.invoke.mock.calls.some((call) => call[0] === 'swarm_start'), 'nothing is sent while invalid').toBe(false);
    expect(byId('swarm-issues')?.textContent, 'the notice lists the goal and the prompt').toMatch(/goal.*\n?.*agents\.0\.prompt/s);
    expect(document.querySelector('#' + CSS.escape(area('swarm-goal-input').id) + '[aria-invalid="true"]'), 'the goal field is marked invalid').not.toBeNull();
  });

  it('sends the definition of the form to swarm_start with the parent folder and closes', async () => {
    await mount({}, 'f9');
    await fillMinimal();
    await click(byId('swarm-start')!);
    const call = sentDefinition();
    expect(call.parentFolderId, 'parent folder passed on').toBe('f9');
    expect(call.definition, 'definition from the form').toMatchObject({ version: 1, goal: 'Research the options', agents: [{ name: 'agent-1', prompt: 'Read and summarise', workspace: 'scratch' }] });
    expect(onClose, 'dialog closed after a successful start').toHaveBeenCalledTimes(1);
    await flush();
    expect(fake.invoke, 'the swarm pane is opened').toHaveBeenCalledWith('layout_apply', expect.anything());
  });

  it('omits the parent folder when opened at the top level', async () => {
    await mount();
    await fillMinimal();
    await click(byId('swarm-start')!);
    expect(sentDefinition().parentFolderId, 'no parent').toBeUndefined();
  });

  it('shows the answer of the manager above the footer, with the fields it names, and stays open', async () => {
    await mount({ swarm_start: { ok: false, error: { code: 'invalid_input', message: 'agents.0.owns: overlaps with agent-2', details: [{ path: ['agents', 0, 'owns'], message: 'overlaps with agent-2' }] } } });
    await fillMinimal();
    await click(byId('swarm-start')!);
    expect(byId('swarm-start-error')?.textContent, 'manager message and issues').toContain('overlaps with agent-2');
    expect(byId('swarm-start-error')?.querySelector('li')?.textContent, 'issue line with its path').toBe('agents.0.owns: overlaps with agent-2');
    expect(onClose, 'stays open').not.toHaveBeenCalled();
    expect((byId('swarm-start') as HTMLButtonElement).disabled, 'Start works again').toBe(false);
  });

  it('shows an answer without details as one message', async () => {
    await mount({ swarm_start: { ok: false, error: { code: 'limit_reached', message: 'spawn depth is at the limit' } } });
    await fillMinimal();
    await click(byId('swarm-start')!);
    expect(byId('swarm-start-error')?.textContent, 'plain message').toBe('spawn depth is at the limit');
  });

  it('lists the recent repositories, offers another path and shows the base once a repository is chosen', async () => {
    await mount();
    expect(byId('swarm-base'), 'no base without a repository').toBeNull();
    await chooseOption(byId('swarm-repo')!, '/repos/two');
    expect(byId('swarm-repo')!.getAttribute('data-value'), 'repository chosen').toBe('/repos/two');
    await setValue(input('swarm-base'), 'develop');
    await chooseOption(byId('swarm-repo')!, 'Another path…');
    await setValue(input('swarm-repo-path'), '/elsewhere');
    expect(input('swarm-repo-path').value, 'typed path').toBe('/elsewhere');
    await chooseOption(byId('swarm-repo')!, 'No repository');
    expect(byId('swarm-repo-path'), 'path field hidden again').toBeNull();
  });

  it('fills the form from a template and keeps the repository empty until the user names one', async () => {
    await mount();
    await chooseOption(byId('swarm-template')!, 'Implement, test and review');
    expect(document.querySelectorAll('[data-testid="swarm-agent-form-row"]'), 'three agents').toHaveLength(3);
    expect(input('swarm-agent-name-2').value, 'reviewer agent').toBe('review');
    await click(byId('swarm-start')!);
    expect(byId('swarm-issues')?.textContent, 'the repository is asked for').toContain('needs a repository');
  });

  it('adds and removes agents, and keeps at least one', async () => {
    await mount();
    expect((byId('swarm-agent-remove-0') as HTMLButtonElement).disabled, 'the only agent cannot be removed').toBe(true);
    await click(byId('swarm-add-agent')!);
    expect(input('swarm-agent-name-1').value, 'new agent gets the next name').toBe('agent-2');
    await click(byId('swarm-agent-remove-0')!);
    expect(document.querySelectorAll('[data-testid="swarm-agent-form-row"]'), 'one left').toHaveLength(1);
    expect(input('swarm-agent-name-0').value, 'the second agent remained').toBe('agent-2');
  });

  it('round-trips the form through the JSON tab, including keys the form has no field for', async () => {
    await mount();
    await fillMinimal();
    await mouseDown(byId('swarm-tab-json')!);
    const parsed = JSON.parse(area('swarm-json').value) as { agents: Record<string, unknown>[] };
    expect(parsed.agents[0], 'the form shows in the JSON').toMatchObject({ name: 'agent-1', workspace: 'scratch' });
    parsed.agents[0]!['effort'] = 'low';
    parsed.agents[0]!['name'] = 'scout';
    await setValue(area('swarm-json'), JSON.stringify(parsed));
    await mouseDown(byId('swarm-tab-form')!);
    expect(input('swarm-agent-name-0').value, 'the edit reached the form').toBe('scout');
    await click(byId('swarm-start')!);
    expect(sentDefinition().definition['agents'], 'the effort survived the round trip').toMatchObject([{ name: 'scout', effort: 'low' }]);
  });

  it('shows the validation messages live in the JSON tab and refuses to leave it with broken JSON', async () => {
    await mount();
    await mouseDown(byId('swarm-tab-json')!);
    expect(byId('swarm-issues')?.textContent, 'issues of the empty definition show at once').toContain('goal');
    await setValue(area('swarm-json'), '{ "version": ');
    expect(document.querySelector('.ui-field-note[data-kind="error"]')?.textContent, 'syntax error on the field').toMatch(/JSON/i);
    await mouseDown(byId('swarm-tab-form')!);
    expect(byId('swarm-tab-json')?.getAttribute('aria-selected'), 'still on the JSON tab').toBe('true');
    await setValue(area('swarm-json'), '[]');
    await mouseDown(byId('swarm-tab-form')!);
    expect(byId('swarm-tab-json')?.getAttribute('aria-selected'), 'a JSON array is not a definition').toBe('true');
  });

  it('sends JSON typed in the editor and does not send it while invalid', async () => {
    await mount();
    await mouseDown(byId('swarm-tab-json')!);
    await setValue(area('swarm-json'), JSON.stringify({ version: 1, goal: 'Typed', budget: { usdTotal: 1 }, agents: [{ name: 'a', prompt: 'p', workspace: 'scratch' }] }));
    await click(byId('swarm-start')!);
    expect(sentDefinition().definition, 'the typed definition').toMatchObject({ goal: 'Typed' });
  });

  it('previews the commands and each agent with model, effort and mode once the definition is valid', async () => {
    await mount();
    await click(document.querySelector('[data-testid="swarm-preview-disclosure"] button')!);
    expect(byId('swarm-preview'), 'no preview while invalid').toBeNull();
    await fillMinimal();
    expect(byId('swarm-preview-agent')?.textContent, 'agent line').toBe('agent-1: sonnet, effort medium, mode Auto');
    expect(byId('swarm-preview')?.querySelector('pre')?.textContent, 'commands').toBe('mkdir <swarm data>/agent-1');
  });

  it('lets the budget, mode and connectors be edited', async () => {
    await mount();
    await fillMinimal();
    await setValue(input('swarm-usd-total'), '7.5');
    await setValue(input('swarm-usd-agent'), '2');
    await setValue(input('swarm-minutes'), '30');
    await setValue(input('swarm-review-share'), '0.25');
    await chooseOption(byId('swarm-mode')!, 'Plan first');
    await click(document.querySelector('[data-testid="swarm-connectors"]')!);
    await click(byId('swarm-start')!);
    const definition = sentDefinition().definition as { permissionMode: string; budget: Record<string, number>; agents: { connectors?: boolean }[] };
    expect(definition.permissionMode, 'mode').toBe('plan');
    expect(definition.budget, 'budget').toMatchObject({ usdTotal: 7.5, usdPerAgent: 2, wallClockMinutes: 30, reviewShare: 0.25 });
    expect(definition.agents[0]?.connectors, 'connectors').toBe(true);
  });

  it('cancels with the Cancel button', async () => {
    await mount();
    await click(document.querySelector('[data-dialog-cancel]')!);
    expect(onClose, 'closed').toHaveBeenCalledTimes(1);
  });
});
