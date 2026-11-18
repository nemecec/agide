import { z } from 'zod';

/** Profile settings of the agents module (0027 sections 3, 8, 9 and 11). Every key is optional; absent keys read as the defaults. */
export const agentSettingsSchema = z
  .object({
    removeDoneAfterSeconds: z.number().int().min(0).max(3600).optional(),
    removeFailedAfterSeconds: z.number().int().min(0).max(3600).optional(),
    maxConcurrentAppStarted: z.number().int().min(1).max(16).optional(),
    keepTranscriptsMb: z.number().int().min(0).max(10_000).optional(),
    usage: z
      .object({
        rateWindowMinutes: z.number().int().min(1).max(30).optional(),
        rankingSize: z.number().int().min(1).max(50).optional(),
        heatFloorUsdPerMinute: z.number().min(0).max(100).optional(),
        alertUsdPerMinute: z.number().min(0).max(1000).optional(),
        planThresholds: z.array(z.number().min(1).max(100)).min(1).max(4).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type AgentSettingsInput = z.infer<typeof agentSettingsSchema>;

export interface AgentSettings {
  readonly removeDoneAfterSeconds: number;
  readonly removeFailedAfterSeconds: number;
  readonly maxConcurrentAppStarted: number;
  readonly keepTranscriptsMb: number;
  readonly usage: {
    readonly rateWindowMinutes: number;
    readonly rankingSize: number;
    readonly heatFloorUsdPerMinute: number;
    readonly alertUsdPerMinute: number;
    readonly planThresholds: readonly number[];
  };
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  removeDoneAfterSeconds: 10,
  removeFailedAfterSeconds: 300,
  maxConcurrentAppStarted: 4,
  keepTranscriptsMb: 200,
  usage: { rateWindowMinutes: 5, rankingSize: 8, heatFloorUsdPerMinute: 0.01, alertUsdPerMinute: 0.5, planThresholds: [80, 95] },
};

export function resolveAgentSettings(input: AgentSettingsInput | undefined): AgentSettings {
  const usage = input?.usage;
  return {
    removeDoneAfterSeconds: input?.removeDoneAfterSeconds ?? DEFAULT_AGENT_SETTINGS.removeDoneAfterSeconds,
    removeFailedAfterSeconds: input?.removeFailedAfterSeconds ?? DEFAULT_AGENT_SETTINGS.removeFailedAfterSeconds,
    maxConcurrentAppStarted: input?.maxConcurrentAppStarted ?? DEFAULT_AGENT_SETTINGS.maxConcurrentAppStarted,
    keepTranscriptsMb: input?.keepTranscriptsMb ?? DEFAULT_AGENT_SETTINGS.keepTranscriptsMb,
    usage: {
      rateWindowMinutes: usage?.rateWindowMinutes ?? DEFAULT_AGENT_SETTINGS.usage.rateWindowMinutes,
      rankingSize: usage?.rankingSize ?? DEFAULT_AGENT_SETTINGS.usage.rankingSize,
      heatFloorUsdPerMinute: usage?.heatFloorUsdPerMinute ?? DEFAULT_AGENT_SETTINGS.usage.heatFloorUsdPerMinute,
      alertUsdPerMinute: usage?.alertUsdPerMinute ?? DEFAULT_AGENT_SETTINGS.usage.alertUsdPerMinute,
      planThresholds: usage?.planThresholds ?? DEFAULT_AGENT_SETTINGS.usage.planThresholds,
    },
  };
}
