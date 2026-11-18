import { z } from 'zod';
import { ACTION_CLASS_IDS } from './types';

const host = z.string().trim().min(1).max(253).regex(/^(\*\.)?[A-Za-z0-9.-]+$/);
const outwardMode = z.enum(['allow', 'notify', 'draft', 'approve', 'deny']);

/** `ProfileSettings.permissions`; parsed values are cast to `PermissionSettings` like the other profile settings. */
export const permissionSettingsSchema = z
  .object({
    defaultMode: z.enum(['auto', 'default', 'acceptEdits', 'plan']),
    outward: z.partialRecord(z.enum(ACTION_CLASS_IDS), outwardMode).optional(),
    network: z
      .object({ bashSandbox: z.boolean(), allow: z.array(host).max(200), deny: z.array(host).max(200) })
      .strict(),
    trustAppCreatedFolders: z.boolean(),
  })
  .strict();
