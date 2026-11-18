import { describeAgentStoreContract } from './agentStoreContract';
import { InMemoryAgentStore } from './InMemoryAgentStore';

describeAgentStoreContract('InMemoryAgentStore', (now) => new InMemoryAgentStore(now));
