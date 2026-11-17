import { request } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, textOf, type Harness } from './testHarness';

let h: Harness;
beforeEach(async () => {
  h = await startHarness();
});
afterEach(() => h.close());

const call = async (client: Awaited<ReturnType<Harness['connect']>>, name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ name, arguments: args });
  return { isError: result.isError === true, text: textOf(result), json: () => JSON.parse(textOf(result)) as unknown };
};

describe('app MCP server', () => {
  it('lists one tool per command with mcp exposure, with JSON Schema inputs', async () => {
    const client = await h.connect(h.server.grant('s1', h.mine.id));
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    expect(names, 'tool names equal the ids of mcp commands').toEqual(h.registry.list({ mcp: true }).map((c) => c.id).sort());
    const create = tools.find((tool) => tool.name === 'ui_create_folder');
    expect(create?.inputSchema, 'ui_create_folder requires title as a string').toMatchObject({
      type: 'object',
      required: ['title'],
      properties: { title: { type: 'string' } },
      additionalProperties: false,
    });
    expect(create?.description, 'description is the command description').toBe(h.registry.get('ui_create_folder')?.description);
  });

  it('creates a folder inside the session folder by default and emits the tree event', async () => {
    const client = await h.connect(h.server.grant('s1', h.mine.id));
    const result = await call(client, 'ui_create_folder', { title: 'from-agent' });
    expect(result.isError, 'call succeeds').toBe(false);
    const created = h.tree.children(h.mine.id).find((node) => node.title === 'from-agent');
    expect(created?.kind, 'folder exists under the session folder').toBe('folder');
    expect(h.seen.map((e) => e.type), 'tree event reached the bus').toContain('tree.node_created');
  });

  it('shows and changes only the session folder', async () => {
    const client = await h.connect(h.server.grant('s1', h.mine.id));
    const listed = (await call(client, 'ui_list_tree')).json() as { nodes: { id: string }[] };
    expect(listed.nodes.map((n) => n.id).sort(), 'only the own folder and its leaf').toEqual([h.mine.id, h.myLeaf.id].sort());

    const surfaces = (await call(client, 'surfaces_list')).json() as { surfaces: { nodeId: string }[] };
    expect(surfaces.surfaces.map((s) => s.nodeId), 'surfaces_list holds the own leaf only').toEqual([h.myLeaf.id]);

    for (const [name, args] of [
      ['ui_rename_node', { nodeId: h.theirs.id, title: 'x' }],
      ['ui_remove_node', { nodeId: h.theirLeaf.id }],
      ['ui_move_node', { nodeId: h.myLeaf.id, parentId: h.theirs.id }],
      ['ui_create_folder', { title: 'x', parentId: h.theirs.id }],
      ['ui_focus_node', { nodeId: h.theirs.id }],
      ['ui_move_node', { nodeId: h.theirLeaf.id, parentId: h.mine.id }],
      ['ui_create_leaf', { title: 'x', surfaceType: 'browser-tab', surfaceId: 't', parentId: h.theirs.id }],
    ] as const) {
      const result = await call(client, name, args);
      expect(result.isError, `${name} outside the folder is an error`).toBe(true);
      expect(result.text, `${name} reports out_of_scope`).toContain('out_of_scope');
    }
    expect(h.tree.get(h.theirs.id)?.title, 'other folder is unchanged').toBe('Theirs');
    expect(h.tree.get(h.theirLeaf.id)?.parentId, 'the leaf of another folder did not move into the own folder').toBe(h.theirs.id);
    expect(h.tree.children(h.theirs.id).map((n) => n.id), 'nothing was created in the other folder').toEqual([h.theirLeaf.id]);
  });

  it('applies the scope at depth: a node two levels below the session folder is in scope', async () => {
    const client = await h.connect(h.server.grant('s1', h.mine.id));
    const mid = h.tree.createFolder({ title: 'mid', parentId: h.mine.id });
    const deep = h.tree.createFolder({ title: 'deep', parentId: mid.id });
    const renamed = await call(client, 'ui_rename_node', { nodeId: deep.id, title: 'renamed' });
    expect(renamed.isError, 'rename of a deep node in the folder succeeds').toBe(false);
    expect(h.tree.get(deep.id)?.title, 'deep node renamed').toBe('renamed');
  });

  it('reports an unknown node id as not_found, not as a scope problem', async () => {
    const client = await h.connect(h.server.grant('s1', h.mine.id));
    const result = await call(client, 'ui_rename_node', { nodeId: 'no-such-node', title: 'x' });
    expect(result.text, 'unknown id is not_found').toMatch(/^not_found/);
    const outside = await call(client, 'ui_rename_node', { nodeId: h.theirs.id, title: 'x' });
    expect(outside.text, 'out_of_scope message says what to do').toContain('ui_list_tree');
  });

  it('refuses leaves of types that the app creates, so an agent cannot forge a session leaf', async () => {
    const client = await h.connect(h.server.grant('s1', h.mine.id));
    const forged = await call(client, 'ui_create_leaf', { title: 'x', surfaceType: 'claude-session', surfaceId: 's-theirs' });
    expect(forged.isError && forged.text.startsWith('invalid_input'), 'claude-session leaf is refused').toBe(true);
    const unknownType = await call(client, 'ui_create_leaf', { title: 'x', surfaceType: 'made-up', surfaceId: 'x' });
    expect(unknownType.isError, 'a type outside the allowlist is refused').toBe(true);
    const browser = await call(client, 'ui_create_leaf', { title: 'x', surfaceType: 'browser-tab', surfaceId: 't1' });
    expect(browser.isError, 'a browser-tab leaf is allowed').toBe(false);
    expect(h.tree.children(h.mine.id).filter((n) => n.kind === 'leaf').map((n) => (n.kind === 'leaf' ? n.surfaceType : '')).sort(), 'leaves in the folder').toEqual(['browser-tab', 'claude-session']);
  });

  it('does not let a session remove its own folder', async () => {
    const client = await h.connect(h.server.grant('s1', h.mine.id));
    const result = await call(client, 'ui_remove_node', { nodeId: h.mine.id });
    expect(result.isError, 'removing the own folder is refused').toBe(true);
    expect(h.tree.get(h.mine.id), 'folder still exists').toBeDefined();
  });

  it('follows rescope for the next call', async () => {
    const grant = h.server.grant('s1', h.mine.id);
    const client = await h.connect(grant);
    h.server.rescope('s1', h.theirs.id);
    const surfaces = (await call(client, 'surfaces_list')).json() as { surfaces: { nodeId: string }[] };
    expect(surfaces.surfaces.map((s) => s.nodeId), 'scope moved to the other folder').toEqual([h.theirLeaf.id]);
  });

  it('emits ui.focus_node for a focus call', async () => {
    const client = await h.connect(h.server.grant('s1', h.mine.id));
    await call(client, 'ui_focus_node', { nodeId: h.myLeaf.id });
    expect(h.seen, 'focus event with the node id').toContainEqual({ type: 'ui.focus_node', nodeId: h.myLeaf.id });
  });

  it('returns validation errors an agent can read, as tool results', async () => {
    const client = await h.connect(h.server.grant('s1', h.mine.id));
    const missing = await call(client, 'ui_create_folder', {});
    expect(missing.isError, 'missing title is a tool error').toBe(true);
    expect(missing.text, 'names the field and the accepted fields').toMatch(/invalid_input: Invalid input for ui_create_folder\. title: .*Fields: title \(required\)/);
    const typo = await call(client, 'ui_create_folder', { title: 'x', name: 'y' });
    expect(typo.text, 'unknown field is named').toContain('name');
    const unknown = await call(client, 'no_such_tool');
    expect(unknown.isError && unknown.text.startsWith('not_found'), 'unknown tool is a not_found tool error').toBe(true);
    const blank = await call(client, 'ui_create_folder', { title: '   ' });
    expect(blank.text, 'blank title is rejected by the tree').toContain('invalid_input');
  });

  it('rejects a missing, wrong or foreign token with 401', async () => {
    const mine = h.server.grant('s1', h.mine.id);
    const other = h.server.grant('s2', h.theirs.id);
    const post = (url: string, auth?: string) =>
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(auth ? { Authorization: auth } : {}) },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
    expect((await post(mine.url)).status, 'no token').toBe(401);
    expect((await post(mine.url, 'Bearer wrong')).status, 'wrong token').toBe(401);
    expect((await post(mine.url, `Bearer ${other.token}`)).status, 'token of another session').toBe(401);
    expect((await post(`http://127.0.0.1:${h.port}/mcp/unknown`, `Bearer ${mine.token}`)).status, 'unknown session').toBe(401);
    expect((await post(mine.url, `Bearer ${mine.token}`)).status, 'right token').toBe(200);
  });

  it('rejects a request with an Origin header', async () => {
    const grant = h.server.grant('s1', h.mine.id);
    const response = await fetch(grant.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${grant.token}`, Origin: 'http://evil.example', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status, 'browser origin gets 403').toBe(403);
  });

  it('rejects a Host that is not the server address', async () => {
    const grant = h.server.grant('s1', h.mine.id);
    const status = (host: string) =>
      new Promise<number>((resolve, reject) => {
        const req = request(
          { host: '127.0.0.1', port: h.port, path: `/mcp/s1`, method: 'POST', headers: { host, Authorization: `Bearer ${grant.token}`, 'content-type': 'application/json' } },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        req.end('{}');
      });
    expect(await status('rebind.example'), 'foreign host name').toBe(403);
    expect(await status('127.0.0.1:1'), 'right name, wrong port').toBe(403);
    expect(await status(`localhost:${h.port}`), 'localhost with the port passes the guard').not.toBe(403);
  });

  it('answers a body over the size limit with 413', async () => {
    const grant = h.server.grant('s1', h.mine.id);
    const response = await fetch(grant.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${grant.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ pad: 'x'.repeat(1_100_000) }),
    });
    expect(response.status, 'oversized body gets 413').toBe(413);
  });

  it('refuses a GET because there is no server-initiated stream', async () => {
    const grant = h.server.grant('s1', h.mine.id);
    const response = await fetch(grant.url, { headers: { Authorization: `Bearer ${grant.token}` } });
    expect(response.status, 'GET is 405').toBe(405);
  });

  it('ends access on revoke and on a replaced grant', async () => {
    const first = h.server.grant('s1', h.mine.id);
    const second = h.server.grant('s1', h.mine.id);
    const status = (token: string) =>
      fetch(first.url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' }).then((r) => r.status);
    expect(await status(first.token), 'replaced token no longer works').toBe(401);
    expect(await status(second.token), 'new token passes authentication').not.toBe(401);
    h.server.revoke('s1');
    expect(await status(second.token), 'revoked token no longer works').toBe(401);
  });

  it('produces an --mcp-config with type http and the bearer header', () => {
    const grant = h.server.grant('s1', h.mine.id);
    expect(h.server.configFor('s1'), 'config carries type, url and token').toEqual({
      mcpServers: { app: { type: 'http', url: `http://127.0.0.1:${h.port}/mcp/s1`, headers: { Authorization: `Bearer ${grant.token}` } } },
    });
    expect(() => h.server.configFor('missing'), 'no grant, no config').toThrow();
  });

  it('listens on loopback with a token of at least 32 bytes', () => {
    const grant = h.server.grant('s1', h.mine.id);
    expect(grant.url.startsWith('http://127.0.0.1:'), 'loopback URL').toBe(true);
    expect(grant.token.length, 'hex of 32 bytes').toBeGreaterThanOrEqual(64);
  });

  it('sees commands registered after start', async () => {
    const client = await h.connect(h.server.grant('s1', h.mine.id));
    const { z } = await import('zod');
    h.registry.register({ id: 'late_ping', title: 'Ping', description: 'Pings.', input: z.strictObject({}), ui: false, mcp: true, run: () => 'pong' });
    expect((await client.listTools()).tools.map((t) => t.name), 'late command is a tool').toContain('late_ping');
  });
});
