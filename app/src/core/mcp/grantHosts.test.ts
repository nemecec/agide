import { request } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './testHarness';

let h: Harness;
beforeEach(async () => {
  h = await startHarness();
});
afterEach(() => h.close());

const status = (sessionId: string, host: string, token: string) =>
  new Promise<number>((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: h.port, path: `/mcp/${sessionId}`, method: 'POST', headers: { host, Authorization: `Bearer ${token}`, 'content-type': 'application/json' } },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end('{}');
  });

describe('Host allowance per grant', () => {
  it('accepts the Host a session grant names, for that session only', async () => {
    const container = `host.docker.internal:${h.port}`;
    const inside = h.server.grant('s1', h.mine.id, { hostHeaders: [container] });
    const other = h.server.grant('s2', h.mine.id);
    expect(await status('s1', container, inside.token), 'granted Host passes the guard').not.toBe(403);
    expect(await status('s2', container, other.token), 'another session cannot use that Host').toBe(403);
    expect(await status('s1', `rebind.example:${h.port}`, inside.token), 'a Host the grant does not name').toBe(403);
    h.server.revoke('s1');
    expect(await status('s1', container, inside.token), 'Host allowance ends with the grant').toBe(403);
  });
});
