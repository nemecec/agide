import { describeHookEndpointContract } from './hookEndpointContract';
import { InMemoryHookEndpoint } from './InMemoryHookEndpoint';

describeHookEndpointContract('InMemoryHookEndpoint', ({ userPromptWaitMs }) => {
  const endpoint = new InMemoryHookEndpoint({ port: 4242, userPromptWaitMs });
  return {
    endpoint,
    ownHost: '127.0.0.1:4242',
    post: (post) => endpoint.receive(post),
    close: () => Promise.resolve(),
  };
});
