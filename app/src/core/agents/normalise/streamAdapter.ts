import type { SessionId } from '../../session/types';
import { APP_STARTED_AGENT_KEY, MAIN_AGENT_KEY, type AgentFact, type AgentOutcome, type AgentRef } from '../types';
import { asRecord, defined, num, str, type Json } from './payload';

interface WorkflowEntry {
  state?: string;
  queued: boolean;
  agentId?: string;
}

interface StreamState {
  /** Request ids of open `can_use_tool` requests and the agent key they were attributed to. */
  requests: Map<string, string>;
  /** Agents whose last permission request the app denied. */
  denied: Set<string>;
  workflows: Map<string, Map<number, WorkflowEntry>>;
  running: Set<string>;
}

const END_STATUS: Record<string, AgentOutcome> = { completed: 'completed', failed: 'failed', stopped: 'stopped', killed: 'stopped', cancelled: 'stopped' };

/**
 * Turns the stream-json messages of an app-started `claude -p` process into agent facts (0027 section 1).
 * `sessionId` is the process's own session; subagents of that process become agent records under it, and the
 * process itself is the record with the agent key `session`. Applies to the app's control responses too.
 */
export class StreamNormaliser {
  private readonly state: StreamState = { requests: new Map(), denied: new Set(), workflows: new Map(), running: new Set() };

  constructor(private readonly sessionId: SessionId) {}

  /** The process started; its own row is `running` until the process exits. */
  processStarted(at: string, details: { description?: string } = {}): AgentFact[] {
    return [{ kind: 'started', ref: this.ref(APP_STARTED_AGENT_KEY), at, ...defined(details) }];
  }

  /** One parsed stdout message. */
  message(raw: unknown, at: string): AgentFact[] {
    const message = asRecord(raw);
    if (!message) return [];
    switch (message['type']) {
      case 'system':
        return this.system(message, at);
      case 'control_request':
        return this.controlRequest(message, at);
      case 'result':
        return this.result(message, at);
      case 'rate_limit_event':
        return this.rateLimit(message, at);
      default:
        return [];
    }
  }

  /** The app answered a `can_use_tool` request. A deny is remembered so the agent's end reads `denied`. */
  controlResponse(requestId: string, decision: 'allow' | 'deny', at: string): AgentFact[] {
    const agentKey = this.state.requests.get(requestId);
    if (agentKey === undefined) return [];
    this.state.requests.delete(requestId);
    if (decision === 'deny') this.state.denied.add(agentKey);
    return [{ kind: 'answered', ref: this.ref(agentKey), at, requestKey: requestId }];
  }

  /** The process exited: everything still open ends. `stopped` when the app asked for it. */
  exited(at: string, options: { stopped?: boolean } = {}): AgentFact[] {
    const facts: AgentFact[] = [];
    for (const agentKey of this.state.running) {
      facts.push({ kind: 'ended', ref: this.ref(agentKey), at, outcome: 'lost', basis: 'derived' });
    }
    this.state.running.clear();
    facts.push({
      kind: 'ended',
      ref: this.ref(APP_STARTED_AGENT_KEY),
      at,
      outcome: options.stopped ? 'stopped' : 'completed',
      basis: options.stopped ? 'reported' : 'derived',
    });
    return facts;
  }

  private system(message: Json, at: string): AgentFact[] {
    switch (message['subtype']) {
      case 'task_started':
        return this.taskStarted(message, at);
      case 'task_progress':
        return this.taskProgress(message, at);
      case 'task_updated': {
        const status = str(asRecord(message['patch'])?.['status']);
        return status === undefined || END_STATUS[status] === undefined ? [] : this.end(message, status, at);
      }
      case 'task_notification': {
        const status = str(message['status']);
        return status === undefined ? [] : this.end(message, status, at);
      }
      default:
        return [];
    }
  }

  private taskStarted(message: Json, at: string): AgentFact[] {
    const taskId = str(message['task_id']);
    if (taskId === undefined) return [];
    if (message['task_type'] === 'local_workflow') {
      this.state.workflows.set(taskId, new Map());
      const key = `wf:${taskId}`;
      this.state.running.add(key);
      return [
        {
          kind: 'started',
          ref: this.ref(key),
          at,
          ...defined({ description: str(message['workflow_name']) ?? str(message['description']), toolUseId: str(message['tool_use_id']) }),
        },
      ];
    }
    this.state.running.add(taskId);
    return [
      {
        kind: 'started',
        ref: this.ref(taskId),
        at,
        agentId: taskId,
        ...defined({
          agentType: str(message['subagent_type']),
          description: str(message['description']),
          toolUseId: str(message['tool_use_id']),
          backgrounded: message['is_backgrounded'] === true ? true : undefined,
        }),
      },
    ];
  }

