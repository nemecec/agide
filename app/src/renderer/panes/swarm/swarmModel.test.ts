import { describe, expect, it } from 'vitest';
import { AGENT_RUN_STATES, SWARM_STATES, type SwarmApprovalPayload } from '../../../core/swarm/types';
import { STATUS_ICONS } from '../../ui/icons';
import { agentStatus, swarmStatus } from './swarmFixtures';
import {
  RUN_STATUS,
  RUN_WORDS,
  SWARM_STATUS,
  SWARM_WORDS,
  agentControls,
  agentDetail,
  agentSpendText,
  approvalButtons,
  capLabel,
  endReasonText,
  expiryText,
  findAgent,
  groupControls,
  hasSessionRuleSuggestion,
  meterModel,
  numstatSummary,
  readApprovalPayload,
  resultWarnings,
  tally,
  tallyText,
} from './swarmModel';

const budget = (reported: number, estimated = 0, reserved = 0, total = 3) => ({ usdTotal: total, reportedUsd: reported, estimatedUsd: estimated, reservedUsd: reserved });

describe('run states and chips', () => {
  it('gives every run state and swarm state a chip glyph and a word', () => {
    for (const state of AGENT_RUN_STATES) {
      expect(STATUS_ICONS[RUN_STATUS[state]], `chip glyph of the run state ${state}`).toBeDefined();
      expect(RUN_WORDS[state].length, `word of the run state ${state}`).toBeGreaterThan(0);
    }
    for (const state of SWARM_STATES) {
      expect(STATUS_ICONS[SWARM_STATUS[state]], `chip glyph of the swarm state ${state}`).toBeDefined();
      expect(SWARM_WORDS[state].length, `word of the swarm state ${state}`).toBeGreaterThan(0);
    }
  });

  it('draws queued, interrupted and stopped with their own glyphs, apart from exited and busy', () => {
    const glyphs = AGENT_RUN_STATES.filter((state) => state !== 'running').map((state) => STATUS_ICONS[RUN_STATUS[state]].icon);
    expect(new Set(glyphs).size, 'one glyph keeps one meaning').toBe(glyphs.length);
    expect(RUN_STATUS.stopped, 'stopped does not reuse the exited square').not.toBe('exited');
  });
});

describe('agentDetail', () => {
  const base = { openApprovals: [] };
  it('says what a queued agent waits for', () => {
    expect(agentDetail({ ...base, state: 'queued', queuedFor: 'slot' }), 'slot').toBe('waiting for a free slot');
    expect(agentDetail({ ...base, state: 'queued', queuedFor: 'budget' }), 'budget').toBe('waiting for budget');
    expect(agentDetail({ ...base, state: 'queued' }), 'no reason').toBe('waiting');
  });
  it('says why an interrupted, failed or stopped agent is not running', () => {
    expect(agentDetail({ ...base, state: 'interrupted', interruptedBy: 'quit' }), 'quit').toBe('Agide was closed');
    expect(agentDetail({ ...base, state: 'interrupted' }), 'unknown cause').toBe('');
    expect(agentDetail({ ...base, state: 'failed', reason: 'agent-budget' }), 'budget').toBe('the agent spent its budget');
    expect(agentDetail({ ...base, state: 'stopped', reason: 'user' }), 'user stop').toBe('stopped by you');
    expect(agentDetail({ ...base, state: 'failed' }), 'no reason').toBe('');
  });
  it('counts open approvals of a waiting agent', () => {
    const request = { requestId: 'r', request: { subtype: 'can_use_tool' as const, tool_name: 'Bash', input: {} }, openedAt: '' };
    expect(agentDetail({ state: 'waiting', openApprovals: [request] }), 'one').toBe('one approval is open');
    expect(agentDetail({ state: 'waiting', openApprovals: [request, request] }), 'two').toBe('2 approvals are open');
    expect(agentDetail({ ...base, state: 'running' }), 'running has nothing to add').toBe('');
  });
  it('words every end reason', () => {
    expect(endReasonText('wall-clock'), 'wall clock').toBe('the swarm reached its time limit');
  });
});

