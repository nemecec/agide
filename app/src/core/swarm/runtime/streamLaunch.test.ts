import { describe, expect, it } from 'vitest';
import { streamContribution, STREAM_JSON_FLAGS } from './streamLaunch';
import type { AgentLaunchSpec } from './types';

const SPEC: AgentLaunchSpec = {
  sessionId: 's1',
  folderId: 'f1',
  title: 'agent',
  cwd: '/work',
  model: 'haiku',
  effort: 'low',
  permissionMode: 'auto',
  maxBudgetUsd: 0.25,
  maxTurnsPerMessage: 12,
  connectors: false,
  denyRules: [],
  addDirs: [],
  firstMessage: 'go',
};
const mapped = (path: string) => `/env${path}`;

describe('streamContribution', () => {
  it('starts claude as a stream-json process that asks the app for approvals, and never as --bare', () => {
    const { args } = streamContribution(SPEC, mapped);
    expect(args?.slice(0, STREAM_JSON_FLAGS.length), 'stream-json flags first').toEqual([...STREAM_JSON_FLAGS]);
    expect(args, 'flags of the P30 setup').toEqual(
      expect.arrayContaining(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio']),
    );
    expect(args, 'the subscription login needs a non-bare process').not.toContain('--bare');
    expect(args, 'partial messages are not wanted').not.toContain('--include-partial-messages');
  });

  it('passes the tier model and effort, the budget reservation and the turn limit', () => {
    const { args } = streamContribution(SPEC, mapped);
    expect(args, 'model, effort, budget, turns').toEqual(expect.arrayContaining(['--model', 'haiku', '--effort', 'low', '--max-budget-usd', '0.25', '--max-turns', '12']));
  });

  it('adds --strict-mcp-config unless the agent may use connectors', () => {
    expect(streamContribution(SPEC, mapped).args, 'no connectors').toContain('--strict-mcp-config');
    expect(streamContribution({ ...SPEC, connectors: true }, mapped).args, 'connectors').not.toContain('--strict-mcp-config');
  });

  it('limits the tools when the spec names them and maps each added directory into the environment', () => {
    const { args } = streamContribution({ ...SPEC, tools: ['Read', 'Grep'], addDirs: ['/inputs', '/more'] }, mapped);
    expect(args, 'tools').toEqual(expect.arrayContaining(['--tools', 'Read,Grep']));
    expect(args?.join(' '), 'directories').toContain('--add-dir /env/inputs --add-dir /env/more');
    expect(streamContribution(SPEC, mapped).args, 'default tool set').not.toContain('--tools');
  });

  it('contributes deny rules as settings only when there are some', () => {
    expect(streamContribution(SPEC, mapped).settings, 'no rules').toBeUndefined();
    expect(streamContribution({ ...SPEC, denyRules: ['Edit(/src/**)'] }, mapped).settings, 'rules').toEqual({ permissions: { deny: ['Edit(/src/**)'] } });
  });

  it('keeps native subagents on the agent model and lets the spec override a variable', () => {
    expect(streamContribution(SPEC, mapped).env, 'default variables').toEqual({
      CLAUDE_CODE_SUBAGENT_MODEL: 'haiku',
      CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1',
    });
    expect(streamContribution({ ...SPEC, env: { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet', X: '1' } }, mapped).env, 'spec wins').toEqual({
      CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet',
      CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1',
      X: '1',
    });
  });
});
