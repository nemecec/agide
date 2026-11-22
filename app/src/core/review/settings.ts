import { z } from 'zod';
import { userPolicySchema, type UserPolicy } from './policy/schema';

/** Profile settings of the review module (0040 sections 6, 8.4, 13 and 16). Every key is optional. */
export const reviewSettingsSchema = z
  .object({
    /** List-price equivalent per local day, lowered by the effective policy's `reviewer.dailyBudgetUsd`. */
    dailyBudgetUsd: z.number().min(0).max(1_000).optional(),
    maxConcurrentChecks: z.number().int().min(1).max(8).optional(),
    /** How long a summary or half a hunk must be in view in a focused window to count as seen. */
    dwellMs: z.number().int().min(200).max(30_000).optional(),
    /** The user-level overlay; it only tightens the project policy. */
    policy: userPolicySchema.optional(),
  })
  .strict();

export type ReviewSettingsInput = z.infer<typeof reviewSettingsSchema>;

export interface ReviewSettings {
  readonly dailyBudgetUsd: number;
  readonly maxConcurrentChecks: number;
  readonly dwellMs: number;
  readonly policy: UserPolicy | undefined;
}

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = { dailyBudgetUsd: 5, maxConcurrentChecks: 1, dwellMs: 1_500, policy: undefined };

export function resolveReviewSettings(input: ReviewSettingsInput | undefined): ReviewSettings {
  return {
    dailyBudgetUsd: input?.dailyBudgetUsd ?? DEFAULT_REVIEW_SETTINGS.dailyBudgetUsd,
    maxConcurrentChecks: input?.maxConcurrentChecks ?? DEFAULT_REVIEW_SETTINGS.maxConcurrentChecks,
    dwellMs: input?.dwellMs ?? DEFAULT_REVIEW_SETTINGS.dwellMs,
    policy: input?.policy,
  };
}
