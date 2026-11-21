import { z } from 'zod';
import type { Effort } from './definition';
import { DEFAULT_TIERS, type TierTable } from './tiers';

const tierRow = z.object({ model: z.string().min(1).max(100), effort: z.enum(['low', 'medium', 'high', 'xhigh']) }).strict();

/** Profile settings of the swarm module (0037). Every key is optional; absent keys read as the defaults. */
export const swarmSettingsSchema = z
  .object({
    tiers: z.object({ strong: tierRow.optional(), mid: tierRow.optional(), small: tierRow.optional() }).strict().optional(),
    approvalTimeoutMinutes: z.number().int().min(1).max(1_440).optional(),
    interruptedKeepSeconds: z.number().int().min(0).max(3_600).optional(),
    maxSpawnDepth: z.number().int().min(0).max(2).optional(),
    maxActivePerSession: z.number().int().min(1).max(8).optional(),
  })
  .strict();

export type SwarmSettingsInput = z.infer<typeof swarmSettingsSchema>;

export interface SwarmSettings {
  readonly tiers: TierTable;
  readonly approvalTimeoutMinutes: number;
  readonly interruptedKeepSeconds: number;
  readonly maxSpawnDepth: number;
  readonly maxActivePerSession: number;
}

export const DEFAULT_SWARM_SETTINGS: SwarmSettings = { tiers: DEFAULT_TIERS, approvalTimeoutMinutes: 60, interruptedKeepSeconds: 300, maxSpawnDepth: 1, maxActivePerSession: 2 };

export function resolveSwarmSettings(input: SwarmSettingsInput | undefined): SwarmSettings {
  const row = (tier: keyof TierTable) => {
    const given = input?.tiers?.[tier];
    return given === undefined ? DEFAULT_TIERS[tier] : { model: given.model, effort: given.effort as Effort };
  };
  return {
    tiers: { strong: row('strong'), mid: row('mid'), small: row('small') },
    approvalTimeoutMinutes: input?.approvalTimeoutMinutes ?? DEFAULT_SWARM_SETTINGS.approvalTimeoutMinutes,
    interruptedKeepSeconds: input?.interruptedKeepSeconds ?? DEFAULT_SWARM_SETTINGS.interruptedKeepSeconds,
    maxSpawnDepth: input?.maxSpawnDepth ?? DEFAULT_SWARM_SETTINGS.maxSpawnDepth,
    maxActivePerSession: input?.maxActivePerSession ?? DEFAULT_SWARM_SETTINGS.maxActivePerSession,
  };
}
