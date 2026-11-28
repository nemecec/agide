import { z } from 'zod';

/** Profile settings of access requests (0043 section 4.10). Every key is optional; absent keys read as the defaults. */
export const accessSettingsSchema = z
  .object({
    /** How long a tool call waits for the user's decision before it returns a request id. */
    waitSeconds: z.number().int().min(0).max(600).optional(),
    /** How long a request stays open. */
    requestHours: z.number().int().min(1).max(168).optional(),
  })
  .strict();

export type AccessSettingsInput = z.infer<typeof accessSettingsSchema>;

export interface AccessSettings {
  readonly waitSeconds: number;
  readonly requestHours: number;
}

export const DEFAULT_ACCESS_SETTINGS: AccessSettings = { waitSeconds: 115, requestHours: 24 };

export function resolveAccessSettings(input: AccessSettingsInput | undefined): AccessSettings {
  return {
    waitSeconds: input?.waitSeconds ?? DEFAULT_ACCESS_SETTINGS.waitSeconds,
    requestHours: input?.requestHours ?? DEFAULT_ACCESS_SETTINGS.requestHours,
  };
}
