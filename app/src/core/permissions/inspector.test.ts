import { describe, expect, it } from 'vitest';
import { ACTION_CLASSES } from './classTable';
import { runGate } from './gateRun';
import { ToolCallInspector } from './inspector';
import type { ActionClassId, GateFile, OutwardMode, PreToolUsePayload } from './types';

const inspector = new ToolCallInspector();
const gate = (outward: Partial<Record<ActionClassId, OutwardMode>> = {}): GateFile => ({
  schema: 1,
  sessionId: 's1',
  table: ACTION_CLASSES,
  outward,
  allowedHosts: ['github.com', '*.example.org'],
  inboxDir: '/inbox',
});
const call = (tool_name: string, tool_input: unknown, permission_mode = 'auto'): PreToolUsePayload => ({
  hook_event_name: 'PreToolUse',
  session_id: 's1',
  permission_mode,
  tool_name,
  tool_input,
});
const bash = (command: string, outward: Partial<Record<ActionClassId, OutwardMode>> = {}, mode = 'auto') => inspector.inspect(call('Bash', { command }, mode), gate(outward));

describe('inspector: git push in disguise', () => {
  const pushes = [
    'git push',
    'git  push   origin   main',
    'git -C . push',
    'git -c user.name=x push',
    'git --git-dir=.git push',
    'git --no-pager push',
    '/usr/bin/git push',
    '\\git push',
    'g""it push',
    "git 'pu'sh",
    'git "push"',
    'cd x && git push',
    'ls; git push',
    'true || git push',
    'echo hi | git push',
    '(git push)',
    '{ git push; }',
    'if true; then git push; fi',
    'for r in a b; do git push $r; done',
    'echo $(git push)',
    'echo `git push`',
    'echo "$(git push)"',
    'X=1 git push',
    'env A=1 B=2 git push',
    'env -u A git push',
    'command git push',
    'exec git push',
    'nohup git push',
    'timeout 5 git push',
    'time git push',
    'nice -n 5 git push',
    'sudo -u bob git push',
    'xargs -n1 git push',
    'sh -c "git push"',
    "bash -c 'cd x; git push'",
    "bash -lc 'git push'",
    "sh -c \"sh -c 'git push'\"",
    "find . -exec git push {} \;",
    'git push --force',
    'git push origin +main',
    'git push origin :old',
    'git push --delete origin old',
    'git $"push" origin main',
    'echo $(( $(git push origin main) + 1 ))',
    'echo ${x:-`git push`}',
    `echo "\${x:-'$(git push)'}"`,
    'time -p git push',
    'function f { git push origin main; }; f',
  ];
  it.each(pushes)('asks for %s', (command) => {
    expect(bash(command), command).toMatchObject({ decision: 'ask', classId: 'git.push' });
  });

  it('asks for a command it cannot resolve instead of letting it through', () => {
    const opaque = ["env -S 'git push origin main'", 'env -iS "git push"', 'git --config-env=alias.p=X p', 'git config alias.p push', 'git config --global alias.p "!git push"', 'GIT_CONFIG_KEY_0=alias.p git p', 'env GIT_CONFIG_KEY_0=alias.p git p', '$CMD push', 'git $SUB', 'git${IFS}push', 'git pu$X', '$(echo git) push', 'git {push,fetch}', '/usr/bin/gi? push', 'eval "git push"', "echo 'unterminated", 'bash', 'curl x | sh', 'source ./run.sh', "git -c alias.p=push p"];
    for (const command of opaque) expect(bash(command), command).toMatchObject({ decision: 'ask', classId: 'shell.opaque' });
  });

  it('does not ask for commands that only mention push', () => {
    for (const command of ['echo git push', 'git status', 'git commit -m "git push later"', 'git log --grep=push', 'git fetch origin', 'ls | grep push', 'git commit -m "$(cat <<\'EOF\'\ngit push\nEOF\n)"', 'source .venv/bin/activate']) {
      expect(bash(command), command).not.toMatchObject({ decision: 'ask' });
    }
  });

  it('keeps a force push on approve when the profile allows pushes, and lets a plain push through', () => {
    expect(bash('git push', { 'git.push': 'allow' }), 'plain push allowed').toMatchObject({ decision: 'none' });
    expect(bash('git push --force', { 'git.push': 'allow' }), 'force push hard floor').toMatchObject({ decision: 'ask', mode: 'approve' });
    expect(bash('git push -f origin x', { 'git.push': 'allow' }), 'short force flag').toMatchObject({ decision: 'ask' });
    expect(bash('git push --force', { 'git.push': 'deny' }), 'deny stays deny').toMatchObject({ decision: 'deny' });
  });

  it('names the remote and branch as the audience', () => {
    expect(bash('git push origin main'), 'audience').toMatchObject({ audience: 'origin main' });
  });
});

