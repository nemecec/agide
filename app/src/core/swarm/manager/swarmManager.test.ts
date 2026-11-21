import { InMemoryAgentRuntime } from '../runtime/InMemoryAgentRuntime';
import { InMemorySwarmFolders, InMemorySwarmManager } from './InMemorySwarmManager';
import { createRig } from './testRig';
import { describeSwarmManagerContract } from './swarmManagerContract';

describeSwarmManagerContract('in-memory manager', async () => {
  const runtime = new InMemoryAgentRuntime();
  const folders = new InMemorySwarmFolders();
  let cap = 4;
  const manager = new InMemorySwarmManager({ runtime, folders, cap: () => cap });
  return {
    manager,
    runtime,
    addFolder: (id, parentId = null) => void folders.add(id, parentId),
    setCap: (value) => {
      cap = value;
    },
    close: () => runtime.dispose(),
  };
});

// The persistent manager with the budget ledger, workspaces, inbox items and the `swarm` tables (0038, w-manager).
describeSwarmManagerContract('persistent manager', async () => {
  const rig = createRig();
  return {
    manager: rig.manager,
    runtime: rig.runtime,
    addFolder: (id, parentId = null) => void rig.folders.add(id, parentId),
    setCap: (value) => {
      rig.cap = value;
    },
    close: () => rig.close(),
  };
});
