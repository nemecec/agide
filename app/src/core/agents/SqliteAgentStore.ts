import type { Unsubscribe } from '../events/EventBus';
import type { SessionId } from '../session/types';
import { migrate, type Database } from '../store/Store';
import type { NodeId } from '../tree/types';
import { AGENTS_MODULE, agentMigrations } from './agentMigrations';
import { InMemoryAgentStore } from './InMemoryAgentStore';
import type { AgentFact, AgentOutcome, AgentRecord, AgentRef, AgentState, AgentStore, OutcomeBasis } from './types';
import { APP_STARTED_AGENT_KEY } from './types';

/** What the store keeps about the session an agent runs in. */
export interface SessionContext {
  readonly projectDir: string;
  readonly folderId: NodeId | null;
}

interface Row {
  id: string;
  session_id: string;
  agent_key: string;
  agent_id: string | null;
  parent_agent_id: string | null;
  workflow_task_id: string | null;
  workflow_index: number | null;
  folder_id: string | null;
  origin: string;
  agent_type: string | null;
  label: string | null;
  phase: string | null;
  description: string | null;
  state: AgentState;
  outcome: AgentOutcome | null;
  outcome_basis: OutcomeBasis | null;
  project_dir: string;
  transcript_path: string | null;
  summary: string | null;
  started_at: string;
  ended_at: string | null;
  updated_at: string;
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
}

const FLUSH_DELAY_MS = 500;
const cut = (value: string | undefined, max: number): string | null => (value === undefined ? null : value.slice(0, max));

/**
 * Agent records with write-through to the `agents` table (0027 section 4). The state logic is the in-memory
 * store's; this class loads the saved rows into it at start and writes changed rows after a short delay, and
 * at `flush`. The cache write split is not kept: a restored row holds the whole cache write as the 5-minute class.
 */
export class SqliteAgentStore implements AgentStore {
  private readonly inner: InMemoryAgentStore;
  private readonly dirty = new Set<string>();
  private readonly contexts = new Map<SessionId, SessionContext>();
  private timer: NodeJS.Timeout | undefined;
  private readonly off: Unsubscribe;

  constructor(
    private readonly db: Database,
    private readonly contextOf: (sessionId: SessionId) => SessionContext | undefined,
    now: () => number = Date.now,
  ) {
    migrate(db, AGENTS_MODULE, agentMigrations);
    this.inner = new InMemoryAgentStore(now);
    this.restore();
    this.off = this.inner.subscribe((records) => this.markDirty(records));
  }

  /** The folder and project directory saved for a session's rows, for history after the session is gone. */
  sessionContext(sessionId: SessionId): SessionContext | undefined {
    return this.contextOf(sessionId) ?? this.contexts.get(sessionId);
  }

  apply(fact: AgentFact): void {
    this.inner.apply(fact);
  }

  get(ref: AgentRef): AgentRecord | undefined {
    return this.inner.get(ref);
  }

  list(filter?: { readonly sessionId?: SessionId; readonly states?: readonly AgentState[] }): AgentRecord[] {
    return this.inner.list(filter);
  }

  waitingSessions(): SessionId[] {
    return this.inner.waitingSessions();
  }

  remove(ref: AgentRef): void {
    this.inner.remove(ref);
    this.db.prepare('DELETE FROM agents WHERE id = ?').run(`${ref.sessionId}:${ref.agentKey}`);
    this.dirty.delete(`${ref.sessionId}:${ref.agentKey}`);
  }

  subscribe(listener: (changed: readonly AgentRecord[]) => void): Unsubscribe {
    return this.inner.subscribe(listener);
  }