describe('tally and labels', () => {
  const agents = [{ state: 'running' as const }, { state: 'waiting' as const }, { state: 'queued' as const }, { state: 'done' as const }, { state: 'failed' as const }];
  it('counts a waiting agent as running, since it holds its slot', () => {
    expect(tally(agents), 'tally').toEqual({ running: 2, waiting: 1, queued: 1, ended: 2, total: 5 });
  });
  it('words the tally for the tooltip and the cap for the project folder', () => {
    expect(tallyText(tally(agents)), 'tooltip').toBe('2 running, 1 queued, 1 waiting for an answer');
    expect(tallyText(tally([{ state: 'running' }])), 'no waiting part when none waits').toBe('1 running, 0 queued');
    expect(capLabel(2, 4), 'cap').toBe('2 of 4 agents running');
  });
});

describe('meterModel', () => {
  it('lays the reported, estimated and reserved parts one after the other as shares of the total', () => {
    const model = meterModel(budget(0.6, 0.3, 0.6));
    expect([model.reported, model.estimated, model.reserved].map((share) => Number(share.toFixed(2))), 'shares').toEqual([0.2, 0.1, 0.2]);
    expect(model.level, 'under 80 percent').toBe('normal');
  });
  it('states in words that the figures are list-price equivalents and how much is estimated', () => {
    expect(meterModel(budget(1.2, 0.3)).label, 'label').toBe('1.50 of 3.00 USD, list-price equivalent, not billed, 0.30 of it estimated from tokens');
    expect(meterModel(budget(1.2)).label, 'no estimate part when there is none').toBe('1.20 of 3.00 USD, list-price equivalent, not billed');
  });
  it('turns to warning from 80 percent and to danger at the cap, and says so in the words', () => {
    const warning = meterModel(budget(2.4));
    expect([warning.level, warning.label.endsWith(', over 80 percent')], 'at 80 percent').toEqual(['warning', true]);
    const under = meterModel(budget(2.39));
    expect(under.level, 'just under 80 percent').toBe('normal');
    const danger = meterModel(budget(3));
    expect([danger.level, danger.label.endsWith(', limit reached')], 'at the cap').toEqual(['danger', true]);
  });
  it('keeps the parts inside the bar when spend passes the total', () => {
    const model = meterModel(budget(2, 2, 2));
    expect(model.reported + model.estimated + model.reserved, 'shares add up to at most the whole').toBeLessThanOrEqual(1);
  });
  it('does not divide by a zero total', () => {
    const model = meterModel(budget(0, 0, 0, 0));
    expect([model.reported, model.level], 'zero total').toEqual([0, 'normal']);
  });
});

describe('agentSpendText', () => {
  it('marks an estimated part and an agent without a price', () => {
    expect(agentSpendText({ reportedUsd: 0.4, estimatedUsd: 0, priced: true }), 'reported only').toBe('0.40 USD');
    expect(agentSpendText({ reportedUsd: 0.4, estimatedUsd: 0.1, priced: true }), 'estimated part').toBe('0.50 USD (est.)');
    expect(agentSpendText({ reportedUsd: 0, estimatedUsd: 0, priced: false }), 'no price').toBe('no price');
  });
});

describe('controls', () => {
  it('allows pause while running, resume while paused, and stop until the swarm ended', () => {
    expect(groupControls('running'), 'running').toEqual({ pause: true, resume: false, stop: true });
    expect(groupControls('paused'), 'paused').toEqual({ pause: false, resume: true, stop: true });
    expect(groupControls('stopped'), 'a stopped swarm continues by a message to an agent, not by a group resume').toEqual({ pause: false, resume: false, stop: false });
    expect(groupControls('done'), 'done').toEqual({ pause: false, resume: false, stop: false });
  });
  it('lets only a live agent interrupt, and an ended or interrupted agent receive a message', () => {
    expect(agentControls('running'), 'running').toEqual({ send: true, interrupt: true, stop: true });
    expect(agentControls('queued'), 'queued cannot be messaged but can be stopped').toEqual({ send: false, interrupt: false, stop: true });
    expect(agentControls('done'), 'done').toEqual({ send: true, interrupt: false, stop: false });
    expect(agentControls('interrupted'), 'interrupted').toEqual({ send: true, interrupt: false, stop: true });
  });
});

