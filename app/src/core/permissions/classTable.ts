import type { ActionClass, ActionClassId, ActionClassTable } from './types';

/**
 * Connector tools per class, as the connectors of this login expose them (0028 section 2). The inspector matches the
 * tool part on any server whose name starts with `claude_ai_`; the ask rules name the server the tool belongs to.
 */
interface ConnectorTools {
  readonly server: string;
  readonly tools: readonly string[];
}

export const CONNECTOR_TOOLS: Readonly<Partial<Record<ActionClassId, readonly ConnectorTools[]>>> = {
  'jira.comment': [{ server: 'claude_ai_Atlassian', tools: ['addCommentToJiraIssue'] }],
  'jira.edit': [{ server: 'claude_ai_Atlassian', tools: ['editJiraIssue', 'transitionJiraIssue', 'createIssueLink', 'addWorklogToJiraIssue'] }],
  'jira.create': [{ server: 'claude_ai_Atlassian', tools: ['createJiraIssue'] }],
  'confluence.write': [
    { server: 'claude_ai_Atlassian', tools: ['createConfluencePage', 'updateConfluencePage', 'createConfluenceFooterComment', 'createConfluenceInlineComment'] },
  ],
  'atlassian.write': [
    {
      server: 'claude_ai_Atlassian',
      tools: ['createCompassComponent', 'createCompassComponentRelationship', 'createCompassCustomFieldDefinition', 'addTeamworkGraphContext'],
    },
  ],
  'slack.send': [{ server: 'claude_ai_Slack', tools: ['slack_send_message', 'slack_schedule_message', 'slack_send_message_draft'] }],
  'slack.canvas': [{ server: 'claude_ai_Slack', tools: ['slack_create_canvas', 'slack_update_canvas'] }],
  'slack.react': [{ server: 'claude_ai_Slack', tools: ['slack_add_reaction'] }],
  'notion.write': [
    {
      server: 'claude_ai_Notion',
      tools: [
        'notion-create-pages',
        'notion-update-page',
        'notion-move-pages',
        'notion-duplicate-page',
        'notion-create-comment',
        'notion-update-comment',
        'notion-create-database',
        'notion-update-data-source',
        'notion-update-view',
        'notion-calendar-create-events',
        'notion-calendar-update-events',
        'notion-calendar-cancel-events',
        'notion-send-message-to-session',
        'notion-spawn-session',
        'notion-stop-session',
        'notion-create-folder',
        'notion-update-folder',
        'notion-create-view',
        'notion-create-attachment',
        'notion-create-file-upload',
        'notion-create-meeting-note',
        'notion-link-meeting-note-to-calendar-event',
        'notion-create-suggested-edit',
        'notion-resolve-suggested-edit',
        'notion-set-comment-reaction',
        'notion-set-discussion-resolved',
        'notion-restore-pages',
        'notion-restore-version',
        'notion-convert-page-to-skill',
        'notion-convert-to-meetings-database',
        'notion-upload-skill',
        'notion-update-skill-settings',
        'notion-update-page-favorites',
        'notion-update-sidebar-tabs',
        'notion-complete-mcp-setup',
      ],
    },
  ],
  'notion.delete': [{ server: 'claude_ai_Notion', tools: ['notion-delete-pages', 'notion-delete-databases', 'notion-delete-comment'] }],
  'claude.write': [
    { server: 'claude_ai_Claude_Docs', tools: ['create', 'batch', 'update', 'delete'] },
    {
      server: 'claude_ai_Claude_Data',
      tools: [
        'certify_query',
        'uncertify_query',
        'set_certified_query_source',
        'share_connector',
        'unshare_connector',
        'share_live_queries',
        'unshare_live_queries',
      ],
    },
  ],
};

/** Built-in tools of the CLI that publish or start work outside the machine. */
export const OUTWARD_BUILTIN_TOOLS: readonly string[] = ['RemoteTrigger', 'PublishPlugin', 'ShareOnboardingGuide', 'Artifact'];

/** The app's own MCP servers; their tools follow the mode, except the ones that start agents. */
export const OWN_MCP_SERVERS: readonly string[] = ['app', 'agide-browser'];

const AGENT_START_TOOLS: readonly string[] = ['mcp__app__task_start'];

/** Names that start a read-only tool of a connector or another MCP server, after the connector's own prefix. */
export const READ_PREFIXES: readonly string[] = ['get', 'search', 'list', 'read', 'fetch', 'query', 'lookup', 'view'];

const PUBLISHERS: readonly string[] = [
  'npm publish',
  'pnpm publish',
  'yarn npm publish',
  'cargo publish',
  'twine upload',
  'uv publish',
  'poetry publish',
  'gem push',
  'docker push',
  'mvn deploy',
  'gradle publish',
];

const REMOTE_SHELL_PROGRAMS: readonly string[] = ['ssh', 'scp', 'sftp', 'rsync', 'git send-email'];

const GH_COMMENT_RULES = ['gh pr comment', 'gh issue comment', 'gh pr review'];
const GH_CREATE_RULES = ['gh pr create', 'gh issue create', 'gh pr edit', 'gh issue edit', 'gh gist', 'gh label'];
const GH_APPROVE_RULES = [
  'gh pr merge',
  'gh pr ready',
  'gh pr reopen',
  'gh issue close',
  'gh issue reopen',
  'gh issue delete',
  'gh issue transfer',
  'gh issue lock',
  'gh release',
  'gh workflow run',
  'gh run rerun',
  'gh run cancel',
  'gh secret',
  'gh variable',
  'gh repo',
  'gh pr close',
];

