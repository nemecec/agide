import { describe, expect, it } from 'vitest';
import { decideWindowOpen, isAppFrameUrl, mainWindowWebPreferences } from './windowPolicy';

const BUILT = { rendererDirUrl: 'file:///opt/agide/out/renderer' };
const WITH_DEV = { ...BUILT, devServerUrl: 'http://localhost:5173/' };

describe('isAppFrameUrl', () => {
  it('accepts the built page', () => {
    expect(isAppFrameUrl('file:///opt/agide/out/renderer/index.html', BUILT), 'built page').toBe(true);
  });

  it('refuses a file outside the renderer directory, also one that shares the name prefix', () => {
    expect(isAppFrameUrl('file:///opt/agide/out/main/index.js', BUILT), 'main bundle').toBe(false);
    expect(isAppFrameUrl('file:///opt/agide/out/renderer-evil/index.html', BUILT), 'sibling directory with the same prefix').toBe(false);
    expect(isAppFrameUrl('file:///tmp/page.html', BUILT), 'unrelated file').toBe(false);
  });

  it('refuses web pages and blank frames when no dev server is set', () => {
    expect(isAppFrameUrl('https://example.com/', BUILT), 'web page').toBe(false);
    expect(isAppFrameUrl('http://localhost:5173/', BUILT), 'dev server address without a dev server').toBe(false);
    expect(isAppFrameUrl('about:blank', BUILT), 'blank frame').toBe(false);
    expect(isAppFrameUrl('', BUILT), 'empty url').toBe(false);
  });

  it('accepts the dev server origin and refuses other origins', () => {
    expect(isAppFrameUrl('http://localhost:5173/index.html', WITH_DEV), 'dev server page').toBe(true);
    expect(isAppFrameUrl('http://localhost:5174/', WITH_DEV), 'other port').toBe(false);
    expect(isAppFrameUrl('https://localhost:5173/', WITH_DEV), 'other scheme').toBe(false);
    expect(isAppFrameUrl('http://localhost.evil.test:5173/', WITH_DEV), 'look-alike host').toBe(false);
  });

  it('refuses a URL that does not parse instead of throwing', () => {
    expect(isAppFrameUrl('not a url', WITH_DEV), 'garbage').toBe(false);
    expect(isAppFrameUrl('', WITH_DEV), 'empty').toBe(false);
  });
});

describe('decideWindowOpen', () => {
  it('denies every window and hands a web link to the browser', () => {
    expect(decideWindowOpen('https://example.com/a'), 'https link').toEqual({ action: 'deny', openExternal: 'https://example.com/a' });
    expect(decideWindowOpen('http://example.com/'), 'http link').toEqual({ action: 'deny', openExternal: 'http://example.com/' });
  });

  it('denies other schemes without opening anything', () => {
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'about:blank', 'ssh://host', 'HTTPS://example.com']) {
      expect(decideWindowOpen(url), `${url} is denied and not opened`).toEqual({ action: 'deny' });
    }
  });
});

describe('mainWindowWebPreferences', () => {
  it('sandboxes the renderer, isolates the context and gives it no Node', () => {
    expect(mainWindowWebPreferences('/p/preload.cjs')).toEqual({ preload: '/p/preload.cjs', contextIsolation: true, sandbox: true, nodeIntegration: false });
  });
});
