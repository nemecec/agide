import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SessionId } from '../session/types';
import type { ToolSet } from '../commands/types';
import type { NodeId } from '../tree/types';

interface Entry {
  folderId: NodeId;
  token: string;
  hostHeaders: readonly string[];
  toolSet: ToolSet;
}

const digest = (token: string): Buffer => createHash('sha256').update(token).digest();
const NO_TOKEN = digest('');

/** Tokens and folder scopes of Claude sessions, in memory only. */
export class GrantStore {
  private readonly entries = new Map<SessionId, Entry>();
  /** Tool sets declared before the grant exists; every launch of the session issues a fresh grant that takes it. */
  private readonly declared = new Map<SessionId, ToolSet>();

  /** Issues a fresh token for the session, replacing an earlier one. Returns the token. */
  issue(sessionId: SessionId, folderId: NodeId, hostHeaders: readonly string[] = [], toolSet?: ToolSet): string {
    const token = randomBytes(32).toString('hex');
    this.entries.set(sessionId, { folderId, token, hostHeaders: [...hostHeaders], toolSet: toolSet ?? this.declared.get(sessionId) ?? 'default' });
    return token;
  }

  /** The tool set the next and every later grant of the session gets; a grant that exists changes at once. */
  declareToolSet(sessionId: SessionId, toolSet: ToolSet): void {
    this.declared.set(sessionId, toolSet);
    const entry = this.entries.get(sessionId);
    if (entry) entry.toolSet = toolSet;
  }

  /** `Host` values the session's environment uses besides the loopback names; none without a grant. */
  hostHeaders(sessionId: SessionId): readonly string[] {
    return this.entries.get(sessionId)?.hostHeaders ?? [];
  }

  rescope(sessionId: SessionId, folderId: NodeId): void {
    const entry = this.entries.get(sessionId);
    if (entry) entry.folderId = folderId;
  }

  revoke(sessionId: SessionId): void {
    this.entries.delete(sessionId);
    this.declared.delete(sessionId);
  }

  /** The grant of a session, or `undefined` without one. */
  get(sessionId: SessionId): { folderId: NodeId; token: string } | undefined {
    return this.entries.get(sessionId);
  }

  /** The folder of the session when the token belongs to it; otherwise `undefined`, with the same work for every failure. */
  authenticate(sessionId: SessionId, token: string | undefined): { folderId: NodeId; toolSet: ToolSet } | undefined {
    const entry = this.entries.get(sessionId);
    const matches = timingSafeEqual(entry ? digest(entry.token) : NO_TOKEN, digest(token ?? ''));
    return entry && token !== undefined && matches ? { folderId: entry.folderId, toolSet: entry.toolSet } : undefined;
  }
}
