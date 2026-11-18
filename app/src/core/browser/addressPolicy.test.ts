import { describe, expect, it } from 'vitest';
import { ALLOWED_PERMISSIONS, checkUrl, decideTopLevel, decideWindowOpen, isLoopbackHost, isPermissionAllowed, normalizeAddress } from './addressPolicy';

describe('address field input', () => {
  it('adds https to a host, keeps a scheme, and refuses anything that is not an address', () => {
    expect(normalizeAddress('example.com/path?q=1'), 'bare host with path').toEqual({ ok: true, url: 'https://example.com/path?q=1' });
    expect(normalizeAddress('localhost:3000'), 'host with port').toEqual({ ok: true, url: 'https://localhost:3000' });
    expect(normalizeAddress('http://127.0.0.1:8080/x'), 'explicit scheme').toEqual({ ok: true, url: 'http://127.0.0.1:8080/x' });
    expect(normalizeAddress('how do I fix this'), 'a query would go to a search engine').toEqual({ ok: false, reason: 'not a URL' });
    expect(normalizeAddress('   '), 'blank').toEqual({ ok: false, reason: 'not a URL' });
    expect(normalizeAddress('singleword'), 'one word without a dot').toEqual({ ok: false, reason: 'not a URL' });
  });
});

describe('scheme policy', () => {
  it.each(['file:///etc/passwd', 'data:text/html,<b>x</b>', 'javascript:alert(1)', 'blob:https://a.example/1', 'chrome://settings', 'devtools://devtools/x', 'view-source:https://a.example', 'custom-app://open'])('cancels %s', (url) => {
    expect(checkUrl(url, 'agent').allow, url).toBe(false);
    expect(checkUrl(url, 'page').allow, `${url} from a page`).toBe(false);
  });

  it('loads http, https and about:blank and refuses credentials in the URL', () => {
    expect(checkUrl('https://example.com/a?b=c#d', 'user'), 'https').toEqual({ allow: true, url: 'https://example.com/a?b=c#d' });
    expect(checkUrl('http://127.0.0.1:9/', 'agent').allow, 'http loopback').toBe(true);
    expect(checkUrl('about:blank', 'agent'), 'blank').toEqual({ allow: true, url: 'about:blank' });
    expect(checkUrl('https://user:pw@example.com/', 'agent').allow, 'credentials').toBe(false);
  });

  it('offers mailto and tel to the user only and refuses them from agents and pages', () => {
    expect(checkUrl('mailto:a@example.com', 'user'), 'user click').toMatchObject({ allow: false, askExternal: 'mailto:a@example.com' });
    expect(checkUrl('mailto:a@example.com', 'agent'), 'agent').not.toHaveProperty('askExternal');
    expect(checkUrl('tel:+3725550000', 'page'), 'page').not.toHaveProperty('askExternal');
  });
});

describe('top-level navigation', () => {
  it('opens a tab of the target service for a cross-service link and keeps same-service and redirect navigation in the tab', () => {
    expect(decideTopLevel({ current: 'jira', url: 'https://github.com/acme/app/pull/1', source: 'page' }), 'jira to github').toEqual({ action: 'open_tab', service: 'github', url: 'https://github.com/acme/app/pull/1' });
    expect(decideTopLevel({ current: 'github', url: 'https://github.com/acme/app', source: 'user' }).action, 'same service').toBe('allow');
    expect(decideTopLevel({ current: 'jira', url: 'https://github.com/x/y', source: 'page', redirect: true }).action, 'redirect stays').toBe('allow');
    expect(decideTopLevel({ current: 'jira', url: 'https://id.atlassian.com/login', source: 'page' }).action, 'sign-in host belongs to no service').toBe('allow');
    expect(decideTopLevel({ current: 'github', url: 'https://github.com.evil.example/', source: 'page' }).action, 'look-alike host is another service').toBe('open_tab');
    expect(decideTopLevel({ current: 'web', url: 'https://other.example/', source: 'page' }).action, 'web to web').toBe('allow');
  });

  it('cancels a scheme outside the allow list even for a redirect', () => {
    expect(decideTopLevel({ current: 'web', url: 'file:///etc/hosts', source: 'page', redirect: true }).action, 'redirect to file').toBe('cancel');
  });
});

describe('window.open', () => {
  it('turns window.open into a tab of the target service and keeps only sign-in pop-ups as child windows', () => {
    expect(decideWindowOpen({ current: 'jira', url: 'https://github.com/acme/app' }), 'link target').toEqual({ action: 'deny', openTab: { service: 'github', url: 'https://github.com/acme/app' } });
    expect(decideWindowOpen({ current: 'web', url: 'https://accounts.google.com/o/oauth2/auth' }).action, 'google sign-in').toBe('allow-signin-popup');
    expect(decideWindowOpen({ current: 'web', url: 'https://github.com/login/oauth/authorize' }).action, 'github oauth path').toBe('allow-signin-popup');
    expect(decideWindowOpen({ current: 'web', url: 'https://github.com/acme/app' }).action, 'github other path').toBe('deny');
    expect(decideWindowOpen({ current: 'web', url: 'javascript:alert(1)' }), 'javascript target').toEqual({ action: 'deny' });
  });
});

describe('permissions and loopback', () => {
  it('allows fullscreen and sanitized clipboard writes only', () => {
    expect(ALLOWED_PERMISSIONS, 'allow list').toEqual(['fullscreen', 'clipboard-sanitized-write']);
    for (const permission of ['notifications', 'geolocation', 'media', 'midi', 'clipboard-read', 'hid', 'serial', 'usb', 'display-capture']) expect(isPermissionAllowed(permission), permission).toBe(false);
  });

  it('knows the loopback hosts', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]', 'LOCALHOST']) expect(isLoopbackHost(host), host).toBe(true);
    expect(isLoopbackHost('127.0.0.1.evil.example'), 'look-alike').toBe(false);
  });
});