describe('inspector: GitHub, publishing and network commands', () => {
  const cases: [string, string][] = [
    ['gh pr comment 1 --body hi', 'github.comment'],
    ['gh issue comment 1 -b hi', 'github.comment'],
    ['gh pr review 1 --comment -b x', 'github.comment'],
    ['gh pr review 1 --approve', 'github.approve'],
    ['gh pr create --title x', 'github.create'],
    ['gh -R a/b issue create', 'github.create'],
    ['gh pr merge 1 --squash', 'github.approve'],
    ['gh release create v1', 'github.approve'],
    ['gh api -X POST repos/a/b/issues/1/comments -f body=x', 'github.comment'],
    ['gh api repos/a/b/issues/1/comments -f body=x', 'github.comment'],
    ['gh api -XDELETE repos/a/b/git/refs/heads/x', 'github.approve'],
    ['gh api --method=PUT repos/a/b/x', 'github.approve'],
    ['gh api graphql -f query="mutation { x }"', 'github.approve'],
    ['Q=x; gh api graphql -f query="$Q"', 'github.approve'],
    ['gh api repos/a/b/pulls -F title=x', 'github.approve'],
    ['npm publish', 'package.publish'],
    ['pnpm --filter x publish', 'package.publish'],
    ['cargo publish', 'package.publish'],
    ['docker push a/b', 'package.publish'],
    ['./gradlew publishToMavenLocal', 'package.publish'],
    ['ssh host ls', 'remote.shell'],
    ['scp a host:b', 'remote.shell'],
    ['rsync -av a host:b', 'remote.shell'],
    ['curl -X POST https://x.test -d a=1', 'http.write'],
    ['curl -XPUT https://x.test', 'http.write'],
    ['curl -sd a=1 https://x.test', 'http.write'],
    ['curl --data-binary @f https://x.test', 'http.write'],
    ['curl -F a=@f https://x.test', 'http.write'],
    ['curl --request=DELETE https://x.test', 'http.write'],
    ['wget --post-data=a=1 https://x.test', 'http.write'],
  ];
  it.each(cases)('classes %s as %s', (command, classId) => {
    expect(bash(command), command).toMatchObject({ decision: 'ask', classId });
  });

  it('records reads without asking', () => {
    for (const command of ['gh pr view 1', 'gh pr list', 'gh api repos/a/b', 'gh api -X GET repos/a/b -f per_page=1', 'gh api graphql -f query="query { x }"', 'git fetch', 'curl https://x.test', 'curl -X GET https://x.test', 'wget https://x.test']) {
      expect(bash(command), command).toMatchObject({ decision: 'none', classId: 'read' });
    }
  });

  it('takes the strictest class of a compound command', () => {
    expect(bash('gh pr view 1 && gh pr merge 1'), 'read then merge').toMatchObject({ decision: 'ask', classId: 'github.approve' });
    expect(bash('gh pr comment 1 -b x; git push'), 'comment then push').toMatchObject({ decision: 'ask', classId: 'git.push' });
  });
});

