import { InMemoryHookEndpoint, type HookEndpoint } from '../../core/hooks/index';
import type { AppMcpServer } from '../../core/mcp/index';
import type { ProfileService } from '../../core/profile/index';
import type { ModuleContext, ModuleHandle } from '../context';

/** The endpoint behind a factory: w-hooks replaces the in-memory endpoint with the HTTP one on the app's MCP listener. */
export function createHookEndpoint(): HookEndpoint {
  return new InMemoryHookEndpoint();
}

/**
 * Hooks module (0043 section 5). Owner: w-hooks for the endpoint, its route and the `GateRecorder`; w-approvals adds
 * the approval broker here after w-hooks. It comes after `mcp`, whose listener carries the hook route, and before
 * `session`, which receives the endpoint. Until w-hooks lands no session posts to the endpoint. The commands
 * `hook_approval_answer` and `session_set_mode` register in the session module, which has the sessions their handlers need.
 */
export function init(_ctx: ModuleContext, _deps: { mcp: AppMcpServer; profile: ProfileService }): ModuleHandle<HookEndpoint> {
  return { service: createHookEndpoint() };
}
