import type { Caller } from '../../commands/types';
import { cleanLine } from '../../inbox/text';
import type { PermissionMode, SessionId } from '../../session/types';
import { SwarmError, type AgentResult, type SwarmCaller, type SwarmStatus } from '../types';
import { quotedValue, untrustedBlock } from './inputs';

/** What the module knows about a session that calls a command. */
export interface SessionFacts {
  readonly depth: (sessionId: SessionId) => number;
  readonly permissionMode: (sessionId: SessionId) => PermissionMode;
  readonly swarmAgent: (sessionId: SessionId) => { readonly swarmId: string; readonly mayStartSwarms: boolean } | undefined;
}

/** The manager's caller for a command caller: the user, or a session with its scope, depth and mode. */
export function swarmCallerOf(caller: Caller, facts: SessionFacts): SwarmCaller {
  if (caller.kind === 'ui') return { kind: 'ui' };
  const swarmAgent = facts.swarmAgent(caller.sessionId);
  return {
    kind: 'session',
    sessionId: caller.sessionId,
    folderId: caller.folderId,
    depth: facts.depth(caller.sessionId),
    permissionMode: facts.permissionMode(caller.sessionId),
    ...(swarmAgent === undefined ? {} : { swarmAgent }),
  };
}

/**
 * Paths stay out of what agents read: a status shows no working directory. The inputs of open approval requests
 * are chosen by an agent and reach another one as untrusted data.
 */
export function statusForCaller(status: SwarmStatus, caller: Caller): SwarmStatus {
  if (caller.kind === 'ui') return status;
  return {
    ...status,
    warnings: status.warnings.map((warning) => cleanLine(warning)),
    agents: status.agents.map(({ cwd: _cwd, openApprovals, ...rest }) => ({
      ...rest,
      openApprovals: (openApprovals ?? []).map((open) => ({
        ...open,
        request: { ...open.request, input: { untrusted: untrustedBlock(rest.name, JSON.stringify(open.request.input).slice(0, 2_000)) } },
      })),
    })),
  };
}

/**
 * Results for a caller. Agent text reaches another agent as untrusted data in a tagged block; the worktree path
 * goes only to the session that started the swarm.
 */
export function resultsForCaller(results: readonly AgentResult[], caller: Caller, ownSwarm: boolean): AgentResult[] {
  if (caller.kind === 'ui') return [...results];
  return results.map(({ worktreePath, text, commits, numstat, outsideOwns, conflict, ...rest }) => ({
    ...rest,
    commits: commits.map((commit) => ({ sha: commit.sha, subject: quotedValue(commit.subject, 200) })),
    numstat: numstat.map((row) => ({ ...row, path: quotedValue(row.path) })),
    outsideOwns: outsideOwns.map((path) => quotedValue(path)),
    ...(conflict === undefined ? {} : { conflict: cleanLine(conflict) }),
    ...(text === undefined ? {} : { text: untrustedBlock(rest.name, text) }),
    ...(ownSwarm && worktreePath !== undefined ? { worktreePath } : {}),
  }));
}

/** Commands only the user may run refuse every other caller, whatever the command table says. */
export function assertUser(caller: Caller, refusal: string): void {
  if (caller.kind !== 'ui') throw new SwarmError('refused', refusal);
}
