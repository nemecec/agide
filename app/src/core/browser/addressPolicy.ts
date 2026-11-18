import { serviceForHost, SIGN_IN_HOSTS } from './services';
import type { ServiceId } from './types';

/** Who starts a navigation: the user (address field, click), an agent tool call, or the page (script, redirect). */
export type NavigationSource = 'user' | 'agent' | 'page';

export type UrlVerdict =
  | { readonly allow: true; readonly url: string }
  | { readonly allow: false; readonly reason: string }
  /** `mailto:` and `tel:` from a user click: the tab chrome asks "Open in the default app?". */
  | { readonly allow: false; readonly reason: string; readonly askExternal: string };

const HOST_LIKE = /^(localhost|\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+)(:[0-9]{1,5})?([/?#].*)?$/i;

/**
 * Address field and `navigate` input: a URL with a scheme stays as typed, input that parses as a host gets
 * `https://`, anything else is not a URL. There is no search.
 */
export function normalizeAddress(input: string): { readonly ok: true; readonly url: string } | { readonly ok: false; readonly reason: string } {
  const text = input.trim();
  if (text === '' || /\s/.test(text)) return { ok: false, reason: 'not a URL' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[a-z0-9.-]+:[0-9]{1,5}([/?#]|$)/i.test(text)) return { ok: true, url: text };
  if (!HOST_LIKE.test(text)) return { ok: false, reason: 'not a URL' };
  return { ok: true, url: `https://${text}` };
}

/** Schemes the browser surface loads: `http`, `https` and `about:blank`. Everything else is cancelled. */
export function checkUrl(raw: string, source: NavigationSource): UrlVerdict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { allow: false, reason: 'not a URL' };
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    if (url.username !== '' || url.password !== '') return { allow: false, reason: 'URLs with credentials are not loaded' };
    return { allow: true, url: url.href };
  }
  if (raw === 'about:blank') return { allow: true, url: raw };
  if ((url.protocol === 'mailto:' || url.protocol === 'tel:') && source === 'user') {
    return { allow: false, reason: `${url.protocol} opens in the default app`, askExternal: url.href };
  }
  return { allow: false, reason: `the ${url.protocol} scheme is not allowed in a browser tab; only http, https and about:blank load` };
}

/** True when the host is a sign-in host that belongs to no service. */
export function isSignInHost(host: string): boolean {
  return SIGN_IN_HOSTS.includes(host.toLowerCase());
}

/** Loopback hosts: the only ones where acting calls and navigation need no first-use ask. */
export function isLoopbackHost(host: string): boolean {
  const lower = host.toLowerCase();
  return lower === 'localhost' || lower === '127.0.0.1' || lower === '[::1]' || lower === '::1';
}

export type TopLevelDecision =
  | { readonly action: 'allow' }
  /** Cross-service navigation started by the page or the user: cancelled and opened as a tab of the target service. */
  | { readonly action: 'open_tab'; readonly service: ServiceId; readonly url: string }
  | { readonly action: 'cancel'; readonly reason: string };

/**
 * Top-level navigation of a tab of `current` (0026 section 5). Redirects stay in the tab, so callers pass
 * `redirect: true` for them and get `allow` for any http or https target. Sign-in hosts belong to no service
 * and never count as cross-service.
 */
export function decideTopLevel(input: { readonly current: ServiceId; readonly url: string; readonly source: NavigationSource; readonly redirect?: boolean }): TopLevelDecision {
  const verdict = checkUrl(input.url, input.source);
  if (!verdict.allow) return { action: 'cancel', reason: verdict.reason };
  if (input.redirect === true || verdict.url === 'about:blank') return { action: 'allow' };
  const target = serviceForHost(new URL(verdict.url).hostname);
  if (target === undefined || target === input.current) return { action: 'allow' };
  if (input.current === 'web' && target === 'web') return { action: 'allow' };
  return { action: 'open_tab', service: target, url: verdict.url };
}

/** Sign-in pop-up hosts that keep an opener (0026 section 5). `github.com/login/oauth` and similar match on host and path. */
const SIGN_IN_POPUPS: readonly { readonly host: string; readonly pathPrefix?: string }[] = [
  { host: 'accounts.google.com' },
  { host: 'login.microsoftonline.com' },
  { host: 'id.atlassian.com' },
  { host: 'github.com', pathPrefix: '/login/oauth' },
  { host: 'slack.com', pathPrefix: '/oauth' },
  { host: 'www.notion.so', pathPrefix: '/oauth' },
];

export type WindowOpenDecision =
  | { readonly action: 'deny'; readonly openTab?: { readonly service: ServiceId; readonly url: string } }
  | { readonly action: 'allow-signin-popup' };

/** `window.open` and `target=_blank`: a new tab, except a sign-in pop-up, which stays a child window. */
export function decideWindowOpen(input: { readonly current: ServiceId; readonly url: string }): WindowOpenDecision {
  const verdict = checkUrl(input.url, 'page');
  if (!verdict.allow || verdict.url === 'about:blank') return { action: 'deny' };
  const url = new URL(verdict.url);
  const popup = SIGN_IN_POPUPS.some((entry) => entry.host === url.hostname.toLowerCase() && (entry.pathPrefix === undefined || url.pathname.startsWith(entry.pathPrefix)));
  if (popup) return { action: 'allow-signin-popup' };
  const target = serviceForHost(url.hostname) ?? input.current;
  return { action: 'deny', openTab: { service: target, url: verdict.url } };
}

/** Permissions a service session grants: nothing except what 0026 section 2 lists. */
export const ALLOWED_PERMISSIONS: readonly string[] = ['fullscreen', 'clipboard-sanitized-write'];

export const isPermissionAllowed = (permission: string): boolean => ALLOWED_PERMISSIONS.includes(permission);
