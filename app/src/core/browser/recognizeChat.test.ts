import { describe, expect, it } from 'vitest';
import { recognize } from './recognize';

describe('Slack and Notion recognizer', () => {
  it.each([
    ['https://app.slack.com/client/T0123ABC/C0456DEF', { service: 'slack', kind: 'channel', id: 'C0456DEF', site: 'T0123ABC' }],
    ['https://app.slack.com/client/T0123ABC/C0456DEF/thread/C0456DEF-1731840000.000100', { service: 'slack', kind: 'thread', id: 'C0456DEF/1731840000.000100' }],
    ['https://acme.slack.com/archives/C0456DEF/p1731840000000100', { service: 'slack', kind: 'message', id: 'C0456DEF/1731840000.000100' }],
    ['https://acme.slack.com/archives/C0456DEF/p1731840000000200?thread_ts=1731840000.000100', { service: 'slack', kind: 'thread', id: 'C0456DEF/1731840000.000100' }],
    ['https://www.notion.so/Project-plan-0123456789abcdef0123456789abcdef', { service: 'notion', kind: 'page', id: '01234567-89ab-cdef-0123-456789abcdef' }],
    ['https://acme.notion.site/0123456789ABCDEF0123456789ABCDEF', { service: 'notion', kind: 'page', id: '01234567-89ab-cdef-0123-456789abcdef' }],
    ['https://www.notion.so/workspace?p=0123456789abcdef0123456789abcdef', { service: 'notion', kind: 'page', id: '01234567-89ab-cdef-0123-456789abcdef' }],
  ])('recognizes %s', (url, expected) => {
    expect(recognize(url), url).toMatchObject(expected);
  });

  it.each([
    'https://app.slack.com/client/T0123ABC',
    'https://app.slack.com/ssb/redirect',
    'https://acme.slack.com/archives/C0456DEF',
    'https://www.notion.so/Project-plan',
    'https://www.notion.so/0123456789abcdef0123456789abcdeg',
    'https://evil.example/archives/C0456DEF/p1731840000000100',
    'https://example.com/?p=0123456789abcdef0123456789abcdef',
  ])('gives no object for %s, never a wrong one', (url) => {
    expect(recognize(url), url).toBeUndefined();
  });
});
