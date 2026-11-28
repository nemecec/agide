import { z } from 'zod';

/** Profile settings of the hook transport (0043 section 4.1). Every key is optional; absent keys read as the defaults. */
export const hookSettingsSchema = z
  .object({
    transport: z.enum(['http', 'inbox-dir']).optional(),
    /** How long a held `PermissionRequest` waits for the card before the decision goes back to the terminal. */
    approvalWaitMinutes: z.number().int().min(1).max(240).optional(),
    /** Let hooks reach the app on 127.0.0.1 while the CLI's Bash sandbox is on. */
    bashSandboxLoopback: z.boolean().optional(),
  })
  .strict();

export type HookSettingsInput = z.infer<typeof hookSettingsSchema>;

export interface HookSettings {
  readonly transport: 'http' | 'inbox-dir';
  readonly approvalWaitMinutes: number;
  readonly bashSandboxLoopback: boolean;
}

export const DEFAULT_HOOK_SETTINGS: HookSettings = { transport: 'http', approvalWaitMinutes: 15, bashSandboxLoopback: true };

export function resolveHookSettings(input: HookSettingsInput | undefined): HookSettings {
  return {
    transport: input?.transport ?? DEFAULT_HOOK_SETTINGS.transport,
    approvalWaitMinutes: input?.approvalWaitMinutes ?? DEFAULT_HOOK_SETTINGS.approvalWaitMinutes,
    bashSandboxLoopback: input?.bashSandboxLoopback ?? DEFAULT_HOOK_SETTINGS.bashSandboxLoopback,
  };
}

/** The hook entry timeout of a held `PermissionRequest`: the wait plus 60 seconds, in seconds (0043 section 4.1). */
export function approvalEntryTimeoutSeconds(settings: Pick<HookSettings, 'approvalWaitMinutes'>): number {
  return settings.approvalWaitMinutes * 60 + 60;
}
