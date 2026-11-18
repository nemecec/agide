import { dirname, join } from 'node:path';
import { requestHash } from '../../inbox/itemText';
import type { SessionId } from '../../session/types';
import { MAIN_AGENT_KEY, type AgentFact, type AgentRef } from '../types';
import { parseTaskNotification } from './taskNotification';
import { asRecord, defined, str } from './payload';

interface OpenRequest {
  readonly agentKey: string;
  readonly toolName: string;
  readonly inputHash: string;
}

interface SessionState {
  /** `Agent` tool calls seen before their `SubagentStart`, oldest first. */
  queued: { toolUseId: string; description: string }[];
  /** Agents started and not ended. */
  running: Set<string>;
  /** Every agent id seen at `SubagentStart`; a stop for another id is an internal agent. */
  known: Set<string>;
  requests: Map<string, OpenRequest>;
  handback: Map<string, string>;
  toolUseIds: Map<string, string>;
  transcriptPath?: string;
  sessionDir?: string;
}

const AGENT_TOOLS = new Set(['Agent', 'Task']);

/**
 * Turns the hook payloads of the PTY path into agent facts (0027 section 1). It holds the small per-session
 * tables the mapping needs (queued tool calls, open requests, running ids) and does no I/O. The caller applies
 * the returned facts to the store in order.
 */
export class HookNormaliser {
  private readonly sessions = new Map<SessionId, SessionState>();

  handle(sessionId: SessionId, hookEvent: string, payload: unknown, at: string): AgentFact[] {
    const body = asRecord(payload);
    if (!body) return [];
    const state = this.stateOf(sessionId, body);
    switch (hookEvent) {
      case 'SubagentStart':
        return this.subagentStart(sessionId, state, body, at);
      case 'SubagentStop':
        return this.subagentStop(sessionId, state, body, at);
      case 'PreToolUse':
        return this.preToolUse(sessionId, state, body, at);
      case 'PostToolUse':
        return this.postToolUse(sessionId, state, body, at);
      case 'PermissionRequest':
        return this.permissionRequest(sessionId, state, body, at);
      case 'UserPromptSubmit':
        return this.promptSubmit(sessionId, state, body, at);
      case 'Stop':
      case 'StopFailure':
        return this.answerAll(sessionId, state, at);
      case 'SessionEnd':
        return this.answerAll(sessionId, state, at);
      default:
        return [];
    }
  }

  /** The process ended: agents still open end as `lost` unless their metadata says they finished. */
  exited(sessionId: SessionId, at: string, finished: (agentId: string) => boolean = () => false): AgentFact[] {
    const state = this.sessions.get(sessionId);
    if (!state) return [];
    const facts: AgentFact[] = this.answerAll(sessionId, state, at);
    for (const agentId of state.running) {
      facts.push({ kind: 'ended', ref: ref(sessionId, agentId), at, outcome: finished(agentId) ? 'completed' : 'lost', basis: 'derived' });
    }
    state.running.clear();
    state.queued = [];
    return facts;
  }

  forget(sessionId: SessionId): void {
    this.sessions.delete(sessionId);
  }

  /** The `.meta.json` path of an agent, from the session transcript path seen in any payload. */
  agentFiles(sessionId: SessionId, agentId: string): { transcript: string; meta: string } | undefined {
    const dir = this.sessions.get(sessionId)?.sessionDir;
    if (dir === undefined) return undefined;
    return { transcript: join(dir, 'subagents', `agent-${agentId}.jsonl`), meta: join(dir, 'subagents', `agent-${agentId}.meta.json`) };
  }

