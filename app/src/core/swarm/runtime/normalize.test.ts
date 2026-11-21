import { describe, expect, it } from 'vitest';
import { normalizeMessage } from './normalize';

const S = 'session-1';

// Lines cut from the P30 to P35 probe logs: paths, ids and fields the app does not read are removed or replaced.
const INIT = {
  type: 'system',
  subtype: 'init',
  cwd: '/work',
  session_id: S,
  tools: ['Bash', 'Read', 'Write'],
  mcp_servers: [],
  model: 'claude-haiku-5-5',
  permissionMode: 'default',
  apiKeySource: 'none',
  slash_commands: ['x'],
};
const ASSISTANT_TEXT = {
  type: 'assistant',
  message: {
    model: 'claude-haiku-5-5',
    id: 'msg_01',
    role: 'assistant',
    content: [
      { type: 'text', text: 'Hello ' },
      { type: 'text', text: 'there' },
    ],
    usage: {
      input_tokens: 4,
      cache_creation_input_tokens: 251,
      cache_read_input_tokens: 7020,
      output_tokens: 122,
      cache_creation: {
        ephemeral_5m_input_tokens: 0,
        ephemeral_1h_input_tokens: 251,
      },
    },
  },
  session_id: S,
};
const CAN_USE_TOOL = {
  type: 'control_request',
  request_id: 'req-1',
  request: {
    subtype: 'can_use_tool',
    tool_name: 'Write',
    display_name: 'Write',
    input: { file_path: 'a.txt', content: 'one' },
    description: 'a.txt',
    permission_suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }],
    tool_use_id: 'toolu_01',
    agent_id: 'sub-1',
  },
};
const RESULT = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  num_turns: 3,
  result: 'done',
  total_cost_usd: 0.0015858,
  terminal_reason: 'completed',
  permission_denials: [
    {
      tool_name: 'Write',
      tool_use_id: 'toolu_01',
      tool_input: { file_path: 'a.txt' },
    },
  ],
  modelUsage: { 'claude-haiku-5-5': { costUSD: 0.0015858 } },
};

