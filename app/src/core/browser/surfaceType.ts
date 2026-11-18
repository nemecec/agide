import { z } from 'zod';
import { SURFACE_BROWSER_TAB, SURFACE_SLACK_THREAD, type ObserveSnapshot, type SurfaceType } from '../surfaces/types';
import { checkUrl, normalizeAddress } from './addressPolicy';
import { OBSERVATION_DEFAULT, serviceForHost } from './services';
import type { BrowserTabState } from './types';

const stateSchema = z.object({
  url: z.string(),
  title: z.string(),
  service: z.enum(['jira', 'github', 'notion', 'slack', 'discord', 'web']),
  observe: z.enum(['off', 'on-demand', 'live']),
  tabNumber: z.number().int().positive(),
  createdBy: z.string(),
  zoom: z.number().positive(),
  history: z.object({ entries: z.array(z.object({ url: z.string(), title: z.string() })), index: z.number().int() }).optional(),
});

export interface BrowserSurfaceHooks {
  /** `surfaces_observe` for a tab, through the hosted tools. */
  snapshot(state: BrowserTabState, kind: ObserveSnapshot['kind']): Promise<ObserveSnapshot>;
  place(state: BrowserTabState, bounds: { x: number; y: number; width: number; height: number }): void;
  dispose(state: BrowserTabState): void;
}

/**
 * The `browser-tab` surface type, and `slack-thread` as its Slack variant with its own defaults (0026 sections
 * 1 and 2). The state is serialized with the leaf; cookies and site storage live in the partition, never here.
 */
export function browserSurfaceType(id: typeof SURFACE_BROWSER_TAB | typeof SURFACE_SLACK_THREAD, hooks: BrowserSurfaceHooks, allocate: () => number): SurfaceType<BrowserTabState> {
  const slack = id === SURFACE_SLACK_THREAD;
  return {
    id,
    label: slack ? 'Slack thread' : 'Browser tab',
    icon: slack ? 'slack' : 'globe',
    async create(input) {
      const normalized = normalizeAddress(input.url ?? 'about:blank');
      const url = normalized.ok ? normalized.url : 'about:blank';
      const verdict = checkUrl(url, 'user');
      if (!verdict.allow) throw new Error(verdict.reason);
      const service = slack ? 'slack' : verdict.url === 'about:blank' ? 'web' : (serviceForHost(new URL(verdict.url).hostname) ?? 'web');
      return { url: verdict.url, title: input.title ?? (verdict.url === 'about:blank' ? 'New tab' : new URL(verdict.url).hostname), service, observe: OBSERVATION_DEFAULT[service], tabNumber: allocate(), createdBy: 'user', zoom: 1 };
    },
    title: (state) => state.title,
    serialize: (state) => state,
    restore(saved) {
      const parsed = stateSchema.parse(saved);
      return { ...parsed, createdBy: parsed.createdBy } as BrowserTabState;
    },
    mount(host) {
      const state = host.state;
      return {
        focus: () => undefined,
        reveal: () => undefined,
        setBounds: (bounds) => hooks.place(state, bounds),
        dispose: () => hooks.dispose(state),
      };
    },
    observe: {
      modes: slack ? ['off', 'on-demand'] : ['off', 'on-demand', 'live'],
      defaultMode: slack ? 'off' : 'on-demand',
      snapshot: (state, kind) => hooks.snapshot(state, kind),
    },
    actions: [],
  };
}
