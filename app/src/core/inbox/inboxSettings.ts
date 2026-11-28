import { z } from 'zod';

/** Profile settings of the inbox (0043 section 4.6). Every key is optional; absent keys read as the defaults. */
export const inboxSettingsSchema = z
  .object({
    /** Done items older than this many days are removed; open items and asks of open items stay. */
    retentionDays: z.number().int().min(1).max(3650).optional(),
  })
  .strict();

export type InboxSettingsInput = z.infer<typeof inboxSettingsSchema>;

export interface InboxSettings {
  readonly retentionDays: number;
}

export const DEFAULT_INBOX_SETTINGS: InboxSettings = { retentionDays: 90 };

export function resolveInboxSettings(input: InboxSettingsInput | undefined): InboxSettings {
  return { retentionDays: input?.retentionDays ?? DEFAULT_INBOX_SETTINGS.retentionDays };
}
