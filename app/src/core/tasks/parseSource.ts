import type { TaskSource } from './types';

const OWNER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,38}$/;
const REPO = /^[A-Za-z0-9_.-]{1,100}$/;
const PR_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/([0-9]{1,9})(?:\/(?:files|commits|checks|changes)?)?(?:#[^\s]*)?$/;
const PR_SHORT = /^([^/\s]+)\/([^/#\s]+)#([0-9]{1,9})$/;
const JIRA_KEY = /^[A-Z][A-Z0-9_]{1,9}-[0-9]{1,7}$/;
const JIRA_URL = /^https:\/\/([a-z0-9][a-z0-9-]*\.atlassian\.net)\/browse\/([A-Z][A-Z0-9_]{1,9}-[0-9]{1,7})$/;

/**
 * The source of a task start (0028 section 9). Strict: the whole input must match one form; anything else is
 * a prompt. Owner and repo are checked here so they can be passed to `gh` as separate arguments.
 */
export function parseTaskSource(raw: string): TaskSource {
  const text = raw.trim();
  const pr = PR_URL.exec(text) ?? PR_SHORT.exec(text);
  if (pr) {
    const [, owner = '', repo = '', number = ''] = pr;
    if (OWNER.test(owner) && REPO.test(repo) && repo !== '.' && repo !== '..') {
      return { kind: 'pull-request', host: 'github.com', owner, repo, number: Number(number) };
    }
  }
  if (JIRA_KEY.test(text)) return { kind: 'jira', key: text };
  const jira = JIRA_URL.exec(text);
  if (jira) return { kind: 'jira', key: jira[2] ?? '', site: jira[1] ?? '' };
  return { kind: 'prompt', text };
}

/** The folder title of a start: `PR #<n> <title>` comes later from `gh`; until then the reference. */
export function sourceTitle(source: TaskSource): string {
  switch (source.kind) {
    case 'prompt':
      return (source.text.split('\n')[0] ?? '').slice(0, 60);
    case 'pull-request':
      return `PR #${source.number}`;
    case 'jira':
      return source.key;
  }
}
