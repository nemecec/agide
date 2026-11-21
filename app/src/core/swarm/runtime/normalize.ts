import { tokenUsageFrom } from '../../agents/normalise/transcriptAdapter';
import { asRecord, num, str, type Json } from '../../agents/normalise/payload';
import type { SessionId } from '../../session/types';
import type { CanUseToolRequest, RuntimeEvent, TurnResult } from './types';

const DIAGNOSTIC_PREFIX = '[ede_diagnostic]';

/**
 * Turns one parsed stdout message of `claude -p --output-format stream-json` into the runtime events the
 * manager reads (0038). Messages of other types, and fields the app does not know, produce no event; the caller
 * passes the raw message on separately. The `interrupted` flag of a result is the runtime's to set.
 */
export function normalizeMessage(sessionId: SessionId, raw: Json): RuntimeEvent[] {
  switch (raw['type']) {
    case 'system':
      return raw['subtype'] === 'init' ? [initEvent(sessionId, raw)] : [];
    case 'assistant':
      return assistantEvent(sessionId, raw);
    case 'control_request':
      return permissionRequest(sessionId, raw);
    case 'control_cancel_request': {
      const requestId = str(raw['request_id']);
      return requestId === undefined ? [] : [{ type: 'permission_cancelled', sessionId, requestId }];
    }
    case 'result':
      return [{ type: 'result', sessionId, result: turnResult(raw) }];
    case 'rate_limit_event': {
      const info = asRecord(raw['rate_limit_info']);
      return info === undefined ? [] : [{ type: 'rate_limit', sessionId, info }];
    }
    default:
      return [];
  }
}

function initEvent(sessionId: SessionId, raw: Json): RuntimeEvent {
  const tools = Array.isArray(raw['tools']) ? raw['tools'].filter((tool): tool is string => typeof tool === 'string') : [];
  return {
    type: 'init',
    sessionId,
    permissionMode: str(raw['permissionMode']) ?? 'unknown',
    model: str(raw['model']) ?? '',
    apiKeySource: str(raw['apiKeySource']),
    tools,
  };
}

function assistantEvent(sessionId: SessionId, raw: Json): RuntimeEvent[] {
  const message = asRecord(raw['message']);
  const messageId = str(message?.['id']);
  if (message === undefined || messageId === undefined) return [];
  const blocks = Array.isArray(message['content']) ? message['content'].map(asRecord) : [];
  const texts = blocks.flatMap((block) => (block?.['type'] === 'text' && typeof block['text'] === 'string' ? [block['text']] : []));
  const toolNames = blocks.flatMap((block) => (block?.['type'] === 'tool_use' ? [str(block['name']) ?? 'unknown'] : []));
  return [
    {
      type: 'assistant',
      sessionId,
      messageId,
      model: str(message['model']) ?? '',
      usage: tokenUsageFrom(message['usage']),
      text: texts.length === 0 ? undefined : texts.join(''),
      toolNames,
    },
  ];
}

function permissionRequest(sessionId: SessionId, raw: Json): RuntimeEvent[] {
  const requestId = str(raw['request_id']);
  const request = asRecord(raw['request']);
  if (requestId === undefined || request?.['subtype'] !== 'can_use_tool') return [];
  const toolName = str(request['tool_name']);
  if (toolName === undefined) return [];
  return [
    {
      type: 'permission_request',
      sessionId,
      requestId,
      request: {
        ...request,
        subtype: 'can_use_tool',
        tool_name: toolName,
        input: asRecord(request['input']) ?? {},
      } as CanUseToolRequest,
    },
  ];
}

function turnResult(raw: Json): TurnResult {
  const errors = Array.isArray(raw['errors']) ? raw['errors'].filter((error): error is string => typeof error === 'string' && !error.startsWith(DIAGNOSTIC_PREFIX)) : [];
  return {
    subtype: str(raw['subtype']) ?? 'unknown',
    isError: raw['is_error'] === true,
    terminalReason: str(raw['terminal_reason']),
    totalCostUsd: num(raw['total_cost_usd']) ?? 0,
    numTurns: num(raw['num_turns']) ?? 0,
    text: str(raw['result']),
    errors,
    permissionDenials: Array.isArray(raw['permission_denials']) ? raw['permission_denials'] : [],
    interrupted: false,
  };
}
