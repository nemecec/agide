import type { SwarmId } from '../../swarm/types';
import { RecordingBaseline, ScriptedBaseRunner } from '../fakes/fakeBase';
import { InMemoryChangesetStore } from '../store/InMemoryChangesetStore';
import { describeBaseChecksContract, type BaseChecksHarness } from './baseChecksContract';
import { InMemoryBaseChecks, type ResumableJob } from './InMemoryBaseChecks';

let tick = 0;
const clock = () => new Date(Date.UTC(2026, 10, 28, 10, 0, (tick += 1))).toISOString();

/** The harness of one instance; a restart builds the next from the open jobs of the one before, which stands for the stored state. */
function harness(store: InMemoryChangesetStore, resume: readonly ResumableJob[] = []): BaseChecksHarness {
  const runner = new ScriptedBaseRunner();
  const baseline = new RecordingBaseline();
  const checks = new InMemoryBaseChecks({ runner, store, computeBaseline: baseline.compute, slots: 1, clock, resume });
  return {
    checks,
    runner,
    store,
    baseline,
    close: () => undefined,
    restart: async (live: readonly SwarmId[]) => {
      const open = checks.openJobs();
      await checks.shutdown();
      return harness(
        store,
        open.map((job) => ({ ...job, swarms: job.swarms.filter((swarm) => live.includes(swarm)) })),
      );
    },
  };
}

describeBaseChecksContract('in-memory base checks', async () => harness(new InMemoryChangesetStore()));