describe('results', () => {
  it('turns the checks of a result into sentences without repeats', () => {
    const warnings = resultWarnings({ outsideOwns: ['a.ts', 'a.ts'], overlapsWith: ['tests'], editedInputs: true, conflict: 'a.ts' });
    expect(warnings, 'four warnings').toEqual([
      'Changed files outside its owned paths: a.ts',
      'Changed files that tests also changed',
      'You edited a tool input of this agent; the agent was not told',
      'Merge conflict: a.ts',
    ]);
    expect(resultWarnings({ outsideOwns: [], overlapsWith: [], editedInputs: false }), 'a clean result has none').toEqual([]);
  });
  it('summarises the changed files', () => {
    expect(numstatSummary([]), 'none').toBe('no changed files');
    expect(numstatSummary([{ path: 'a', added: 3, removed: 1 }]), 'one').toBe('1 file, +3 −1');
    expect(numstatSummary([{ path: 'a', added: 3, removed: 1 }, { path: 'b', added: 2, removed: 0 }]), 'two').toBe('2 files, +5 −1');
  });
});

describe('findAgent', () => {
  it('finds the swarm and agent of a session', () => {
    const swarms = [swarmStatus('s1', [agentStatus('impl')]), swarmStatus('s2', [agentStatus('tests', 'queued')])];
    expect(findAgent(swarms, 'session-tests')?.swarm.id, 'swarm of the session').toBe('s2');
    expect(findAgent(swarms, 'nope'), 'unknown session').toBeUndefined();
  });
});

describe('approvals', () => {
  const request = { subtype: 'can_use_tool' as const, tool_name: 'Bash', input: { command: 'npm test' }, permission_suggestions: [{ type: 'addRules', behavior: 'allow', destination: 'session', rules: [] }] };
  const payload: SwarmApprovalPayload = { swarmId: 's1', agent: 'impl', requestId: 'r1', request, permissionMode: 'auto', expiresAt: '2026-11-21T09:00:00.000Z' };

  it('reads a swarm approval payload and refuses anything else', () => {
    expect(readApprovalPayload(payload)?.requestId, 'valid').toBe('r1');
    expect(readApprovalPayload(null), 'null').toBeUndefined();
    expect(readApprovalPayload({ toolInput: {} }), 'a hook payload').toBeUndefined();
    expect(readApprovalPayload({ ...payload, request: null }), 'no request').toBeUndefined();
    expect(readApprovalPayload({ ...payload, request: { input: {} } }), 'no tool name').toBeUndefined();
  });

  it('offers Always only when the manager takes it, the request suggests a session rule and the call needs no closer look', () => {
    expect(approvalButtons(payload, false).always, 'hidden while the manager does not take it').toBe(false);
    expect(approvalButtons(payload, true).always, 'shown with a session rule').toBe(true);
    expect(approvalButtons({ ...payload, request: { ...request, permission_suggestions: [{ type: 'setMode', mode: 'acceptEdits' }] } }, true).always, 'a mode suggestion is not a rule').toBe(false);
    expect(approvalButtons({ ...payload, request: { ...request, permission_suggestions: [{ type: 'addRules', behavior: 'allow', destination: 'userSettings' }] } }, true).always, 'a settings-file rule is not a session rule').toBe(false);
    expect(approvalButtons({ ...payload, inspector: { classId: 'app.agent_start.approve' } }, true).always, 'an approve class').toBe(false);
    expect(hasSessionRuleSuggestion({}), 'no suggestions').toBe(false);
    expect(hasSessionRuleSuggestion({ permission_suggestions: [null, 3] }), 'junk suggestions').toBe(false);
  });

  it('words the time until the automatic denial', () => {
    const now = Date.parse('2026-11-21T08:00:00.000Z');
    expect(expiryText('2026-11-21T08:47:00.000Z', now), 'minutes').toBe('denied automatically in 47 minutes');
    expect(expiryText('2026-11-21T08:01:00.000Z', now), 'one minute').toBe('denied automatically in 1 minute');
    expect(expiryText('2026-11-21T08:00:30.000Z', now), 'seconds').toBe('denied automatically in under a minute');
    expect(expiryText('2026-11-21T11:00:00.000Z', now), 'hours').toBe('denied automatically in 3 hours');
    expect(expiryText('2026-11-21T07:00:00.000Z', now), 'past').toBe('the app denies it any moment');
    expect(expiryText('soon', now), 'unreadable').toBe('');
  });
});
