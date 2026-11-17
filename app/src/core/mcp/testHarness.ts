import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CommandRegistry, registerBuiltinCommands } from '../commands/index';
import { createAppEventBus, type AppEvent } from '../events/index';
import { InMemoryTreeService, type FolderNode, type LeafNode } from '../tree/index';
import { HttpAppMcpServer } from './HttpAppMcpServer';
import type { McpGrant } from './types';

/** An in-memory tree with two sibling folders, the built-in commands and a listening server. */
export async function startHarness() {
  let next = 0;
  const tree = new InMemoryTreeService(() => `n${++next}`);
  const events = createAppEventBus();
  const seen: AppEvent[] = [];
  events.onAny((event) => seen.push(event));
  tree.subscribe((event) => events.emit(event));
  const registry = new CommandRegistry();
  registerBuiltinCommands(registry, { tree, events });
  const server = new HttpAppMcpServer(registry);
  const { port } = await server.start();

  const mine: FolderNode = tree.createFolder({ title: 'Mine' });
  const theirs: FolderNode = tree.createFolder({ title: 'Theirs' });
  const myLeaf: LeafNode = tree.createLeaf({ title: 'My session', parentId: mine.id, surfaceType: 'claude-session', surfaceId: 's-mine' });
  const theirLeaf: LeafNode = tree.createLeaf({ title: 'Other session', parentId: theirs.id, surfaceType: 'claude-session', surfaceId: 's-theirs' });

  const clients: Client[] = [];
  const connect = async (grant: McpGrant, headers: Record<string, string> = { Authorization: `Bearer ${grant.token}` }): Promise<Client> => {
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(grant.url), { requestInit: { headers } }));
    clients.push(client);
    return client;
  };

  return {
    tree,
    registry,
    server,
    port,
    seen,
    mine,
    theirs,
    myLeaf,
    theirLeaf,
    connect,
    async close() {
      await Promise.allSettled(clients.map((client) => client.close()));
      await server.stop();
    },
  };
}

export type Harness = Awaited<ReturnType<typeof startHarness>>;

/** The text of the first content item of a tool result. */
export function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content.find((item) => item.type === 'text')?.text ?? '';
}
