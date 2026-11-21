import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SwarmDefinitionInput } from '../definition';
import type { InMemoryAgentRuntime } from '../runtime/InMemoryAgentRuntime';
import type { AgentRunState, SwarmCaller, SwarmManager, SwarmStatus } from '../types';

/**
 * What the suite gets per test. The runtime is the in-memory one, so agent prompts use the step language of
 * `runtime/fakeScript.ts`. `addFolder` registers a caller's folder in the folder scope the manager checks.
 */
export interface ManagerHarness {
  readonly manager: SwarmManager;
  readonly runtime: InMemoryAgentRuntime;
  addFolder(id: string, parentId?: string | null): void;
  setCap(cap: number): void;
  close(): Promise<void>;
}

const UI: SwarmCaller = { kind: 'ui' };

/** A definition of scratch agents (no repository needed). */
export function scratchSwarm(agents: SwarmDefinitionInput['agents'], extra: Partial<SwarmDefinitionInput> = {}): SwarmDefinitionInput {
  return { version: 1, goal: 'contract swarm', budget: { usdTotal: 2 }, ...extra, agents: agents.map((agent) => ({ workspace: 'scratch', ...agent })) };
}

/** Behaviour every `SwarmManager` shows (0037 sections 1, 3, 7 to 9). */
export function describeSwarmManagerContract(name: string, setup: () => Promise<ManagerHarness>, options: { readonly pending?: string } = {}): void {
  const suite = options.pending === undefined ? describe : describe.skip;
  suite(`${name} (SwarmManager contract)${options.pending === undefined ? '' : ` [pending ${options.pending}]`}`, () => {
    let h: ManagerHarness;
    beforeEach(async () => {
      h = await setup();
    });
    afterEach(async () => {
      await h.manager.shutdown();
      await h.close();
    });

    const until = async (swarmId: string, check: (status: SwarmStatus) => boolean, what: string): Promise<SwarmStatus> => {
      const deadline = Date.now() + 3_000;
      for (;;) {
        const status = h.manager.status(swarmId, UI);
        if (check(status)) return status;
        if (Date.now() > deadline)
          throw new Error(`timed out waiting for ${what}; states ${JSON.stringify(status.agents.map((agent) => [agent.name, agent.state, agent.reason]))}, swarm ${status.state}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    };
    const stateOf = (status: SwarmStatus, agent: string): AgentRunState | undefined => status.agents.find((entry) => entry.name === agent)?.state;

    it('runs a one-agent swarm to done with the tier of its role and the swarm mode', async () => {
      const started = await h.manager.start({ definition: scratchSwarm([{ name: 'solo', role: 'mechanical', prompt: '/text finished' }]) }, UI);
      const status = await until(started.swarmId, (s) => s.state === 'done', 'swarm done');
      expect(status.agents[0], 'agent').toMatchObject({ state: 'done', tier: 'small', model: 'haiku', effort: 'low', permissionMode: 'auto', turns: 1 });
      expect(h.runtime.isLive(status.agents[0]!.sessionId!), 'the process ended after a successful turn').toBe(false);
      const results = await h.manager.results(started.swarmId, {}, UI);
      expect(results.agents[0]?.text, 'result text').toBe('finished');
    });

    it('refuses an invalid definition with the field named', async () => {
      await expect(
        h.manager.start({ definition: { ...scratchSwarm([{ name: 'a', prompt: 'x' }]), permissionMode: 'bypassPermissions' } }, UI),
        'bypass is not in the schema',
      ).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringContaining('permissionMode') });
      await expect(
        h.manager.start(
          {
            definition: scratchSwarm([
              { name: 'a', prompt: 'x', dependsOn: ['b'] },
              { name: 'b', prompt: 'y', dependsOn: ['a'] },
            ]),
          },
          UI,
        ),
        'a cycle',
      ).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringContaining('cycle') });
      await expect(h.manager.start({ definition: scratchSwarm([{ name: 'a', prompt: 'x', workspace: 'worktree' }]) }, UI), 'a worktree without repository').rejects.toMatchObject({
        code: 'invalid_input',
      });
    });

    it('starts a later stage only after the earlier stage is done', async () => {
      const started = await h.manager.start(
        {
          definition: scratchSwarm([
            { name: 'impl', prompt: '/sleep 80\n/text impl' },
            { name: 'review', role: 'reviewer', stage: 1, prompt: '/text ok' },
          ]),
        },
        UI,
      );
      const early = h.manager.status(started.swarmId, UI);
      expect(
        early.agents.map((agent) => [agent.name, agent.state, agent.queuedFor]),
        'review waits',
      ).toEqual([
        ['impl', 'running', undefined],
        ['review', 'queued', 'dependencies'],
      ]);
      await until(started.swarmId, (s) => s.state === 'done', 'swarm done');
      const launches = h.runtime.launches.map((spec) => spec.title);
      expect(launches, 'launch order').toEqual(['impl', 'review']);
    });

    it('queues agents at the cap and gives freed slots to the oldest swarm first', async () => {
      h.setCap(1);
      const first = await h.manager.start(
        {
          definition: scratchSwarm([
            { name: 'a1', prompt: '/sleep 60\n/text a1' },
            { name: 'a2', prompt: '/text a2' },
          ]),
        },
        UI,
      );
      // A later start time, so the order cannot come from a tie.
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await h.manager.start({ definition: scratchSwarm([{ name: 'b1', prompt: '/text b1' }]) }, UI);
      expect(stateOf(h.manager.status(first.swarmId, UI), 'a2'), 'a2 waits for a slot').toBe('queued');
      expect(h.manager.status(first.swarmId, UI).agents[1]?.queuedFor, 'queued for the slot').toBe('slot');
      expect(stateOf(h.manager.status(second.swarmId, UI), 'b1'), 'the newer swarm waits too').toBe('queued');
      await until(second.swarmId, (s) => s.state === 'done', 'second swarm done');
      expect(
        h.runtime.launches.map((spec) => spec.title),
        'oldest swarm first',
      ).toEqual(['a1', 'a2', 'b1']);
    });

    it('fails the dependents of a failed agent under stop-dependents and lets independent agents finish', async () => {
      const started = await h.manager.start(
        {
          definition: scratchSwarm([
            { name: 'broken', prompt: '/fail api_error' },
            { name: 'free', prompt: '/text fine' },
            { name: 'after', dependsOn: ['broken'], prompt: '/text never' },
          ]),
        },
        UI,
      );
      const status = await until(started.swarmId, (s) => s.state === 'failed', 'swarm failed');
      expect(
        status.agents.map((agent) => [agent.name, agent.state, agent.reason]),
        'states',
      ).toEqual([
        ['broken', 'failed', 'error-result'],
        ['free', 'done', undefined],
        ['after', 'failed', 'dependency'],
      ]);
      expect(status.agents[2]?.sessionId, 'a dependency failure never launches').toBeUndefined();
    });

    it('stops every agent under stop-swarm when one fails', async () => {
      const started = await h.manager.start(
        {
          definition: scratchSwarm(
            [
              { name: 'broken', prompt: '/fail api_error' },
              { name: 'slow', prompt: '/sleep 5000' },
            ],
            { failurePolicy: 'stop-swarm' },
          ),
        },
        UI,
      );
      const status = await until(started.swarmId, (s) => s.state === 'stopped' && s.agents.every((agent) => agent.state !== 'running'), 'swarm stopped');
      expect(status.stopReason, 'stopped by the policy').toBe('policy');
      expect(status.agents[1], 'the running agent').toMatchObject({ state: 'stopped', reason: 'policy' });
    });

    it('shows an open approval, holds the agent waiting and runs the call after an allow', async () => {
      const denials: number[] = [];
      h.runtime.subscribe((event) => {
        if (event.type === 'result') denials.push(event.result.permissionDenials.length);
      });
      const started = await h.manager.start({ definition: scratchSwarm([{ name: 'writer', prompt: '/tool Write {"file_path":"a.txt","content":"x"}\n/text wrote' }]) }, UI);
      const waiting = await until(started.swarmId, (s) => stateOf(s, 'writer') === 'waiting', 'agent waiting');
      const approval = waiting.agents[0]!.openApprovals[0]!;
      expect(approval.request, 'the raw request').toMatchObject({ tool_name: 'Write', input: { file_path: 'a.txt' } });
      h.manager.answerApproval(started.swarmId, 'writer', approval.requestId, 'allow');
      const done = await until(started.swarmId, (s) => s.state === 'done', 'swarm done');
      expect(done.agents[0]?.openApprovals, 'no open approval').toEqual([]);
      expect(denials, 'the call was allowed, not denied').toEqual([0]);
    });

    it('denies a call when the user denies it', async () => {
      const denials: number[] = [];
      h.runtime.subscribe((event) => {
        if (event.type === 'result') denials.push(event.result.permissionDenials.length);
      });
      const started = await h.manager.start({ definition: scratchSwarm([{ name: 'writer', prompt: '/tool Bash {"command":"rm -rf build"}\n/text gave up' }]) }, UI);
      const waiting = await until(started.swarmId, (s) => stateOf(s, 'writer') === 'waiting', 'agent waiting');
      h.manager.answerApproval(started.swarmId, 'writer', waiting.agents[0]!.openApprovals[0]!.requestId, 'deny');
      await until(started.swarmId, (s) => s.state === 'done', 'swarm done');
      expect(denials, 'one denied call in the result').toEqual([1]);
    });

    it('supersedes an open approval when the agent is interrupted, and refuses a late answer', async () => {
      const started = await h.manager.start({ definition: scratchSwarm([{ name: 'writer', prompt: '/tool Write {"file_path":"a.txt","content":"x"}' }]) }, UI);
      const waiting = await until(started.swarmId, (s) => stateOf(s, 'writer') === 'waiting', 'agent waiting');
      const { requestId } = waiting.agents[0]!.openApprovals[0]!;
      await h.manager.interrupt(started.swarmId, { agent: 'writer' }, UI);
      const interrupted = await until(started.swarmId, (s) => s.agents[0]!.openApprovals.length === 0, 'approval superseded');
      expect(interrupted.agents[0], 'interrupted by the user').toMatchObject({ state: 'interrupted', interruptedBy: 'user' });
      expect(() => h.manager.answerApproval(started.swarmId, 'writer', requestId, 'allow'), 'a late answer').toThrow(expect.objectContaining({ code: 'not_found' }));
    });

    it('pauses a swarm with an interrupt and continues it with a message to the group', async () => {
      const started = await h.manager.start(
        {
          definition: scratchSwarm([
            { name: 'long', prompt: '/sleep 5000' },
            { name: 'next', stage: 1, prompt: '/text next' },
          ]),
        },
        UI,
      );
      await until(started.swarmId, (s) => stateOf(s, 'long') === 'running', 'running');
      await h.manager.interrupt(started.swarmId, {}, UI);
      const paused = h.manager.status(started.swarmId, UI);
      expect(paused.state, 'paused').toBe('paused');
      expect(paused.agents[0], 'interrupted by the pause').toMatchObject({ state: 'interrupted', interruptedBy: 'pause' });
      await h.manager.send(started.swarmId, { message: '/text resumed' }, UI);
      const done = await until(started.swarmId, (s) => s.state === 'done', 'swarm done');
      expect(
        done.agents.map((agent) => agent.state),
        'both done',
      ).toEqual(['done', 'done']);
    });

    it('steers one agent with now, interrupting its turn', async () => {
      const started = await h.manager.start({ definition: scratchSwarm([{ name: 'one', prompt: '/sleep 5000' }]) }, UI);
      await until(started.swarmId, (s) => stateOf(s, 'one') === 'running', 'running');
      await h.manager.send(started.swarmId, { agent: 'one', message: '/text steered', now: true }, UI);
      await until(started.swarmId, (s) => s.state === 'done', 'swarm done');
      expect((await h.manager.results(started.swarmId, { agent: 'one' }, UI)).agents[0]?.text, 'the steered turn ended it').toBe('steered');
    });

    it('resumes a finished agent when it gets a message', async () => {
      const started = await h.manager.start({ definition: scratchSwarm([{ name: 'one', prompt: '/text first' }]) }, UI);
      await until(started.swarmId, (s) => stateOf(s, 'one') === 'done', 'done');
      await h.manager.send(started.swarmId, { agent: 'one', message: '/text again' }, UI);
      await until(started.swarmId, (s) => stateOf(s, 'one') === 'done' && h.runtime.launches.length === 2, 'done again');
      const sessionIds = new Set(h.runtime.launches.map((spec) => spec.sessionId));
      expect(sessionIds.size, 'the same session is resumed').toBe(1);
      expect(h.runtime.launches[1]?.firstMessage, 'with the message').toContain('/text again');
    });

    it('stops one agent and the whole swarm', async () => {
      const started = await h.manager.start(
        {
          definition: scratchSwarm(
            [
              { name: 'a', prompt: '/sleep 5000' },
              { name: 'b', prompt: '/sleep 5000' },
              { name: 'c', stage: 1, prompt: '/text c' },
            ],
            { failurePolicy: 'continue' },
          ),
        },
        UI,
      );
      await until(started.swarmId, (s) => stateOf(s, 'b') === 'running', 'running');
      await h.manager.stop(started.swarmId, { agent: 'a' }, UI);
      expect(h.manager.status(started.swarmId, UI).agents[0], 'a').toMatchObject({ state: 'stopped', reason: 'user' });
      await h.manager.stop(started.swarmId, {}, UI);
      const status = await until(started.swarmId, (s) => s.agents.every((agent) => agent.state === 'stopped'), 'all stopped');
      expect(status.state, 'swarm stopped').toBe('stopped');
      expect(status.agents[2]?.sessionId, 'the queued agent never launched').toBeUndefined();
    });

    it('scopes sessions: a session sees swarms in its folder and steers only swarms it started', async () => {
      h.addFolder('project-a');
      h.addFolder('project-b');
      const session = (sessionId: string, folderId: string): SwarmCaller => ({ kind: 'session', sessionId, folderId, depth: 0, permissionMode: 'auto' });
      const started = await h.manager.start({ definition: scratchSwarm([{ name: 'w', prompt: '/sleep 5000' }]) }, session('s-a', 'project-a'));
      expect(h.manager.list({}, session('s-b', 'project-b')), 'another folder sees nothing').toEqual([]);
      expect(() => h.manager.status(started.swarmId, session('s-b', 'project-b')), 'status from another folder').toThrow(expect.objectContaining({ code: 'not_found' }));
      expect(
        h.manager.list({}, session('s-a2', 'project-a')).map((s) => s.id),
        'same folder sees it',
      ).toEqual([started.swarmId]);
      await expect(h.manager.stop(started.swarmId, {}, session('s-a2', 'project-a')), 'another session may not stop it').rejects.toMatchObject({ code: 'out_of_scope' });
      await expect(
        h.manager.start({ definition: scratchSwarm([{ name: 'w', prompt: 'x' }]), parentFolderId: 'project-b' }, session('s-a', 'project-a')),
        'a parent outside the scope',
      ).rejects.toMatchObject({ code: 'out_of_scope' });
    });

    it('refuses starts beyond the spawn depth, from agents without mayStartSwarms, and bypass from a session', async () => {
      h.addFolder('p');
      const definition = scratchSwarm([{ name: 'w', prompt: 'x' }]);
      await expect(
        h.manager.start({ definition }, { kind: 'session', sessionId: 's', folderId: 'p', depth: 1, permissionMode: 'auto' }),
        'depth 1 at the default limit',
      ).rejects.toMatchObject({ code: 'limit_reached' });
      await expect(
        h.manager.start({ definition }, { kind: 'session', sessionId: 's', folderId: 'p', depth: 0, permissionMode: 'auto', swarmAgent: { swarmId: 'x', mayStartSwarms: false } }),
        'a swarm agent without mayStartSwarms',
      ).rejects.toMatchObject({ code: 'refused' });
      await expect(
        h.manager.start({ definition, bypass: true }, { kind: 'session', sessionId: 's', folderId: 'p', depth: 0, permissionMode: 'auto' }),
        'bypass from a session',
      ).rejects.toMatchObject({ code: 'refused' });
    });

    it('limits the swarms one session keeps running or paused', async () => {
      h.addFolder('p');
      const caller: SwarmCaller = { kind: 'session', sessionId: 's', folderId: 'p', depth: 0, permissionMode: 'auto' };
      const long = scratchSwarm([{ name: 'w', prompt: '/sleep 5000' }]);
      await h.manager.start({ definition: long }, caller);
      await h.manager.start({ definition: long }, caller);
      await expect(h.manager.start({ definition: long }, caller), 'a third active swarm at the default of two').rejects.toMatchObject({ code: 'limit_reached' });
      expect(await h.manager.start({ definition: long }, { ...caller, sessionId: 's2' }), 'another session is not limited by it').toMatchObject({ swarmId: expect.any(String) });
    });

    it('lets a swarm agent see its own swarm and swarms it started, and steer only the latter', async () => {
      h.addFolder('p');
      const own = await h.manager.start({ definition: scratchSwarm([{ name: 'w', prompt: '/sleep 5000' }]), parentFolderId: 'p' }, UI);
      const other = await h.manager.start({ definition: scratchSwarm([{ name: 'x', prompt: '/sleep 5000' }]), parentFolderId: 'p' }, UI);
      const agentSession = h.manager.status(own.swarmId, UI).agents[0]!.sessionId!;
      const agent: SwarmCaller = {
        kind: 'session',
        sessionId: agentSession,
        folderId: own.folderId,
        depth: 1,
        permissionMode: 'auto',
        swarmAgent: { swarmId: own.swarmId, mayStartSwarms: false },
      };
      expect(
        h.manager.list({}, agent).map((s) => s.id),
        'only its own swarm',
      ).toEqual([own.swarmId]);
      expect(() => h.manager.status(other.swarmId, agent), 'a sibling swarm in the same folder').toThrow(expect.objectContaining({ code: 'not_found' }));
      await expect(h.manager.stop(own.swarmId, {}, agent), 'its own swarm').rejects.toMatchObject({ code: 'out_of_scope' });
      await expect(h.manager.send(own.swarmId, { agent: 'w', message: 'hi' }, agent), 'a sibling agent').rejects.toMatchObject({ code: 'out_of_scope' });
    });

    it('ends an agent whose CLI reports a looser or unknown mode with mode-mismatch and keeps a stricter one with a warning', async () => {
      const reported: Record<string, string> = { loose: 'bypassPermissions', unknown: 'some-new-mode', strict: 'default' };
      h.runtime.reportMode = (spec) => reported[spec.title] ?? spec.permissionMode;
      const started = await h.manager.start(
        {
          definition: scratchSwarm([
            { name: 'loose', prompt: '/sleep 5000' },
            { name: 'unknown', prompt: '/sleep 5000' },
            { name: 'strict', prompt: '/text fine' },
          ]),
        },
        UI,
      );
      const status = await until(started.swarmId, (s) => s.state === 'failed', 'swarm failed');
      expect(
        status.agents.map((agent) => [agent.name, agent.state, agent.reason]),
        'states',
      ).toEqual([
        ['loose', 'failed', 'mode-mismatch'],
        ['unknown', 'failed', 'mode-mismatch'],
        ['strict', 'done', undefined],
      ]);
      expect(status.warnings.join(' '), 'the stricter mode is reported').toContain('strict');
    });

    it('runs agents in the strictest of the agent, swarm and caller modes and caps tiers at maxTier', async () => {
      h.addFolder('p');
      const started = await h.manager.start(
        { definition: scratchSwarm([{ name: 'w', tier: 'strong', permissionMode: 'acceptEdits', prompt: '/sleep 5000' }], { maxTier: 'mid' }) },
        { kind: 'session', sessionId: 's', folderId: 'p', depth: 0, permissionMode: 'default' },
      );
      expect(started.warnings.join(' '), 'the cap is reported').toContain('w');
      const agent = h.manager.status(started.swarmId, UI).agents[0]!;
      expect(agent, 'agent').toMatchObject({ permissionMode: 'default', tier: 'mid', model: 'sonnet' });
      expect(h.runtime.launches[0], 'launch').toMatchObject({ permissionMode: 'default', model: 'sonnet' });
    });

    it('interrupts running agents and pauses swarms on shutdown', async () => {
      const started = await h.manager.start({ definition: scratchSwarm([{ name: 'w', prompt: '/sleep 5000' }]) }, UI);
      await until(started.swarmId, (s) => stateOf(s, 'w') === 'running', 'running');
      await h.manager.shutdown();
      const status = h.manager.status(started.swarmId, UI);
      expect(status.state, 'paused').toBe('paused');
      expect(status.agents[0], 'interrupted by quit').toMatchObject({ state: 'interrupted', interruptedBy: 'quit' });
      expect(h.runtime.isLive(status.agents[0]!.sessionId!), 'no live process').toBe(false);
    });
  });
}
