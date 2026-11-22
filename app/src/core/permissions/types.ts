import type { NetworkPolicy, ProviderCapabilities } from '../isolation/types';
import type { LaunchContributor } from '../session/launchContributions';
import type { PermissionMode, SessionId } from '../session/types';

/**
 * Permission model (0025, design 0028 Part 1). The mode is chosen per profile and per session; outward actions
 * are classed and enforced by ask and deny rules in `--settings`, a deciding `PreToolUse` inspector and the
 * network policy.
 */

/** Modes a profile can make its default. Bypass is never a default; `dontAsk` is not offered. */
export type DefaultPermissionMode = 'auto' | 'default' | 'acceptEdits' | 'plan';

/** How an outward action class is handled (0010 section 6). */
export type OutwardMode = 'allow' | 'notify' | 'draft' | 'approve' | 'deny';

/** Class ids of 0028 section 2. `mcp.other.read` records reads on other MCP servers. */
export const ACTION_CLASS_IDS = [
  'read',
  'jira.comment',
  'jira.edit',
  'jira.create',
  'confluence.write',
  'atlassian.write',
  'slack.send',
  'slack.canvas',
  'slack.react',
  'notion.write',
  'notion.delete',
  'claude.write',
  'connector.unknown',
  'github.comment',
  'github.create',
  'github.approve',
  'git.push',
  'package.publish',
  'remote.shell',
  'http.write',
  'web.fetch',
  'shell.opaque',
  'app.agent_start',
  'app.merge',
  'builtin.outward',
  'mcp.other',
  'mcp.other.read',
  'deploy',
] as const;

export type ActionClassId = (typeof ACTION_CLASS_IDS)[number];

/** What limits a class besides the rules and the inspector. */
export type NetworkCoverage = 'bash-allowlist' | 'not-applicable' | 'not-covered';

/** One row of the class table. */
export interface ActionClass {
  readonly id: ActionClassId;
  readonly title: string;
  readonly defaultMode: OutwardMode;
  /** Static `permissions.ask` patterns written for `draft` and `approve` (P21: they hold when the hook fails). */
  readonly askRules: readonly string[];
  /** A force push or a branch deletion stays `approve` whatever the profile says (0010 section 2). */
  readonly hardFloor?: OutwardMode;
  readonly network: NetworkCoverage;
}

export type ActionClassTable = readonly ActionClass[];

/** `ProfileSettings.permissions` (0028 section 1). A profile without it reads as `DEFAULT_PERMISSION_SETTINGS`. */
export interface PermissionSettings {
  /** Mode of new sessions. */
  readonly defaultMode: DefaultPermissionMode;
  /** Outward-action modes per class id; a missing class uses the table default. */
  readonly outward?: Readonly<Partial<Record<ActionClassId, OutwardMode>>>;
  /** The local provider's network policy through Claude Code's Bash sandbox (0028 section 5). */
  readonly network: {
    readonly bashSandbox: boolean;
    readonly allow: readonly string[];
    readonly deny: readonly string[];
  };
  /** Answer Claude's folder-trust question for folders the app creates (0028 section 11). */
  readonly trustAppCreatedFolders: boolean;
}

/** What the session asks for when it starts. */
export interface ModeRequest {
  /** From the new-session or new-task dialog, `session_create` or `task_start`; absent uses the profile default. */
  readonly requested?: PermissionMode;
  readonly confirmBypassPermissions?: boolean;
  /** The provider the session launches through. */
  readonly capabilities: ProviderCapabilities;
  /** The calling session's mode when an agent starts the session; the result cannot be looser (0028 section 13). */
  readonly callerMode?: PermissionMode;
  /** False when the `PreToolUse` inspector cannot run in this launch; bypass is then refused. Absent counts as available. */
  readonly inspectorAvailable?: boolean;
}

export type PermissionErrorCode = 'bypass_refused' | 'confirmation_needed' | 'looser_than_caller';

