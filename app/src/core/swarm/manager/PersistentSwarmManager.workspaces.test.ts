import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SwarmDefinitionInput } from '../definition';
import type { SwarmCaller, SwarmStatus } from '../types';
import type { PersistentSwarmManager } from './PersistentSwarmManager';
import { createRig, makeRepo, type ManagerRig } from './testRig';

const UI: SwarmCaller = { kind: 'ui' };
let rig: ManagerRig;
let repo: ReturnType<typeof makeRepo>;

beforeEach(() => {
  repo = makeRepo();
  rig = createRig();
});
afterEach(async () => {
  await rig.close();
  rmSync(repo.dir, { recursive: true, force: true });
});

const until = async (manager: PersistentSwarmManager, swarmId: string, check: (status: SwarmStatus) => boolean, what: string): Promise<SwarmStatus> => {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const status = manager.status(swarmId, UI);
    if (check(status)) return status;
    if (Date.now() > deadline)
      throw new Error(
        `timed out waiting for ${what}; ${JSON.stringify(status.agents.map((agent) => [agent.name, agent.state, agent.reason, agent.queuedFor]))} swarm ${status.state}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};
const cwdOf = (status: SwarmStatus, name: string): string => status.agents.find((agent) => agent.name === name)!.cwd!;
const swarmOf = (agents: SwarmDefinitionInput['agents'], extra: Partial<SwarmDefinitionInput> = {}): SwarmDefinitionInput => ({
  version: 1,
  goal: 'edit things',
  repository: { path: repo.dir, base: 'main' },
  budget: { usdTotal: 5, usdPerAgent: 1 },
  ...extra,
  agents,
});

describe('worktrees of editing agents', () => {
  it('gives each editing agent its own worktree on a swarm branch and starts it there', async () => {
    const swarm = await rig.manager.start(
      {
        definition: swarmOf([
          { name: 'one', prompt: '/sleep 5000', owns: ['src/a.ts'] },
          { name: 'two', prompt: '/sleep 5000', owns: ['src/b.ts'] },
        ]),
      },
      UI,
    );
    const status = rig.manager.status(swarm.swarmId, UI);
    const [one, two] = status.agents;
    expect(one!.cwd, 'separate directories').not.toBe(two!.cwd);
    expect(one!.branch, 'branch by swarm and agent').toBe(`agide/swarm-${swarm.swarmId.slice(0, 8)}/one`);
    expect(readFileSync(join(one!.cwd!, 'src/a.ts'), 'utf8'), 'the base is checked out').toContain('a = 1');
    expect(rig.runtime.launches[0]?.cwd, 'the agent starts in its worktree').toBe(one!.cwd);
    expect(swarm.agents[0], 'the start result names the branch').toMatchObject({ name: 'one', branch: one!.branch });
    expect(repo.git('rev-parse', 'HEAD'), 'the user checkout is untouched').toBe(repo.commit);
  });

  it('collects the diff, commits and checks of an agent that ended, and stores the patch', async () => {
    const swarm = await rig.manager.start(
      {
        definition: swarmOf(
          [
            { name: 'one', prompt: '/sleep 5000', owns: ['src/a.ts'] },
            { name: 'two', prompt: '/sleep 5000', owns: ['src/b.ts'] },
          ],
          { failurePolicy: 'continue' },
        ),
      },
      UI,
    );
    const status = rig.manager.status(swarm.swarmId, UI);
    writeFileSync(join(cwdOf(status, 'one'), 'src/a.ts'), 'export const a = 2;\n');
    writeFileSync(join(cwdOf(status, 'one'), 'shared.txt'), 'one\n');
    writeFileSync(join(cwdOf(status, 'two'), 'shared.txt'), 'two\n');
    writeFileSync(join(cwdOf(status, 'two'), 'src/b.ts'), 'export const b = 2;\n');
    await rig.manager.interrupt(swarm.swarmId, { agent: 'one' }, UI);
    await rig.manager.stop(swarm.swarmId, {}, UI);
    const results = await rig.manager.results(swarm.swarmId, { patch: true }, UI);
    const [one, two] = results.agents;
    expect(one!.numstat.map((row) => row.path).sort(), 'changed and new files of one').toEqual(['shared.txt', 'src/a.ts']);
    expect(one!.outsideOwns, 'shared.txt is outside what one owns').toEqual(['shared.txt']);
    expect(two!.outsideOwns, 'shared.txt is outside what two owns').toEqual(['shared.txt']);
    expect(one!.overlapsWith, 'both changed shared.txt').toEqual(['two']);
    expect(one!.patch, 'the patch text on request').toContain('+one');
    expect(one!.worktreePath, 'the worktree path').toBe(cwdOf(status, 'one'));
    expect(existsSync(join(rig.root, 'data', 'swarms', swarm.swarmId, 'one.patch')), 'the patch is stored').toBe(true);
    expect((await rig.manager.results(swarm.swarmId, { agent: 'one' }, UI)).agents[0]?.patch, 'no patch text unless asked').toBeUndefined();
  });

  it('keeps the worktree and its changes when an agent is stopped', async () => {
    const swarm = await rig.manager.start({ definition: swarmOf([{ name: 'one', prompt: '/sleep 5000' }]) }, UI);
    const cwd = cwdOf(rig.manager.status(swarm.swarmId, UI), 'one');
    writeFileSync(join(cwd, 'work.txt'), 'unsaved work\n');
    await rig.manager.stop(swarm.swarmId, {}, UI);
    expect(readFileSync(join(cwd, 'work.txt'), 'utf8'), 'the file is still in the worktree after the stop').toBe('unsaved work\n');
    const [one] = (await rig.manager.results(swarm.swarmId, { patch: true }, UI)).agents;
    expect(one!.patch, 'and in the stored patch').toContain('+unsaved work');
    expect(one!.state, 'the agent is stopped').toBe('stopped');
  });

  it('refuses a repository that is not one the profile used when a session asks', async () => {
    rig.folders.add('p');
    const caller: SwarmCaller = { kind: 'session', sessionId: 's', folderId: 'p', depth: 0, permissionMode: 'auto' };
    await expect(rig.manager.start({ definition: swarmOf([{ name: 'one', prompt: 'x' }]) }, caller), 'an unknown repository').rejects.toMatchObject({
      code: 'invalid_input',
      message: expect.stringContaining('repository.path'),
    });
    const known = rig.restart({ knownRepositories: () => [repo.dir] });
    const started = await known.start({ definition: swarmOf([{ name: 'one', prompt: '/sleep 5000' }]) }, caller);
    expect(started.agents[0]?.branch, 'a known repository starts').toBeDefined();
  });

  it('refuses two concurrent editing agents with overlapping owns before anything starts', async () => {
    await expect(
      rig.manager.start(
        {
          definition: swarmOf([
            { name: 'one', prompt: 'x', owns: ['src/**'] },
            { name: 'two', prompt: 'y', owns: ['src/b.ts'] },
          ]),
        },
        UI,
      ),
      'overlap',
    ).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringMatching(/one and two.*overlap/) });
    expect(rig.runtime.launches, 'nothing launched').toEqual([]);
    expect(rig.manager.list({}, UI), 'no swarm created').toEqual([]);
  });
});

describe('readonly reviewers and merge previews', () => {
  const reviewSwarm = (reviewerPrompt: string, impl: string[] = ['src/a.ts']) =>
    swarmOf([
      { name: 'impl', prompt: '/sleep 250', owns: impl },
      { name: 'review', role: 'reviewer', stage: 1, workspace: 'readonly', prompt: reviewerPrompt },
    ]);

  it('starts the reviewer in a detached preview that holds the earlier changes and removes it when the swarm ends', async () => {
    const swarm = await rig.manager.start({ definition: reviewSwarm('/sleep 5000') }, UI);
    const impl = cwdOf(rig.manager.status(swarm.swarmId, UI), 'impl');
    writeFileSync(join(impl, 'src/a.ts'), 'export const a = 99;\n');
    const running = await until(
      rig.manager,
      swarm.swarmId,
      (s) => s.agents[1]!.cwd !== undefined && s.agents[1]!.sessionId !== undefined && rig.runtime.isLive(s.agents[1]!.sessionId!),
      'reviewer running',
    );
    const preview = cwdOf(running, 'review');
    expect(readFileSync(join(preview, 'src/a.ts'), 'utf8'), 'the reviewer sees the implementation').toContain('a = 99');
    expect(running.agents[1]!.branch, 'a detached worktree has no branch').toBeUndefined();
    expect(rig.runtime.launches[1]?.denyRules, 'edit tools are denied').toEqual(['Edit(**)', 'Write(**)', 'NotebookEdit(**)']);
    expect(rig.runtime.launches[1]?.firstMessage, 'the reviewer reads the inputs file').toContain('inputs.md');
    expect(readFileSync(join(rig.root, 'agents', swarm.swarmId, 'inputs', 'review', 'inputs.md'), 'utf8'), 'the inputs name the changed file').toContain(
      '- "src/a.ts" (+1 -1)',
    );
    await rig.manager.stop(swarm.swarmId, {}, UI);
    await until(rig.manager, swarm.swarmId, () => !existsSync(preview), 'preview removed');
    expect(rig.manager.status(swarm.swarmId, UI).warnings.join(' '), 'no warning for a reviewer that changed nothing').not.toContain('readonly');
  });

  it('warns when a readonly agent changed files, and stores the change as a patch', async () => {
    const swarm = await rig.manager.start({ definition: reviewSwarm('/sleep 250') }, UI);
    const running = await until(
      rig.manager,
      swarm.swarmId,
      (s) => s.agents[1]!.cwd !== undefined && s.agents[1]!.sessionId !== undefined && rig.runtime.isLive(s.agents[1]!.sessionId!),
      'reviewer running',
    );
    writeFileSync(join(cwdOf(running, 'review'), 'sneaky.txt'), 'edit\n');
    await until(rig.manager, swarm.swarmId, (s) => s.state === 'done', 'done');
    await rig.manager.results(swarm.swarmId, {}, UI);
    expect(rig.manager.status(swarm.swarmId, UI).warnings.join(' '), 'a warning names the agent').toContain('review changed files in a readonly workspace');
    await until(rig.manager, swarm.swarmId, () => existsSync(join(rig.root, 'data', 'swarms', swarm.swarmId, 'review.patch')), 'patch stored');
    expect(readFileSync(join(rig.root, 'data', 'swarms', swarm.swarmId, 'review.patch'), 'utf8'), 'the patch holds the edit').toContain('+edit');
  });

  it('names the agent and files of a patch that does not apply and hands the patch to the reviewer', async () => {
    const swarm = await rig.manager.start(
      {
        definition: swarmOf([
          { name: 'one', prompt: '/sleep 300', owns: ['src/a.ts'] },
          { name: 'two', prompt: '/sleep 300', owns: ['src/b.ts'] },
          { name: 'review', role: 'reviewer', stage: 1, workspace: 'readonly', prompt: '/text reviewed' },
        ]),
      },
      UI,
    );
    const status = rig.manager.status(swarm.swarmId, UI);
    writeFileSync(join(cwdOf(status, 'one'), 'src/a.ts'), 'export const a = 10;\n');
    writeFileSync(join(cwdOf(status, 'two'), 'src/a.ts'), 'export const a = 20;\n');
    await until(rig.manager, swarm.swarmId, (s) => s.state === 'done', 'done');
    const [, , review] = (await rig.manager.results(swarm.swarmId, {}, UI)).agents;
    expect(review!.conflict, 'the conflict names the second agent').toContain('two: src/a.ts');
    expect(rig.manager.status(swarm.swarmId, UI).warnings.join(' '), 'the swarm warns').toContain('merge preview conflict for review');
    expect(existsSync(join(rig.root, 'agents', swarm.swarmId, 'inputs', 'review', 'two.patch')), 'the patch of two is a file in the reviewer inputs').toBe(true);
  });
});

describe('removing a swarm', () => {
  const finished = async (prompt = '/text done') => {
    const swarm = await rig.manager.start({ definition: swarmOf([{ name: 'one', prompt }]) }, UI);
    await until(rig.manager, swarm.swarmId, (s) => s.state === 'done', 'done');
    return swarm;
  };

  it('lists each worktree with its state and branch', async () => {
    const swarm = await rig.manager.start({ definition: swarmOf([{ name: 'one', prompt: '/sleep 5000' }]) }, UI);
    const cwd = cwdOf(rig.manager.status(swarm.swarmId, UI), 'one');
    await rig.manager.stop(swarm.swarmId, {}, UI);
    expect(await rig.manager.removalPlan(swarm.swarmId), 'a clean worktree').toEqual([
      { agent: 'one', workspace: 'worktree', path: cwd, branch: expect.stringContaining('/one'), state: 'clean' },
    ]);
    writeFileSync(join(cwd, 'x.txt'), 'x');
    expect((await rig.manager.removalPlan(swarm.swarmId))[0]?.state, 'a worktree with changes').toBe('changes');
    rmSync(cwd, { recursive: true, force: true });
    expect((await rig.manager.removalPlan(swarm.swarmId))[0]?.state, 'a worktree that is gone').toBe('missing');
  });

  it('refuses to remove a swarm that still runs, or for anyone but the user', async () => {
    const swarm = await rig.manager.start({ definition: swarmOf([{ name: 'one', prompt: '/sleep 5000' }]) }, UI);
    await expect(rig.manager.remove(swarm.swarmId, {}, UI), 'a running swarm').rejects.toMatchObject({ code: 'refused', message: expect.stringContaining('stop') });
    await expect(rig.manager.remove(swarm.swarmId, {}, { kind: 'session', sessionId: 's', folderId: 'f', depth: 0, permissionMode: 'auto' }), 'a session').rejects.toMatchObject({
      code: 'refused',
    });
  });

  it('stores a patch of uncommitted work before it forces a worktree away, then deletes the swarm', async () => {
    const swarm = await rig.manager.start({ definition: swarmOf([{ name: 'one', prompt: '/sleep 5000' }]) }, UI);
    const cwd = cwdOf(rig.manager.status(swarm.swarmId, UI), 'one');
    await rig.manager.stop(swarm.swarmId, {}, UI);
    writeFileSync(join(cwd, 'late.txt'), 'written after the end\n');
    const report = await rig.manager.remove(swarm.swarmId, {}, UI);
    expect(report.removed, 'removed').toBe(true);
    expect(report.worktrees[0], 'forced after a patch').toMatchObject({ removed: true, forced: true });
    expect(readFileSync(report.worktrees[0]!.patchFile!, 'utf8'), 'the patch holds the late file, so nothing was lost').toContain('+written after the end');
    expect(existsSync(cwd), 'the worktree is gone').toBe(false);
    expect(() => rig.manager.status(swarm.swarmId, UI), 'the swarm is gone').toThrow(/no swarm/);
    expect(rig.db.prepare('SELECT COUNT(*) AS n FROM swarm_agents').get(), 'its rows are gone').toEqual({ n: 0 });
  });

  it('keeps the swarm and the worktree when the patch cannot be stored', async () => {
    const swarm = await rig.manager.start({ definition: swarmOf([{ name: 'one', prompt: '/sleep 5000' }]) }, UI);
    const cwd = cwdOf(rig.manager.status(swarm.swarmId, UI), 'one');
    await rig.manager.stop(swarm.swarmId, {}, UI);
    writeFileSync(join(cwd, 'precious.txt'), 'keep me\n');
    mkdirSync(join(rig.root, 'data', 'swarms', swarm.swarmId, 'one-removal.patch'), { recursive: true });
    const report = await rig.manager.remove(swarm.swarmId, {}, UI);
    expect(report.removed, 'nothing removed without a stored patch').toBe(false);
    expect(readFileSync(join(cwd, 'precious.txt'), 'utf8'), 'the work is still there').toBe('keep me\n');
    expect(rig.manager.status(swarm.swarmId, UI).state, 'the swarm is still listed').toBe('stopped');
  });

  it('deletes a merged branch, keeps an unmerged one, and deletes it when the user ticks it', async () => {
    const make = async (name: string, commit: boolean) => {
      const swarm = await rig.manager.start({ definition: swarmOf([{ name, prompt: '/sleep 5000' }]) }, UI);
      const status = rig.manager.status(swarm.swarmId, UI);
      if (commit) {
        const cwd = cwdOf(status, name);
        writeFileSync(join(cwd, `${name}.txt`), 'x');
        const { Git } = await import('../workspace/git');
        const git = new Git(undefined, () => ({ ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }));
        await git.run(cwd, ['add', '.']);
        await git.run(cwd, ['commit', '-m', name], { identity: true });
      }
      await rig.manager.stop(swarm.swarmId, {}, UI);
      return { swarm, branch: status.agents[0]!.branch! };
    };
    const merged = await make('plain', false);
    const unmerged = await make('work', true);
    const ticked = await make('keepme', true);
    expect((await rig.manager.remove(merged.swarm.swarmId, {}, UI)).worktrees[0], 'a branch with nothing new is merged').toMatchObject({ branchDeleted: true });
    expect((await rig.manager.remove(unmerged.swarm.swarmId, {}, UI)).worktrees[0], 'an unmerged branch stays').toMatchObject({ branchDeleted: false });
    expect(repo.git('branch', '--list', unmerged.branch), 'it is still a branch').toContain('work');
    expect((await rig.manager.remove(ticked.swarm.swarmId, { deleteBranches: [ticked.branch] }, UI)).worktrees[0], 'a ticked branch goes').toMatchObject({ branchDeleted: true });
    expect(repo.git('branch', '--list', ticked.branch), 'it is gone').toBe('');
  });

  it('removes scratch directories with the swarm', async () => {
    const swarm = await rig.manager.start(
      { definition: { version: 1, goal: 's', budget: { usdTotal: 1 }, agents: [{ name: 'tmp', workspace: 'scratch', prompt: '/text x' }] } },
      UI,
    );
    await until(rig.manager, swarm.swarmId, (s) => s.state === 'done', 'done');
    const scratch = cwdOf(rig.manager.status(swarm.swarmId, UI), 'tmp');
    expect(existsSync(scratch), 'a scratch directory exists while the swarm does').toBe(true);
    await rig.manager.remove(swarm.swarmId, {}, UI);
    expect(existsSync(scratch), 'and goes with it').toBe(false);
  });

  it('does not lose the collection when the worktree directory was removed before the agent ended', async () => {
    const swarm = await rig.manager.start({ definition: swarmOf([{ name: 'one', prompt: '/sleep 5000' }]) }, UI);
    const cwd = cwdOf(rig.manager.status(swarm.swarmId, UI), 'one');
    rmSync(cwd, { recursive: true, force: true });
    await rig.manager.stop(swarm.swarmId, {}, UI);
    expect((await rig.manager.results(swarm.swarmId, {}, UI)).agents[0]?.numstat, 'nothing to collect from a missing directory, and no crash').toEqual([]);
    chmodSync(rig.root, 0o700);
    await finished();
  });
});