  private taskProgress(message: Json, at: string): AgentFact[] {
    const taskId = str(message['task_id']);
    if (taskId === undefined) return [];
    const workflow = message['workflow_progress'];
    if (Array.isArray(workflow)) return this.workflowProgress(taskId, workflow, at);
    return [{ kind: 'progress', ref: this.ref(taskId), at, ...defined({ lastTool: str(message['last_tool_name']), text: str(message['description']) }) }];
  }

  /** The cumulative array is diffed against the previous copy: each entry's first sight and its move to `done`. */
  private workflowProgress(taskId: string, entries: unknown[], at: string): AgentFact[] {
    const known = this.state.workflows.get(taskId) ?? new Map<number, WorkflowEntry>();
    this.state.workflows.set(taskId, known);
    const facts: AgentFact[] = [];
    for (const raw of entries) {
      const entry = asRecord(raw);
      if (!entry || entry['type'] !== 'workflow_agent') continue;
      const index = num(entry['index']);
      if (index === undefined) continue;
      const key = `wf:${taskId}:${index}`;
      const previous = known.get(index);
      const state = str(entry['state']);
      const queued = entry['startedAt'] === undefined && entry['queuedAt'] !== undefined;
      const agentId = str(entry['agentId']);
      const workflow = { taskId, index, ...defined({ label: str(entry['label']), phase: str(entry['phaseTitle']) }) };
      if (previous === undefined || (previous.queued && !queued)) {
        facts.push({ kind: 'started', ref: this.ref(key), at, ...defined({ agentId, description: str(entry['label']), queued: queued ? true : undefined }), workflow });
        this.state.running.add(key);
      } else if (agentId !== undefined && previous.agentId === undefined) {
        facts.push({ kind: 'linked', ref: this.ref(key), agentId });
      }
      if (state === 'done' && previous?.state !== 'done') {
        facts.push({ kind: 'ended', ref: this.ref(key), at, outcome: 'completed', basis: 'reported', ...defined({ summary: str(entry['resultPreview']), totalTokens: num(entry['tokens']) }) });
        this.state.running.delete(key);
      }
      known.set(index, { ...(state === undefined ? {} : { state }), queued, ...(agentId === undefined ? {} : { agentId }) });
    }
    return facts;
  }

  private end(message: Json, status: string, at: string): AgentFact[] {
    const taskId = str(message['task_id']);
    const reported = END_STATUS[status];
    if (taskId === undefined || reported === undefined) return [];
    const key = this.state.workflows.has(taskId) ? `wf:${taskId}` : taskId;
    const denied = this.state.denied.delete(key);
    this.state.running.delete(key);
    // A host denial ends the task as `completed` (P5), so the app's own record decides.
    const outcome: AgentOutcome = denied && reported === 'completed' ? 'denied' : reported;
    const usage = asRecord(message['usage']);
    return [
      {
        kind: 'ended',
        ref: this.ref(key),
        at,
        outcome,
        basis: denied && reported === 'completed' ? 'derived' : 'reported',
        ...defined({ summary: str(message['summary']), totalTokens: num(usage?.['total_tokens']) }),
      },
    ];
  }

  private controlRequest(message: Json, at: string): AgentFact[] {
    const request = asRecord(message['request']);
    const requestId = str(message['request_id']);
    if (!request || request['subtype'] !== 'can_use_tool' || requestId === undefined) return [];
    const agentId = str(request['agent_id']);
    const exact = agentId !== undefined && this.state.running.has(agentId);
    const agentKey = exact ? agentId : MAIN_AGENT_KEY;
    this.state.requests.set(requestId, exact ? agentId : APP_STARTED_AGENT_KEY);
    // The process's own conversation is the `session` row, not `main`: the process is the agent.
    return [
      {
        kind: 'waiting',
        ref: this.ref(exact ? agentKey : APP_STARTED_AGENT_KEY),
        at,
        requestKey: requestId,
        attribution: exact ? 'exact' : 'session',
        ...defined({ toolName: str(request['tool_name']) }),
      },
    ];
  }

  private result(message: Json, at: string): AgentFact[] {
    const cost = num(message['total_cost_usd']);
    return cost === undefined ? [] : [{ kind: 'session-cost', sessionId: this.sessionId, at, costUsd: cost, basis: 'result' }];
  }

  private rateLimit(message: Json, at: string): AgentFact[] {
    const windows = asRecord(asRecord(message['rate_limit_info'])?.['unifiedWindows']);
    const facts: AgentFact[] = [];
    for (const window of ['five_hour', 'seven_day'] as const) {
      const entry = asRecord(windows?.[window]);
      const utilization = num(entry?.['utilization']);
      const resetsAt = num(entry?.['resetsAt']);
      if (utilization === undefined || resetsAt === undefined) continue;
      facts.push({ kind: 'plan', at, window, usedPercentage: Math.round(utilization * 10000) / 100, resetsAt: new Date(resetsAt * 1000).toISOString(), source: 'rate-limit-event' });
    }
    return facts;
  }

  private ref(agentKey: string): AgentRef {
    return { sessionId: this.sessionId, agentKey };
  }
}
