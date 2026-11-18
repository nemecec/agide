import { describe, expect, it, vi } from 'vitest';
import { SurfaceTypeRegistry } from '../surfaces/SurfaceTypeRegistry';
import { browserSurfaceType } from './surfaceType';

const hooks = () => ({ snapshot: vi.fn(async (_state, kind) => ({ kind, content: 'x', untrusted: true })), place: vi.fn(), dispose: vi.fn() });

describe('browser-tab surface type', () => {
  it('creates state from a URL with the recognizer service, the service default and a fresh number', async () => {
    let next = 7;
    const type = browserSurfaceType('browser-tab', hooks(), () => next++);
    const github = await type.create({ folderId: 'f', url: 'github.com/acme/app' });
    expect(github, 'github tab').toMatchObject({ url: 'https://github.com/acme/app', service: 'github', observe: 'on-demand', tabNumber: 7, createdBy: 'user', title: 'github.com' });
    expect(await type.create({ folderId: 'f' }), 'no URL gives an empty web tab').toMatchObject({ url: 'about:blank', service: 'web', tabNumber: 8, title: 'New tab' });
    await expect(type.create({ folderId: 'f', url: 'file:///etc/passwd' }), 'a file URL').rejects.toThrow('scheme is not allowed');
  });

  it('is the Slack variant with off as its default and no live mode', async () => {
    const slack = browserSurfaceType('slack-thread', hooks(), () => 1);
    expect(slack.observe?.defaultMode, 'default off').toBe('off');
    expect(slack.observe?.modes, 'no live mode').toEqual(['off', 'on-demand']);
    expect((await slack.create({ folderId: 'f', url: 'https://app.slack.com/client/T0000001/C0000001' })).service, 'slack service whatever the host').toBe('slack');
  });

  it('serializes and restores state and refuses a saved value that is not a tab state', async () => {
    const type = browserSurfaceType('browser-tab', hooks(), () => 1);
    const state = await type.create({ folderId: 'f', url: 'https://example.com/' });
    expect(type.restore(JSON.parse(JSON.stringify(type.serialize(state)))), 'round trip').toEqual(state);
    expect(() => type.restore({ url: 5 }), 'malformed state').toThrow();
    expect(() => type.restore({ ...state, service: 'ftp' }), 'unknown service').toThrow();
    expect(type.title(state), 'title').toBe('example.com');
  });

  it('forwards bounds and disposal to the hooks and the snapshot to observation', async () => {
    const h = hooks();
    const type = browserSurfaceType('browser-tab', h, () => 1);
    const state = await type.create({ folderId: 'f', url: 'https://example.com/' });
    const instance = type.mount({ surfaceId: 's', nodeId: 'n', state, setState: () => undefined, setTitle: () => undefined });
    instance.setBounds({ x: 1, y: 2, width: 3, height: 4 });
    instance.dispose();
    expect(h.place, 'bounds').toHaveBeenCalledWith(state, { x: 1, y: 2, width: 3, height: 4 });
    expect(h.dispose, 'dispose').toHaveBeenCalledWith(state);
    expect(await type.observe?.snapshot(state, 'text'), 'snapshot').toMatchObject({ kind: 'text', untrusted: true });
  });
});

describe('surface type registry', () => {
  it('registers a type once and lists it', () => {
    const registry = new SurfaceTypeRegistry();
    const type = browserSurfaceType('browser-tab', hooks(), () => 1);
    const unregister = registry.register(type);
    expect(registry.get('browser-tab'), 'found').toBe(type);
    expect(() => registry.register(type), 'twice').toThrow('already registered');
    unregister();
    expect(registry.list(), 'unregistered').toEqual([]);
  });
});
