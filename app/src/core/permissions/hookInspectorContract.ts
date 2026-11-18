import { describe, expect, it } from 'vitest';
import type { ActionClassId, ActionClassTable, GateFile, HookInspector, OutwardMode, PreToolUsePayload } from './types';

export interface InspectorUnderTest {
  readonly inspector: HookInspector;
  /** The class table the implementation ships (0028 section 2). */
  readonly table: ActionClassTable;
}

const payload = (tool_name: string, tool_input: unknown): PreToolUsePayload => ({
  hook_event_name: 'PreToolUse',
  session_id: 's1',
  permission_mode: 'auto',
  tool_name,
  tool_input,
});
const bash = (command: string, extra: object = {}) => payload('Bash', { command, ...extra });

/**
 * Behaviour every `HookInspector` shows (0028 section 3). `pending` skips the suite with a `[pending <owner>]`
 * title while the implementation is a stub.
 */
export function describeHookInspectorContract(name: string, create: () => InspectorUnderTest, options: { readonly pending?: string } = {}): void {
  const suite = options.pending === undefined ? describe : describe.skip;
  suite(`${name} (HookInspector contract)${options.pending === undefined ? '' : ` [pending ${options.pending}]`}`, () => {
    const gate = (table: ActionClassTable, outward: Partial<Record<ActionClassId, OutwardMode>> = {}): GateFile => ({
      schema: 1,
      sessionId: 's1',
      table,
      outward,
      allowedHosts: ['github.com'],
      inboxDir: '/inbox',
    });
    const decide = (call: PreToolUsePayload, outward: Partial<Record<ActionClassId, OutwardMode>> = {}) => {
      const { inspector, table } = create();
      return inspector.inspect(call, gate(table, outward));
    };

    it('asks for git push in every form the CLI rules miss', () => {
      for (const command of ['git push origin main', 'cd repo && git push', 'git -C /repo push', 'sh -c "git push"', 'env A=1 git -c x=y push']) {
        expect(decide(bash(command)), command).toMatchObject({ decision: 'ask', classId: 'git.push' });
      }
    });

    it('records reads without a decision', () => {
      expect(decide(bash('gh pr view 12 --repo a/b')), 'gh pr view').toMatchObject({ decision: 'none', classId: 'read' });
      expect(decide(payload('mcp__claude_ai_Atlassian__getJiraIssue', { issueIdOrKey: 'ABC-1' })), 'connector read').toMatchObject({ decision: 'none' });
    });

    it('asks for a command it cannot read and for a per-command host list', () => {
      expect(decide(bash('eval "$X"')), 'eval').toMatchObject({ decision: 'ask', classId: 'shell.opaque' });
      expect(decide(bash('curl https://example.com', { allowed_domains: ['example.com'] })), 'allowed_domains input').toMatchObject({ decision: 'ask', classId: 'shell.opaque' });
    });

    it('classes connector, app and unknown MCP tools by server and name', () => {
      expect(decide(payload('mcp__claude_ai_Slack__slack_send_message', {})), 'Slack send').toMatchObject({ decision: 'ask', classId: 'slack.send' });
      expect(decide(payload('mcp__claude_ai_Other__create_thing', {})), 'unknown connector write').toMatchObject({ decision: 'ask', classId: 'connector.unknown' });
      expect(decide(payload('mcp__claude_ai_Other__get_thing', {})), 'unknown connector read prefix').toMatchObject({ decision: 'none' });
      expect(decide(payload('mcp__app__task_start', {})), 'agent task start').toMatchObject({ decision: 'ask', classId: 'app.agent_start' });
      expect(decide(payload('mcp__app__ui_list_tree', {})), 'own app tool').toMatchObject({ decision: 'none' });
      expect(decide(payload('mcp__someserver__delete_everything', {})), 'user MCP write').toMatchObject({ decision: 'ask', classId: 'mcp.other' });
    });

    it('asks for HTTP writes and follows the profile overrides', () => {
      expect(decide(bash('curl -X POST https://api.example.com/x -d a=1')), 'curl write').toMatchObject({ decision: 'ask', classId: 'http.write' });
      expect(decide(bash('git push'), { 'git.push': 'deny' }), 'deny override').toMatchObject({ decision: 'deny', classId: 'git.push' });
      expect(decide(payload('mcp__claude_ai_Slack__slack_send_message', {}), { 'slack.send': 'allow' }), 'allow override').toMatchObject({ decision: 'none' });
    });

    it('never answers allow', () => {
      const calls = [bash('ls'), bash('git push'), payload('Read', { file_path: '/x' }), payload('mcp__app__ui_list_tree', {})];
      for (const call of calls) expect(decide(call, { 'git.push': 'allow' }).decision, call.tool_name).not.toBe('allow');
    });
  });
}
