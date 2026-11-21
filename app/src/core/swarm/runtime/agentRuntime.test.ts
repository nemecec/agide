import { streamHarness } from '../fixtures/streamHarness';
import { describeAgentRuntimeContract } from './agentRuntimeContract';
import { InMemoryAgentRuntime } from './InMemoryAgentRuntime';

describeAgentRuntimeContract('in-memory runtime', async () => ({
  runtime: new InMemoryAgentRuntime(),
  cwd: '/nonexistent',
  folderId: 'f1',
  close: async () => undefined,
}));

// The stream-json runtime over the session service, the local provider and `fixtures/fake-claude-stream.mjs`.
describeAgentRuntimeContract('stream-json runtime', () => streamHarness(), {
  timeoutMs: 10_000,
});