export class PermissionError extends Error {
  constructor(
    readonly code: PermissionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PermissionError';
  }
}

/** Inputs of the launch policy of one session. */
export interface PolicyInput {
  readonly sessionId: SessionId;
  readonly permissionMode: PermissionMode;
  readonly settings: PermissionSettings;
  readonly table: ActionClassTable;
  readonly capabilities: ProviderCapabilities;
  /** The task's own branch, for the inspector's audience and the later own-branch rule. */
  readonly ownBranch?: string;
}

/** Inputs the inspector reads from the session's `gate.json` (0600). Hooks run outside the sandbox (sandboxing docs). */
export interface GateFile {
  readonly schema: 1;
  readonly sessionId: SessionId;
  readonly table: ActionClassTable;
  readonly outward: Readonly<Partial<Record<ActionClassId, OutwardMode>>>;
  readonly allowedHosts: readonly string[];
  readonly ownBranch?: string;
  /** Where the inspector writes the payload with its decision, as the plain hook command does. */
  readonly inboxDir: string;
}

/** What the launch carries for permissions. */
export interface LaunchPolicy {
  readonly ask: readonly string[];
  readonly deny: readonly string[];
  /** `sandbox` settings for `--settings`, present when the Bash sandbox is on (`strictAllowlist` required, P23). */
  readonly sandbox?: Readonly<Record<string, unknown>>;
  /** `GIT_CONFIG_COUNT` entries for HTTPS GitHub remotes in sandboxed sessions. */
  readonly env: Readonly<Record<string, string>>;
  readonly gate: Omit<GateFile, 'inboxDir'>;
  /** What the provider enforces for the whole process (`EnvironmentSpec.network`). */
  readonly network: NetworkPolicy;
}

/** Turns the class table and the profile's settings into the rules of one launch. Pure. */
export interface PolicyBuilder {
  build(input: PolicyInput): LaunchPolicy;
}

/** The fields of a `PreToolUse` payload the inspector reads (P21). The rest of the payload is kept as it is. */
export interface PreToolUsePayload {
  readonly hook_event_name: 'PreToolUse';
  readonly session_id: string;
  readonly permission_mode: string;
  readonly tool_name: string;
  readonly tool_input: unknown;
  readonly tool_use_id?: string;
}

/**
 * The inspector's answer. There is no `allow`: in auto mode a hook allow runs the call without a prompt and
 * cannot lift an ask rule anyway (P21). `none` hands the call to the mode and the rules.
 */
export type InspectorDecision =
  | { readonly decision: 'deny'; readonly classId: ActionClassId; readonly reason: string; readonly audience?: string }
  | { readonly decision: 'ask'; readonly classId: ActionClassId; readonly mode: OutwardMode; readonly reason: string; readonly audience?: string }
  | { readonly decision: 'none'; readonly classId?: ActionClassId; readonly audience?: string };

/** Classifies one tool call. Pure; the entry script reads stdin and the gate file and prints the hook output. */
export interface HookInspector {
  inspect(payload: PreToolUsePayload, gate: GateFile): InspectorDecision;
}

/** What the permissions module gives the other modules. */
export interface PermissionService {
  /** The profile's permission settings with defaults applied. */
  settings(): PermissionSettings;
  /** The mode a new or resumed session launches with. Throws `PermissionError`. */
  resolveMode(request: ModeRequest): PermissionMode;
  /** The network policy the provider enforces for a session. */
  networkPolicy(sessionId: SessionId): NetworkPolicy;
  readonly table: ActionClassTable;
  /** Adds the rules, the inspector hook, the sandbox settings and the gate file to every launch. */
  readonly contributor: LaunchContributor;
}

export type PermissionsEvent = {
  /** The inspector decided on a call (read from the payload record it writes). */
  readonly type: 'permissions.gate_decision';
  readonly sessionId: SessionId;
  readonly toolName: string;
  readonly decision: InspectorDecision;
};
