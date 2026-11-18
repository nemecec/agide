import { describe, expect, it } from 'vitest';
import { placementOf, placementRequest, splitUrl } from './model';

describe('address display', () => {
  it('splits the URL around the host so the host can be emphasised', () => {
    expect(splitUrl('https://github.com/acme/app/pull/1?x=1'), 'github URL').toEqual({ before: 'https://', host: 'github.com', after: '/acme/app/pull/1?x=1' });
    expect(splitUrl('http://127.0.0.1:8080/'), 'loopback with port').toEqual({ before: 'http://', host: '127.0.0.1:8080', after: '/' });
    expect(splitUrl('about:blank'), 'blank page').toEqual({ before: '', host: 'about:blank', after: '' });
  });

  it('keeps a look-alike host whole, so a page cannot make the real origin look like something else', () => {
    const parts = splitUrl('https://github.com@evil.example/path');
    expect(parts.host, 'host after the credentials').toBe('evil.example');
    expect(parts.before, 'credentials stay in the dimmed part').toBe('https://github.com@');
  });
});

describe('slot placement', () => {
  it('reports the rectangle and nothing for a slot without area', () => {
    expect(placementOf({ left: 10, top: 20, width: 300, height: 200 }), 'visible slot').toEqual({ x: 10, y: 20, width: 300, height: 200 });
    expect(placementOf({ left: 10, top: 20, width: 0, height: 200 }), 'hidden pane').toBeUndefined();
  });
});

describe('placement requests', () => {
  const rect = { left: 10, top: 20, width: 300, height: 200 };

  it('asks for a shown view at the rectangle the first time', () => {
    expect(placementRequest(rect, undefined), 'first request').toMatchObject({ bounds: { x: 10, y: 20, width: 300, height: 200 }, visible: true });
  });

  it('asks for nothing while the rectangle is unchanged and again after it changes', () => {
    const first = placementRequest(rect, undefined)!;
    expect(placementRequest(rect, first.key), 'unchanged').toBeUndefined();
    expect(placementRequest({ ...rect, width: 301 }, first.key), 'resized').toMatchObject({ visible: true, bounds: { width: 301 } });
  });

  it('asks for a hidden view once when the slot loses its area and once when it returns', () => {
    const shown = placementRequest(rect, undefined)!;
    const hidden = placementRequest({ ...rect, height: 0 }, shown.key)!;
    expect(hidden, 'hidden request').toMatchObject({ visible: false, bounds: { x: 0, y: 0, width: 0, height: 0 } });
    expect(placementRequest({ ...rect, height: 0 }, hidden.key), 'still hidden').toBeUndefined();
    expect(placementRequest(rect, hidden.key), 'shown again').toMatchObject({ visible: true });
  });
});
