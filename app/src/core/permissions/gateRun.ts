import { effectiveMode, ToolCallInspector } from './inspector';
import type { GateFile, InspectorDecision, OutwardMode, PreToolUsePayload } from './types';

/** What the inspector adds to the payload record it writes for the app (`agide_gate`). */
export interface GateRecord {
  readonly decision: InspectorDecision['decision'];
  readonly classId?: string;
  readonly mode?: OutwardMode;
  readonly reason?: string;
  readonly audience?: string;
}

export interface GateRun {
  /** The hook's stdout: empty when the mode and the rules decide. */
  readonly stdout: string;
  /** The payload with the decision added, for the inbox directory. */
  readonly record: Record<string, unknown>;
}

const inspector = new ToolCallInspector();

/** Runs the inspector over one hook payload. Pure; the entry script does the reading and writing. */
export function runGate(payloadText: string, gate: GateFile): GateRun | undefined {
  const raw: unknown = JSON.parse(payloadText);
  if (typeof raw !== 'object' || raw === null || (raw as { hook_event_name?: unknown }).hook_event_name !== 'PreToolUse') return undefined;
  const payload = raw as PreToolUsePayload & Record<string, unknown>;
  const decision = inspector.inspect(payload, gate);
  const mode = decision.decision === 'ask' ? decision.mode : decision.classId === undefined ? undefined : effectiveMode({ classId: decision.classId }, gate);
  const record: GateRecord = {
    decision: decision.decision,
    ...(decision.decision === 'none' ? {} : { reason: decision.reason }),
    ...(decision.classId === undefined ? {} : { classId: decision.classId }),
    ...(mode === undefined ? {} : { mode }),
    ...(decision.audience === undefined ? {} : { audience: decision.audience }),
  };
  const stdout =
    decision.decision === 'none'
      ? ''
      : JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision.decision, permissionDecisionReason: decision.reason } });
  return { stdout, record: { ...payload, agide_gate: record } };
}