  /** Writes every changed row now. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const keys = [...this.dirty];
    this.dirty.clear();
    for (const key of keys) {
      const separator = key.indexOf(':');
      const record = this.inner.get({ sessionId: key.slice(0, separator), agentKey: key.slice(separator + 1) });
      if (record) this.write(record);
    }
  }

  dispose(): void {
    this.off();
    this.flush();
  }

  private markDirty(records: readonly AgentRecord[]): void {
    for (const record of records) this.dirty.add(`${record.ref.sessionId}:${record.ref.agentKey}`);
    if (this.timer || this.dirty.size === 0) return;
    this.timer = setTimeout(() => this.flush(), FLUSH_DELAY_MS);
    this.timer.unref();
  }

  private write(record: AgentRecord): void {
    const context = this.contextOf(record.ref.sessionId) ?? this.contexts.get(record.ref.sessionId) ?? { projectDir: '', folderId: null };
    const tokens = record.tokens;
    const folder = context.folderId !== null && this.db.prepare('SELECT 1 FROM tree_nodes WHERE id = ?').get(context.folderId) ? context.folderId : null;
    this.db
      .prepare(
        `INSERT INTO agents (id, session_id, agent_key, agent_id, parent_agent_id, workflow_task_id, workflow_index, folder_id, origin, source, agent_type, label, phase, description,
           state, outcome, outcome_basis, project_dir, transcript_path, summary, started_at, ended_at, updated_at, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens)
         VALUES (@id, @session_id, @agent_key, @agent_id, @parent_agent_id, @workflow_task_id, @workflow_index, @folder_id, @origin, @source, @agent_type, @label, @phase, @description,
           @state, @outcome, @outcome_basis, @project_dir, @transcript_path, @summary, @started_at, @ended_at, @updated_at, @input_tokens, @output_tokens, @cache_write_tokens, @cache_read_tokens)
         ON CONFLICT(id) DO UPDATE SET agent_id = excluded.agent_id, parent_agent_id = excluded.parent_agent_id, folder_id = excluded.folder_id, agent_type = excluded.agent_type, label = excluded.label,
           phase = excluded.phase, description = excluded.description, state = excluded.state, outcome = excluded.outcome, outcome_basis = excluded.outcome_basis, transcript_path = excluded.transcript_path,
           summary = excluded.summary, started_at = excluded.started_at, ended_at = excluded.ended_at, updated_at = excluded.updated_at, input_tokens = excluded.input_tokens,
           output_tokens = excluded.output_tokens, cache_write_tokens = excluded.cache_write_tokens, cache_read_tokens = excluded.cache_read_tokens`,
      )
      .run({
        id: `${record.ref.sessionId}:${record.ref.agentKey}`,
        session_id: record.ref.sessionId,
        agent_key: record.ref.agentKey,
        agent_id: record.agentId ?? null,
        parent_agent_id: record.parentAgentId ?? null,
        workflow_task_id: record.workflow?.taskId ?? null,
        workflow_index: record.workflow?.index ?? null,
        folder_id: folder,
        origin: record.origin,
        source: record.origin === 'app-started' ? 'stream' : 'hook',
        agent_type: cut(record.agentType, 120),
        label: cut(record.workflow?.label, 120),
        phase: cut(record.workflow?.phase, 120),
        description: cut(record.description, 400),
        state: record.state,
        outcome: record.outcome ?? null,
        outcome_basis: record.outcomeBasis ?? null,
        project_dir: context.projectDir,
        transcript_path: record.transcriptPath ?? null,
        summary: cut(record.summary, 2000),
        started_at: record.startedAt,
        ended_at: record.endedAt ?? null,
        updated_at: record.updatedAt,
        input_tokens: tokens.input,
        output_tokens: tokens.output,
        cache_write_tokens: tokens.cacheWrite5m + tokens.cacheWrite1h,
        cache_read_tokens: tokens.cacheRead,
      });
  }

  /** Replays saved rows as facts, so the state rules stay in one place. */
  private restore(): void {
    const rows = this.db.prepare('SELECT * FROM agents ORDER BY started_at').all() as unknown as Row[];
    for (const row of rows) {
      const ref: AgentRef = { sessionId: row.session_id, agentKey: row.agent_key };
      this.contexts.set(row.session_id, { projectDir: row.project_dir, folderId: row.folder_id });
      this.inner.apply({
        kind: 'started',
        ref,
        at: row.started_at,
        ...(row.agent_id === null ? {} : { agentId: row.agent_id }),
        ...(row.agent_type === null ? {} : { agentType: row.agent_type }),
        ...(row.description === null ? {} : { description: row.description }),
        ...(row.parent_agent_id === null ? {} : { parentAgentId: row.parent_agent_id }),
        ...(row.transcript_path === null ? {} : { transcriptPath: row.transcript_path }),
        ...(row.workflow_task_id === null || row.workflow_index === null
          ? {}
          : { workflow: { taskId: row.workflow_task_id, index: row.workflow_index, ...(row.label === null ? {} : { label: row.label }), ...(row.phase === null ? {} : { phase: row.phase }) } }),
      });
      if (row.input_tokens + row.output_tokens + row.cache_write_tokens + row.cache_read_tokens > 0) {
        this.inner.apply({
          kind: 'usage',
          ref,
          at: row.updated_at,
          messageId: 'restored',
          usage: { input: row.input_tokens, output: row.output_tokens, cacheWrite5m: row.cache_write_tokens, cacheWrite1h: 0, cacheRead: row.cache_read_tokens },
        });
      }
      if (row.state === 'done' || row.state === 'failed') {
        this.inner.apply({
          kind: 'ended',
          ref,
          at: row.ended_at ?? row.updated_at,
          outcome: row.outcome ?? 'lost',
          basis: row.outcome_basis ?? 'derived',
          ...(row.summary === null ? {} : { summary: row.summary }),
        });
      }
    }
  }
}

export const isAppStartedRef = (ref: AgentRef): boolean => ref.agentKey === APP_STARTED_AGENT_KEY;
