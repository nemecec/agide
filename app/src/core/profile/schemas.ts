import { z } from 'zod';
import { agentSettingsSchema } from '../agents/settings';
import { permissionSettingsSchema } from '../permissions/schemas';
import { reviewSettingsSchema } from '../review/settings';
import { swarmSettingsSchema } from '../swarm/settings';
import type { ProfileSettings } from './types';

// The schemas mirror the interfaces in types.ts. zod types an optional key as `T | undefined`, which
// `exactOptionalPropertyTypes` does not accept, so parsed values are cast to the interface by the caller.

export const PROFILE_ID = /^[a-z][a-z0-9-]{0,31}$/;

export const profileIdSchema = z.string().regex(PROFILE_ID);

export const profileDefinitionSchema = z
  .object({
    schema: z.literal(1),
    id: profileIdSchema,
    name: z.string().trim().min(1).max(40),
    colour: z.string().regex(/^#[0-9a-f]{6}$/i),
    createdAt: z.iso.datetime(),
  })
  .strict();

const absolutePath = z.string().startsWith('/');

export const profileSettingsSchema = z
  .object({
    schema: z.literal(1),
    claudeConfig: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('cli-default') }).strict(),
      z.object({ mode: z.literal('directory'), path: absolutePath }).strict(),
    ]),
    tools: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('inherit') }).strict(),
      z
        .object({
          mode: z.literal('isolated'),
          git: z.object({ userName: z.string().min(1).max(200), userEmail: z.string().min(3).max(320) }).strict().optional(),
          ssh: z.object({ agentSocket: absolutePath, publicKeyFile: absolutePath }).strict().optional(),
        })
        .strict(),
    ]),
    isolation: z
      .object({
        provider: z.enum(['local', 'fake', 'srt', 'container', 'openshell', 'ssh']),
        options: z.unknown().optional(),
      })
      .strict(),
    showBadge: z.boolean(),
    shareUnread: z.boolean(),
    permissions: permissionSettingsSchema.optional(),
    agents: agentSettingsSchema.optional(),
    swarm: swarmSettingsSchema.optional(),
    review: reviewSettingsSchema.optional(),
  })
  .strict();

/** Readers apply this to every registry file; the file name must also equal `profileId`. */
export const registryEntrySchema = z
  .object({
    schema: z.literal(1),
    profileId: profileIdSchema,
    pid: z.number().int().positive(),
    instanceId: z.string().min(8).max(64),
    updatedAt: z.iso.datetime(),
    unread: z.number().int().nonnegative().optional(),
  })
  .strict();

/** Readers skip registry files larger than this. */
export const REGISTRY_MAX_BYTES = 4096;

export function defaultSettings(options: { readonly isDefaultProfile: boolean; readonly claudeConfigDir: string }): ProfileSettings {
  return {
    schema: 1,
    claudeConfig: options.isDefaultProfile ? { mode: 'cli-default' } : { mode: 'directory', path: options.claudeConfigDir },
    tools: options.isDefaultProfile ? { mode: 'inherit' } : { mode: 'isolated' },
    isolation: { provider: 'local' },
    showBadge: true,
    shareUnread: true,
  };
}

/** A profile id from a display name: lower case, runs of other characters become one hyphen. */
export function profileIdFromName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+$/, '')
    .slice(0, 28)
    .replace(/-+$/, '');
  return base === '' ? 'profile' : base;
}