describe('normalizeMessage', () => {
  it('reads the mode the CLI reports, the model, the key source and the tool names from system/init', () => {
    expect(normalizeMessage(S, INIT), 'init event').toEqual([
      {
        type: 'init',
        sessionId: S,
        permissionMode: 'default',
        model: 'claude-haiku-5-5',
        apiKeySource: 'none',
        tools: ['Bash', 'Read', 'Write'],
      },
    ]);
  });

  it('reports an unknown mode when init carries none, so the manager does not read it as the requested one', () => {
    expect(normalizeMessage(S, { type: 'system', subtype: 'init' }), 'no mode').toMatchObject([{ type: 'init', permissionMode: 'unknown', model: '', tools: [] }]);
  });

  it('ignores other system messages', () => {
    expect(normalizeMessage(S, { type: 'system', subtype: 'task_updated' }), 'no event').toEqual([]);
  });

  it('joins the text blocks of an assistant message and maps its usage, with the cache write split of the CLI', () => {
    expect(normalizeMessage(S, ASSISTANT_TEXT), 'assistant event').toEqual([
      {
        type: 'assistant',
        sessionId: S,
        messageId: 'msg_01',
        model: 'claude-haiku-5-5',
        usage: {
          input: 4,
          output: 122,
          cacheWrite5m: 0,
          cacheWrite1h: 251,
          cacheRead: 7020,
        },
        text: 'Hello there',
        toolNames: [],
      },
    ]);
  });

  it('lists the tools an assistant message calls and leaves the text out when there is none', () => {
    const raw = {
      type: 'assistant',
      message: {
        id: 'msg_02',
        model: 'm',
        content: [
          { type: 'tool_use', id: 't', name: 'Bash', input: {} },
          { type: 'tool_use', id: 'u' },
        ],
      },
    };
    expect(normalizeMessage(S, raw), 'tool names').toMatchObject([{ text: undefined, toolNames: ['Bash', 'unknown'], usage: undefined }]);
  });

  it('skips an assistant message without an id', () => {
    expect(normalizeMessage(S, { type: 'assistant', message: { content: [] } }), 'no event').toEqual([]);
  });

  it('keeps the whole can_use_tool request, including keys the app does not know', () => {
    const [event] = normalizeMessage(S, CAN_USE_TOOL);
    expect(event, 'permission request').toMatchObject({
      type: 'permission_request',
      requestId: 'req-1',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Write',
        agent_id: 'sub-1',
        tool_use_id: 'toolu_01',
        input: { file_path: 'a.txt', content: 'one' },
      },
    });
    expect(event?.type === 'permission_request' && event.request.permission_suggestions, 'suggestions are kept').toHaveLength(1);
  });

  it('gives a request without an input an empty input and drops one without a tool name', () => {
    const request = (body: object) => ({
      type: 'control_request',
      request_id: 'r',
      request: { subtype: 'can_use_tool', ...body },
    });
    expect(normalizeMessage(S, request({ tool_name: 'Read' })), 'input defaults').toMatchObject([{ request: { input: {} } }]);
    expect(normalizeMessage(S, request({})), 'no tool name').toEqual([]);
  });

  it('does not make an approval of other control requests', () => {
    expect(
      normalizeMessage(S, {
        type: 'control_request',
        request_id: 'r',
        request: { subtype: 'hook_callback' },
      }),
      'no event',
    ).toEqual([]);
  });

  it('maps control_cancel_request to a cancelled permission request', () => {
    expect(
      normalizeMessage(S, {
        type: 'control_cancel_request',
        request_id: 'req-1',
      }),
      'cancel',
    ).toEqual([{ type: 'permission_cancelled', sessionId: S, requestId: 'req-1' }]);
    expect(normalizeMessage(S, { type: 'control_cancel_request' }), 'no id').toEqual([]);
  });

  it('reads cost, turns, text, reason and denials from a result', () => {
    expect(normalizeMessage(S, RESULT), 'result event').toMatchObject([
      {
        type: 'result',
        result: {
          subtype: 'success',
          isError: false,
          terminalReason: 'completed',
          totalCostUsd: 0.0015858,
          numTurns: 3,
          text: 'done',
          errors: [],
          interrupted: false,
          permissionDenials: [{ tool_name: 'Write' }],
        },
      },
    ]);
  });

  it('drops the diagnostic lines of a result and treats an empty text as none', () => {
    const raw = {
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      result: '',
      terminal_reason: 'aborted_streaming',
      errors: ['[ede_diagnostic] result_type=user', 'Reached maximum turns (1)'],
    };
    expect(normalizeMessage(S, raw), 'result event').toMatchObject([
      {
        result: {
          isError: true,
          text: undefined,
          errors: ['Reached maximum turns (1)'],
          terminalReason: 'aborted_streaming',
          totalCostUsd: 0,
          permissionDenials: [],
        },
      },
    ]);
  });

  it('carries the rate limit info as it is', () => {
    const info = {
      status: 'allowed',
      rateLimitType: 'five_hour',
      unifiedWindows: { five_hour: { utilization: 0.03 } },
    };
    expect(normalizeMessage(S, { type: 'rate_limit_event', rate_limit_info: info }), 'rate limit').toEqual([{ type: 'rate_limit', sessionId: S, info }]);
    expect(normalizeMessage(S, { type: 'rate_limit_event' }), 'no info').toEqual([]);
  });

  it('produces no event for types it does not know', () => {
    expect(normalizeMessage(S, { type: 'stream_event', event: {} }), 'partial message').toEqual([]);
    expect(normalizeMessage(S, { type: 'user', message: {} }), 'tool result').toEqual([]);
    expect(normalizeMessage(S, { type: 'something_new' }), 'future type').toEqual([]);
  });
});
