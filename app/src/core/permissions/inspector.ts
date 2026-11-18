import { hostAllowed } from './hosts';
import { classifyBash, type ClassHit } from './shell/classify';
import { connectorClassOf, OUTWARD_BUILTIN_TOOLS, OWN_MCP_SERVERS, READ_PREFIXES, AGENT_START_TOOL_NAMES } from './classTable';
import type { ActionClassId, GateFile, HookInspector, InspectorDecision, OutwardMode, PreToolUsePayload } from './types';

const RANK: Readonly<Record<OutwardMode, number>> = { allow: 0, notify: 1, draft: 2, approve: 3, deny: 4 };
const CONNECTOR_PREFIX = 'claude_ai_';
const CONNECTOR_PREFIXES_TO_STRIP = ['notion-calendar-', 'notion-', 'slack_'];

interface Classified extends ClassHit {
  /** The mode the class has before the profile's override, when the class itself depends on the call. */
  readonly defaultOverride?: OutwardMode;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

function startsWithReadPrefix(name: string): boolean {
  return READ_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** Splits `mcp__<server>__<tool>`. The server name never holds a double underscore. */
function mcpParts(toolName: string): { server: string; tool: string } | undefined {
  if (!toolName.startsWith('mcp__')) return undefined;
  const rest = toolName.slice('mcp__'.length);
  const at = rest.indexOf('__');
  return at < 0 ? undefined : { server: rest.slice(0, at), tool: rest.slice(at + 2) };
}

function audienceOf(classId: ActionClassId, input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  if (classId.startsWith('jira.')) return text(input['issueIdOrKey']) ?? text(input['issueKey']);
  if (classId.startsWith('slack.')) return text(input['channel_id']) ?? text(input['channel']);
  return undefined;
}

function classifyMcp(server: string, tool: string, input: unknown): Classified[] {
  if (AGENT_START_TOOL_NAMES.includes(`mcp__${server}__${tool}`)) return [{ classId: 'app.agent_start' }];
  if (OWN_MCP_SERVERS.includes(server)) return [];
  if (server.startsWith(CONNECTOR_PREFIX)) {
    const known = connectorClassOf(server, tool);
    if (known !== undefined) {
      const audience = audienceOf(known, input);
      return [{ classId: known, ...(audience === undefined ? {} : { audience }) }];
    }
    const stripped = CONNECTOR_PREFIXES_TO_STRIP.reduce((name, prefix) => (name.startsWith(prefix) ? name.slice(prefix.length) : name), tool);
    return startsWithReadPrefix(stripped) || startsWithReadPrefix(tool) || tool === 'search' || tool === 'fetch'
      ? [{ classId: 'read' }]
      : [{ classId: 'connector.unknown', reason: 'unknown connector tool' }];
  }
  return startsWithReadPrefix(tool) ? [{ classId: 'mcp.other.read' }] : [{ classId: 'mcp.other', reason: 'unknown MCP tool' }];
}

function classifyCall(payload: PreToolUsePayload, gate: GateFile): Classified[] {
  const input = payload.tool_input;
  const tool = payload.tool_name;
  if (tool === 'Bash') {
    const command = isRecord(input) ? text(input['command']) : undefined;
    if (isRecord(input) && input['allowed_domains'] !== undefined) return [{ classId: 'shell.opaque', reason: 'a per-command host list' }];
    return command === undefined ? [{ classId: 'shell.opaque', reason: 'command the gate cannot read' }] : classifyBash(command);
  }
  if (tool === 'WebFetch') {
    const url = isRecord(input) ? text(input['url']) : undefined;
    let host: string | undefined;
    try {
      host = url === undefined ? undefined : new URL(url).hostname;
    } catch {
      host = undefined;
    }
    const allowed = host !== undefined && hostAllowed(host, gate.allowedHosts);
    return [{ classId: 'web.fetch', ...(host === undefined ? {} : { audience: host }), ...(allowed ? { defaultOverride: 'allow' as const } : {}) }];
  }
  if (OUTWARD_BUILTIN_TOOLS.includes(tool)) return [{ classId: 'builtin.outward' }];
  const parts = mcpParts(tool);
  return parts === undefined ? [] : classifyMcp(parts.server, parts.tool, input);
}

/** The mode the profile gives a class, with the hard floor applied to a forced action. */
export function effectiveMode(hit: ClassHit & { readonly defaultOverride?: OutwardMode }, gate: GateFile): OutwardMode {
  const row = gate.table.find((candidate) => candidate.id === hit.classId);
  const base = gate.outward[hit.classId] ?? hit.defaultOverride ?? row?.defaultMode ?? 'approve';
  if (hit.hard === true && row?.hardFloor !== undefined && RANK[base] < RANK[row.hardFloor]) return row.hardFloor;
  return base;
}

function titleOf(classId: ActionClassId, gate: GateFile): string {
  return gate.table.find((row) => row.id === classId)?.title ?? classId;
}

/** Table-driven inspector (0028 section 3). It never answers allow; the mode and the rules decide what it leaves open. */
export class ToolCallInspector implements HookInspector {
  inspect(payload: PreToolUsePayload, gate: GateFile): InspectorDecision {
    const hits = classifyCall(payload, gate);
    if (hits.length === 0) return { decision: 'none' };
    let strictest = hits[0]!;
    let strictestMode = effectiveMode(strictest, gate);
    for (const hit of hits.slice(1)) {
      const mode = effectiveMode(hit, gate);
      if (RANK[mode] > RANK[strictestMode]) {
        strictest = hit;
        strictestMode = mode;
      }
    }
    const { classId } = strictest;
    const audience = strictest.audience === undefined ? {} : { audience: strictest.audience };
    const title = titleOf(classId, gate);
    if (strictestMode === 'deny') {
      return { decision: 'deny', classId, reason: `The profile's policy blocks ${title} (${classId}). Ask the user to change the permission settings of the profile if this action is needed.`, ...audience };
    }
    if (strictestMode === 'draft' || strictestMode === 'approve') {
      const detail = strictest.reason === undefined ? `${title} (${classId}, ${strictestMode})` : `${strictest.reason} (${classId}, ${strictestMode})`;
      if (payload.permission_mode === 'bypassPermissions') {
        return { decision: 'deny', classId, reason: `${detail} is not allowed under bypass mode; the action needs a person to approve it.`, ...audience };
      }
      return { decision: 'ask', classId, mode: strictestMode, reason: `Needs approval: ${detail}`, ...audience };
    }
    const noted = hits.find((hit) => effectiveMode(hit, gate) === 'notify') ?? strictest;
    return { decision: 'none', classId: noted.classId, ...(noted.audience === undefined ? {} : { audience: noted.audience }) };
  }
}
