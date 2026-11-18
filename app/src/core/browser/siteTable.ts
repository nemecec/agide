import { isLoopbackHost } from './addressPolicy';
import type { ServiceId } from './types';

export type SiteDecision = 'allow' | 'ask' | 'deny';

/**
 * Default for an acting call by service and origin (0026 section 3 table). `slack` and `discord` deny;
 * `jira`, `github` and `notion` ask on every call and deny `javascript_tool` unless the user enabled it for
 * the site; `web` allows loopback and asks once per session and origin elsewhere.
 */
export function defaultSiteDecision(input: { readonly service: ServiceId; readonly origin: string; readonly tool: string }): SiteDecision {
  if (input.service === 'slack' || input.service === 'discord') return 'deny';
  if (input.service === 'web') return isLoopbackOrigin(input.origin) ? 'allow' : 'ask';
  return 'ask';
}

export function isLoopbackOrigin(origin: string): boolean {
  try {
    return isLoopbackHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/**
 * Grants the user gave. A session grant lasts for one session and origin and ends on "Stop agent"; an
 * always-allow grant is per origin for the profile. Service origins never take a standing grant for acting
 * calls, only a session grant, and `javascript_tool` on them needs an explicit script grant.
 */
export class SiteGrants {
  private readonly session = new Set<string>();
  private readonly always = new Set<string>();
  private readonly scripts = new Set<string>();
  private readonly navigationSession = new Set<string>();
  private readonly navigationAlways = new Set<string>();

  allowForSession(sessionId: string, origin: string): void {
    this.session.add(`${sessionId} ${origin}`);
  }

  allowAlways(origin: string): void {
    this.always.add(origin);
  }

  /** An answer to "open this origin". It never counts as a grant for clicks, typing or scripts there. */
  allowNavigationForSession(sessionId: string, origin: string): void {
    this.navigationSession.add(`${sessionId} ${origin}`);
  }

  allowNavigationAlways(origin: string): void {
    this.navigationAlways.add(origin);
  }

  allowScripts(origin: string): void {
    this.scripts.add(origin);
  }

  revokeSession(sessionId: string, origin?: string): void {
    for (const key of [...this.session]) {
      if (key.startsWith(`${sessionId} `) && (origin === undefined || key === `${sessionId} ${origin}`)) this.session.delete(key);
    }
  }

  /** The decision for one acting call after the grants apply. `ask` means the user must answer. */
  decide(input: { readonly service: ServiceId; readonly sessionId: string; readonly origin: string; readonly tool: string; readonly everyCall?: boolean }): SiteDecision {
    const base = defaultSiteDecision(input);
    if (base === 'deny' || base === 'allow') return base;
    const serviceOrigin = input.service !== 'web';
    if (serviceOrigin && input.tool === 'javascript_tool' && !this.scripts.has(input.origin)) return 'deny';
    if (serviceOrigin) return this.session.has(`${input.sessionId} ${input.origin}`) ? 'allow' : 'ask';
    if (this.always.has(input.origin) || this.session.has(`${input.sessionId} ${input.origin}`)) return 'allow';
    return 'ask';
  }

  /**
   * Agent navigation to an origin outside loopback, the site table and the session's allowlist asks once per
   * session and origin (0026 section 3).
   */
  navigationDecision(input: { readonly sessionId: string; readonly origin: string; readonly allowlisted: boolean }): SiteDecision {
    if (isLoopbackOrigin(input.origin) || input.allowlisted) return 'allow';
    return this.navigationAlways.has(input.origin) || this.navigationSession.has(`${input.sessionId} ${input.origin}`) ? 'allow' : 'ask';
  }
}
