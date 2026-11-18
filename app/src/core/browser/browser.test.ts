import { describe, expect, it } from 'vitest';
import { InMemoryObservationService } from './InMemoryObservationService';
import { describeObservationServiceContract } from './observationServiceContract';
import { recognize } from './recognize';
import { serviceForHost } from './services';
import { BROWSER_TOOL_INPUTS, BROWSER_TOOL_STATUS, browserCommandId, isActingCall } from './toolSchemas';

describeObservationServiceContract('InMemoryObservationService', (now) => new InMemoryObservationService(now));

describe('service of a host', () => {
  it('maps the service hosts, keeps sign-in hosts out of every service and puts the rest in web', () => {
    expect(serviceForHost('acme.atlassian.net'), 'jira site').toBe('jira');
    expect(serviceForHost('GitHub.com'), 'case-insensitive').toBe('github');
    expect(serviceForHost('app.slack.com'), 'slack').toBe('slack');
    expect(serviceForHost('id.atlassian.com'), 'sign-in host').toBeUndefined();
    expect(serviceForHost('github.com.evil.example'), 'look-alike host').toBe('web');
  });
});

describe('recognizer', () => {
  it.each([
    ['https://acme.atlassian.net/browse/ABC-77', { service: 'jira', kind: 'issue', id: 'ABC-77', site: 'acme.atlassian.net' }],
    ['https://acme.atlassian.net/jira/software/projects/ABC/boards/1?selectedIssue=ABC-9', { service: 'jira', kind: 'issue', id: 'ABC-9' }],
    ['https://github.com/acme/app/pull/418/files', { service: 'github', kind: 'pull_request', id: 'acme/app#418' }],
    ['https://github.com/acme/app/issues/3', { service: 'github', kind: 'issue', id: 'acme/app#3' }],
    ['https://github.com/acme/app/actions/runs/99', { service: 'github', kind: 'run', id: 'acme/app/runs/99' }],
    ['https://github.com/acme/app/commit/abc1234', { service: 'github', kind: 'commit', id: 'acme/app@abc1234' }],
    ['https://github.com/acme/app', { service: 'github', kind: 'repository', id: 'acme/app' }],
  ])('recognizes %s', (url, expected) => {
    expect(recognize(url), url).toMatchObject(expected);
  });

  it.each([
    'https://github.com/settings/profile',
    'https://github.com/acme/app/pull/abc',
    'https://evil.example/browse/ABC-1',
    'https://acme.atlassian.net/browse/abc-1',
    'javascript:alert(1)',
    'not a url',
    'https://example.com/?u=https://github.com/acme/app/pull/1',
  ])('gives no object for %s', (url) => {
    expect(recognize(url), url).toBeUndefined();
  });
});

describe('browser tool schemas', () => {
  it('cover every tool the first slice hosts, with command ids under the browser prefix', () => {
    const hosted = Object.entries(BROWSER_TOOL_STATUS).filter(([, status]) => status === 'yes' || status === 'partial').map(([name]) => name);
    for (const name of hosted) expect(Object.keys(BROWSER_TOOL_INPUTS), name).toContain(name);
    expect(browserCommandId('navigate'), 'command id').toBe('browser_navigate');
  });

  it('accept the Claude in Chrome shapes and refuse unknown fields', () => {
    expect(BROWSER_TOOL_INPUTS.computer.safeParse({ action: 'left_click', tabId: 1, coordinate: [10, 20], action_summary: 'Click Save' }).success, 'computer click').toBe(true);
    expect(BROWSER_TOOL_INPUTS.navigate.safeParse({ url: 'example.com', extra: 1 }).success, 'unknown field').toBe(false);
    expect(BROWSER_TOOL_INPUTS.computer.safeParse({ action: 'scroll', tabId: 1, scroll_amount: 11 }).success, 'scroll amount above 10').toBe(false);
  });

  it('class clicks, typing, form input and scripts as acting calls and reads as not', () => {
    expect(isActingCall('computer', { action: 'left_click' }), 'click').toBe(true);
    expect(isActingCall('computer', { action: 'screenshot' }), 'screenshot').toBe(false);
    expect(isActingCall('javascript_tool', {}), 'script').toBe(true);
    expect(isActingCall('read_page', {}), 'read').toBe(false);
  });
});
