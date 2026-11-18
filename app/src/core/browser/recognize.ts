import { serviceForHost } from './services';
import type { ServiceObject } from './types';

const JIRA_KEY = /^[A-Z][A-Z0-9_]+-[0-9]+$/;
const GITHUB_NAME = /^[A-Za-z0-9_.-]+$/;
const GITHUB_NON_OWNERS = new Set(['settings', 'orgs', 'marketplace', 'notifications', 'login', 'logout', 'explore', 'topics', 'sponsors', 'features', 'about', 'pricing', 'search', 'new', 'apps', 'users']);

/**
 * The object a URL names, from the parsed host and path segments (0026 section 2). A URL that matches no
 * pattern gives `undefined`, never a guess.  Slack and Notion follow the survey patterns, whose
 * URL formats are checked against real URLs; until then a Slack or Notion URL that does not match gives no object.
 */
export function recognize(raw: string): ServiceObject | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  const segments = url.pathname.split('/').filter((segment) => segment !== '').map(decodeSegment);
  switch (serviceForHost(url.hostname)) {
    case 'jira':
      return jira(url, segments);
    case 'github':
      return github(segments);
    case 'slack':
      return slack(url, segments);
    case 'notion':
      return notion(url, segments);
    default:
      return undefined;
  }
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return '';
  }
}

function jira(url: URL, segments: readonly string[]): ServiceObject | undefined {
  const site = url.hostname.toLowerCase();
  if (segments[0] === 'browse' && segments.length === 2 && JIRA_KEY.test(segments[1] ?? '')) return { service: 'jira', kind: 'issue', id: segments[1] ?? '', site };
  const selected = url.searchParams.get('selectedIssue');
  if (selected !== null && JIRA_KEY.test(selected)) return { service: 'jira', kind: 'issue', id: selected, site };
  return undefined;
}

function github(segments: readonly string[]): ServiceObject | undefined {
  const [owner, repo, section, value] = segments;
  if (owner === undefined || repo === undefined || GITHUB_NON_OWNERS.has(owner.toLowerCase())) return undefined;
  if (!GITHUB_NAME.test(owner) || !GITHUB_NAME.test(repo)) return undefined;
  const slug = `${owner}/${repo}`;
  if (section === undefined) return { service: 'github', kind: 'repository', id: slug };
  if (section === 'pull' && /^[0-9]+$/.test(value ?? '')) return { service: 'github', kind: 'pull_request', id: `${slug}#${value}` };
  if (section === 'issues' && /^[0-9]+$/.test(value ?? '')) return { service: 'github', kind: 'issue', id: `${slug}#${value}` };
  if (section === 'commit' && /^[0-9a-f]{7,40}$/i.test(value ?? '')) return { service: 'github', kind: 'commit', id: `${slug}@${value}` };
  if (section === 'actions' && value === 'runs' && /^[0-9]+$/.test(segments[4] ?? '')) return { service: 'github', kind: 'run', id: `${slug}/runs/${segments[4]}` };
  return undefined;
}

const SLACK_ID = /^[A-Z][A-Z0-9]{6,}$/;

/** Slack patterns of the survey, unverified against real URLs. */
function slack(url: URL, segments: readonly string[]): ServiceObject | undefined {
  const host = url.hostname.toLowerCase();
  if (host === 'app.slack.com' && segments[0] === 'client' && SLACK_ID.test(segments[1] ?? '') && SLACK_ID.test(segments[2] ?? '')) {
    const [, team, channel, marker, threadRef] = segments;
    if (marker === 'thread' && threadRef !== undefined) {
      const stamp = /^[A-Z0-9]+-([0-9]+\.[0-9]+)$/.exec(threadRef)?.[1];
      if (stamp !== undefined) return { service: 'slack', kind: 'thread', id: `${channel}/${stamp}`, site: team ?? '' };
    }
    return { service: 'slack', kind: 'channel', id: channel ?? '', site: team ?? '' };
  }
  if (host.endsWith('.slack.com') && segments[0] === 'archives' && SLACK_ID.test(segments[1] ?? '') && /^p[0-9]{7,}$/.test(segments[2] ?? '')) {
    const digits = (segments[2] ?? '').slice(1);
    const stamp = `${digits.slice(0, -6)}.${digits.slice(-6)}`;
    const threadTs = url.searchParams.get('thread_ts');
    if (threadTs !== null && /^[0-9]+\.[0-9]+$/.test(threadTs)) return { service: 'slack', kind: 'thread', id: `${segments[1]}/${threadTs}`, site: host };
    return { service: 'slack', kind: 'message', id: `${segments[1]}/${stamp}`, site: host };
  }
  return undefined;
}

const dashed = (hex: string): string => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toLowerCase();

/** Notion: a page id of 32 hex digits ends the last path segment or is the `p` query value; unverified against real URLs. */
function notion(url: URL, segments: readonly string[]): ServiceObject | undefined {
  const fromQuery = url.searchParams.get('p');
  if (fromQuery !== null && /^[0-9a-f]{32}$/i.test(fromQuery)) return { service: 'notion', kind: 'page', id: dashed(fromQuery) };
  const last = segments[segments.length - 1];
  const hex = last === undefined ? undefined : /(?:^|-)([0-9a-f]{32})$/i.exec(last)?.[1];
  return hex === undefined ? undefined : { service: 'notion', kind: 'page', id: dashed(hex) };
}