describe('inspector: tools other than Bash', () => {
  it('asks for a Bash input with a per-command host list and for WebFetch to hosts off the allowlist', () => {
    expect(inspector.inspect(call('Bash', { command: 'curl https://x.test', allowed_domains: ['x.test'] }), gate()), 'allowed_domains').toMatchObject({ classId: 'shell.opaque' });
    expect(inspector.inspect(call('WebFetch', { url: 'https://github.com/a' }), gate()), 'allowed host').toMatchObject({ decision: 'none' });
    expect(inspector.inspect(call('WebFetch', { url: 'https://docs.example.org/a' }), gate()), 'wildcard host').toMatchObject({ decision: 'none' });
    expect(inspector.inspect(call('WebFetch', { url: 'https://evil.test/a' }), gate()), 'other host').toMatchObject({ decision: 'ask', classId: 'web.fetch', audience: 'evil.test' });
    expect(inspector.inspect(call('WebFetch', { url: 'https://github.com.evil.test/' }), gate()), 'look-alike host').toMatchObject({ decision: 'ask' });
  });

  it('classes connector writes on any claude_ai server and names the issue or channel', () => {
    expect(inspector.inspect(call('mcp__claude_ai_Atlassian_Rovo__addCommentToJiraIssue', { issueIdOrKey: 'ABC-1' }), gate()), 'renamed Atlassian server').toMatchObject({ classId: 'jira.comment', audience: 'ABC-1' });
    expect(inspector.inspect(call('mcp__claude_ai_Slack__slack_send_message', { channel_id: 'C1' }), gate()), 'Slack').toMatchObject({ classId: 'slack.send', audience: 'C1' });
    expect(inspector.inspect(call('mcp__claude_ai_Notion__notion-delete-pages', {}), gate()), 'Notion delete').toMatchObject({ classId: 'notion.delete', mode: 'approve' });
    expect(inspector.inspect(call('mcp__claude_ai_Claude_Docs__create', {}), gate()), 'Docs create').toMatchObject({ classId: 'claude.write' });
    expect(inspector.inspect(call('mcp__claude_ai_Notion__create', {}), gate()), 'generic name on another server').toMatchObject({ classId: 'connector.unknown' });
    expect(inspector.inspect(call('mcp__claude_ai_Slack__slack_read_thread', {}), gate()), 'Slack read').toMatchObject({ decision: 'none' });
    expect(inspector.inspect(call('mcp__claude_ai_Slack__slack_add_reaction', {}), gate()), 'notify class').toMatchObject({ decision: 'none', classId: 'slack.react' });
  });

  it('asks for outward built-in tools and leaves ordinary tools alone', () => {
    expect(inspector.inspect(call('RemoteTrigger', {}), gate()), 'remote trigger').toMatchObject({ classId: 'builtin.outward' });
    expect(inspector.inspect(call('Write', { file_path: '/x' }), gate()), 'Write').toEqual({ decision: 'none' });
  });

  it('turns an ask into a deny under bypass mode and keeps reads open', () => {
    expect(bash('git push', {}, 'bypassPermissions'), 'push under bypass').toMatchObject({ decision: 'deny', classId: 'git.push' });
    expect(bash('gh pr view 1', {}, 'bypassPermissions'), 'read under bypass').toMatchObject({ decision: 'none' });
  });

  it('turns a class set to deny into a deny with a reason naming the class', () => {
    const decision = inspector.inspect(call('mcp__claude_ai_Slack__slack_send_message', {}), gate({ 'slack.send': 'deny' }));
    expect(decision, 'deny').toMatchObject({ decision: 'deny', classId: 'slack.send' });
    expect(decision.decision === 'deny' && decision.reason, 'reason names the class').toContain('slack.send');
  });
});

describe('hook output', () => {
  const payloadText = (command: string) => JSON.stringify(call('Bash', { command }));
  it('prints a PreToolUse decision for an ask and nothing for a call the mode decides', () => {
    const asked = runGate(payloadText('git push'), gate());
    expect(JSON.parse(asked?.stdout ?? '{}'), 'ask output').toMatchObject({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' } });
    expect(asked?.record, 'record carries the decision').toMatchObject({ tool_name: 'Bash', agide_gate: { decision: 'ask', classId: 'git.push', mode: 'approve' } });
    const quiet = runGate(payloadText('ls'), gate());
    expect(quiet?.stdout, 'no output').toBe('');
    expect(quiet?.record, 'record without class').toMatchObject({ agide_gate: { decision: 'none' } });
  });

  it('records the notify mode and ignores other hook events', () => {
    const run = runGate(JSON.stringify(call('mcp__claude_ai_Slack__slack_add_reaction', {})), gate());
    expect(run?.record, 'notify mode').toMatchObject({ agide_gate: { decision: 'none', classId: 'slack.react', mode: 'notify' } });
    expect(runGate(JSON.stringify({ hook_event_name: 'Stop' }), gate()), 'other event').toBeUndefined();
  });
});

describe('inspector: calls the table cannot place', () => {
  it('asks for a class the profile table does not list, so a missing row never allows', () => {
    const noRows: GateFile = { ...gate(), table: [] };
    expect(inspector.inspect(call('WebFetch', { url: 'https://evil.test/a' }), noRows), 'class without a row').toMatchObject({ decision: 'ask', classId: 'web.fetch' });
  });

  it('asks for a Bash call without a readable command', () => {
    expect(inspector.inspect(call('Bash', {}), gate()), 'no command field').toMatchObject({ decision: 'ask', classId: 'shell.opaque' });
    expect(inspector.inspect(call('Bash', { command: 42 }), gate()), 'command that is not text').toMatchObject({ decision: 'ask', classId: 'shell.opaque' });
    expect(inspector.inspect(call('Bash', 'git push'), gate()), 'input that is not an object').toMatchObject({ decision: 'ask', classId: 'shell.opaque' });
  });
});