  private stateOf(sessionId: SessionId, body: ReturnType<typeof asRecord> & object): SessionState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = { queued: [], running: new Set(), known: new Set(), requests: new Map(), handback: new Map(), toolUseIds: new Map() };
      this.sessions.set(sessionId, state);
    }
    const transcript = str(body['transcript_path']);
    if (transcript !== undefined && transcript !== state.transcriptPath) {
      state.transcriptPath = transcript;
      state.sessionDir = join(dirname(transcript), sessionId);
    }
    return state;
  }

  private subagentStart(sessionId: SessionId, state: SessionState, body: Record<string, unknown>, at: string): AgentFact[] {
    const agentId = str(body['agent_id']);
    if (agentId === undefined) return [];
    state.known.add(agentId);
    state.running.add(agentId);
    const queued = state.queued.shift();
    if (queued) state.toolUseIds.set(agentId, queued.toolUseId);
    const files = this.agentFiles(sessionId, agentId);
    return [
      {
        kind: 'started',
        ref: ref(sessionId, agentId),
        at,
        agentId,
        ...defined({
          agentType: str(body['agent_type']),
          description: queued?.description,
          toolUseId: queued?.toolUseId,
          transcriptPath: files?.transcript,
        }),
      },
    ];
  }

  private subagentStop(sessionId: SessionId, state: SessionState, body: Record<string, unknown>, at: string): AgentFact[] {
    const agentId = str(body['agent_id']);
    // Internal agents stop without ever starting (P5, P13).
    if (agentId === undefined || !state.known.has(agentId)) return [];
    state.running.delete(agentId);
    const facts: AgentFact[] = this.answerFor(sessionId, state, agentId, at);
    facts.push({
      kind: 'ended',
      ref: ref(sessionId, agentId),
      at,
      outcome: 'completed',
      basis: 'derived',
      ...defined({
        summary: state.handback.get(agentId) ?? str(body['last_assistant_message']),
        transcriptPath: str(body['agent_transcript_path']),
      }),
    });
    return facts;
  }

  private preToolUse(sessionId: SessionId, state: SessionState, body: Record<string, unknown>, at: string): AgentFact[] {
    const tool = str(body['tool_name']);
    const input = asRecord(body['tool_input']);
    const agentId = str(body['agent_id']);
    if (tool !== undefined && AGENT_TOOLS.has(tool)) {
      const toolUseId = str(body['tool_use_id']);
      if (toolUseId !== undefined) state.queued.push({ toolUseId, description: str(input?.['description']) ?? '' });
      return [];
    }
    if (tool === 'SubagentHandback' && agentId !== undefined) {
      const message = str(input?.['message']);
      if (message !== undefined) state.handback.set(agentId, message);
      return [];
    }
    return this.answerMatching(sessionId, state, body, at);
  }

  private postToolUse(sessionId: SessionId, state: SessionState, body: Record<string, unknown>, at: string): AgentFact[] {
    const tool = str(body['tool_name']);
    if (tool !== undefined && AGENT_TOOLS.has(tool)) {
      const response = asRecord(body['tool_response']);
      const agentId = str(response?.['agentId']);
      if (agentId === undefined) return [];
      const toolUseId = str(body['tool_use_id']);
      const description = str(response?.['description']) ?? str(asRecord(body['tool_input'])?.['description']);
      return [{ kind: 'linked', ref: ref(sessionId, agentId), agentId, ...defined({ toolUseId, description }) }];
    }
    return this.answerMatching(sessionId, state, body, at);
  }

  private permissionRequest(sessionId: SessionId, state: SessionState, body: Record<string, unknown>, at: string): AgentFact[] {
    const toolName = str(body['tool_name']) ?? '';
    const inputHash = requestHash(toolName, body['tool_input']);
    const agentId = str(body['agent_id']);
    const exact = agentId !== undefined && state.running.has(agentId);
    const agentKey = exact ? agentId : MAIN_AGENT_KEY;
    const requestKey = `${agentKey}:${inputHash}`;
    state.requests.set(requestKey, { agentKey, toolName, inputHash });
    return [{ kind: 'waiting', ref: ref(sessionId, agentKey), at, requestKey, toolName, attribution: exact ? 'exact' : 'session' }];
  }

  private promptSubmit(sessionId: SessionId, state: SessionState, body: Record<string, unknown>, at: string): AgentFact[] {
    const notification = parseTaskNotification(str(body['prompt']) ?? '');
    if (!notification) return this.answerAll(sessionId, state, at);
    const agentId = notification.taskId ?? [...state.toolUseIds].find(([, toolUseId]) => toolUseId === notification.toolUseId)?.[0];
    if (agentId === undefined || !state.known.has(agentId)) return [];
    const outcome = notification.status === 'failed' ? 'failed' : notification.status === 'stopped' ? 'stopped' : notification.status === 'completed' ? 'completed' : undefined;
    if (outcome === undefined) return [];
    return [
      {
        kind: 'ended',
        ref: ref(sessionId, agentId),
        at,
        outcome,
        basis: 'reported',
        ...defined({ summary: notification.summary, totalTokens: notification.subagentTokens }),
      },
    ];
  }

  private answerMatching(sessionId: SessionId, state: SessionState, body: Record<string, unknown>, at: string): AgentFact[] {
    const tool = str(body['tool_name']);
    if (tool === undefined) return [];
    const hash = requestHash(tool, body['tool_input']);
    const facts: AgentFact[] = [];
    for (const [key, request] of state.requests) {
      if (request.toolName !== tool || request.inputHash !== hash) continue;
      state.requests.delete(key);
      facts.push({ kind: 'answered', ref: ref(sessionId, request.agentKey), at, requestKey: key });
    }
    return facts;
  }

  private answerFor(sessionId: SessionId, state: SessionState, agentKey: string, at: string): AgentFact[] {
    const facts: AgentFact[] = [];
    for (const [key, request] of state.requests) {
      if (request.agentKey !== agentKey) continue;
      state.requests.delete(key);
      facts.push({ kind: 'answered', ref: ref(sessionId, agentKey), at, requestKey: key });
    }
    return facts;
  }

  private answerAll(sessionId: SessionId, state: SessionState, at: string): AgentFact[] {
    const keys = new Set([...state.requests.values()].map((request) => request.agentKey));
    state.requests.clear();
    return [...keys].map((agentKey) => ({ kind: 'answered' as const, ref: ref(sessionId, agentKey), at }));
  }
}

const ref = (sessionId: SessionId, agentKey: string): AgentRef => ({ sessionId, agentKey });