const bashRules = (commands: readonly string[]): string[] => commands.flatMap((command) => [`Bash(${command})`, `Bash(${command} *)`]);
const argumentRules = (commands: readonly string[]): string[] => commands.map((command) => `Bash(${command} *)`);

function connectorRules(id: ActionClassId): string[] {
  return (CONNECTOR_TOOLS[id] ?? []).flatMap(({ server, tools }) => tools.map((tool) => `mcp__${server}__${tool}`));
}

const row = (
  id: ActionClassId,
  title: string,
  defaultMode: ActionClass['defaultMode'],
  askRules: readonly string[],
  network: ActionClass['network'],
  hardFloor?: ActionClass['hardFloor'],
): ActionClass => ({ id, title, defaultMode, askRules, network, ...(hardFloor === undefined ? {} : { hardFloor }) });

/** The table of 0028 section 2. Row order is the order the settings panel lists the classes. */
export const ACTION_CLASSES: ActionClassTable = [
  row('read', 'Reads', 'allow', [], 'bash-allowlist'),
  row('jira.comment', 'Jira comments', 'draft', connectorRules('jira.comment'), 'not-applicable'),
  row('jira.edit', 'Jira edits and transitions', 'draft', connectorRules('jira.edit'), 'not-applicable'),
  row('jira.create', 'Jira issue creation', 'draft', connectorRules('jira.create'), 'not-applicable'),
  row('confluence.write', 'Confluence pages and comments', 'draft', connectorRules('confluence.write'), 'not-applicable'),
  row('atlassian.write', 'Other Atlassian writes', 'draft', connectorRules('atlassian.write'), 'not-applicable'),
  row('slack.send', 'Slack messages', 'draft', connectorRules('slack.send'), 'not-applicable'),
  row('slack.canvas', 'Slack canvases', 'draft', connectorRules('slack.canvas'), 'not-applicable'),
  row('slack.react', 'Slack reactions', 'notify', [], 'not-applicable'),
  row('notion.write', 'Notion writes', 'draft', connectorRules('notion.write'), 'not-applicable'),
  row('notion.delete', 'Notion deletions', 'approve', connectorRules('notion.delete'), 'not-applicable'),
  row('claude.write', 'Claude Docs and Data writes', 'draft', connectorRules('claude.write'), 'not-applicable'),
  row('connector.unknown', 'Unknown connector tools', 'draft', [], 'not-applicable'),
  row('github.comment', 'GitHub comments', 'draft', argumentRules(GH_COMMENT_RULES), 'bash-allowlist'),
  row('github.create', 'GitHub pull requests, issues and gists', 'draft', argumentRules(GH_CREATE_RULES), 'bash-allowlist'),
  row('github.approve', 'GitHub merges, approvals and settings', 'approve', argumentRules(GH_APPROVE_RULES), 'bash-allowlist'),
  row('git.push', 'git push', 'approve', ['Bash(git push)', 'Bash(git push *)'], 'bash-allowlist', 'approve'),
  row('package.publish', 'Package and image publishing', 'approve', bashRules(PUBLISHERS), 'bash-allowlist'),
  row('remote.shell', 'ssh, scp, sftp and rsync', 'approve', bashRules(REMOTE_SHELL_PROGRAMS), 'bash-allowlist'),
  row('http.write', 'HTTP writes from the shell', 'approve', [], 'bash-allowlist'),
  row('web.fetch', 'Web fetch', 'approve', [], 'not-covered'),
  row('shell.opaque', 'Commands the gate cannot read', 'approve', [], 'bash-allowlist'),
  row('app.agent_start', 'Starting agents', 'approve', [...AGENT_START_TOOLS], 'not-applicable'),
  row('builtin.outward', 'Publishing and remote-trigger tools', 'approve', [...OUTWARD_BUILTIN_TOOLS], 'not-covered'),
  row('mcp.other', 'Other MCP tools', 'draft', [], 'not-covered'),
  row('mcp.other.read', 'Other MCP reads', 'allow', [], 'not-covered'),
  row('deploy', 'Deployments named by the project policy', 'deny', [], 'not-applicable'),
];

const GENERIC_TOOL_NAMES = new Set(['create', 'batch', 'update', 'delete']);

/**
 * The class of a connector tool, or undefined when the table does not list it. A renamed or second connector is
 * still found by the tool name; the short generic names of Claude Docs match only on their own server.
 */
export function connectorClassOf(server: string, tool: string): ActionClassId | undefined {
  const entries = Object.entries(CONNECTOR_TOOLS) as [ActionClassId, readonly ConnectorTools[]][];
  for (const [id, groups] of entries) {
    if (groups.some((group) => group.server === server && group.tools.includes(tool))) return id;
  }
  if (GENERIC_TOOL_NAMES.has(tool)) return undefined;
  for (const [id, groups] of entries) {
    if (groups.some((group) => group.tools.includes(tool))) return id;
  }
  return undefined;
}

export const AGENT_START_TOOL_NAMES: readonly string[] = AGENT_START_TOOLS;
