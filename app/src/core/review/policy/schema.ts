import { z } from 'zod';
import { ACTION_CLASS_IDS } from '../../permissions/types';

/**
 * The project review policy `.agide/review-policy.json`, read from the base commit only (0040 section 8).
 * `prefault` makes zod 4 parse an absent nested object, so its defaults apply; `partialRecord` lets `outward`
 * name only some classes.
 */

export const POLICY_PATH = '.agide/review-policy.json';
export const POLICY_MAX_BYTES = 64 * 1024;

const rung = z.enum(['A', 'B', 'C', 'D', 'E']);
const glob = z.string().min(1).max(200);
const globs = z.array(glob).max(200);
const argv = z.array(z.string().min(1).max(1_000)).min(1).max(64);
const notes = z.string().max(2_000).optional();
const size = z.object({ lines: z.number().int().min(1).max(1_000_000), files: z.number().int().min(1).max(100_000) }).strict();
const outwardMode = z.enum(['allow', 'notify', 'draft', 'approve', 'deny']);
const envName = z.string().regex(/^[A-Z_][A-Z0-9_]{0,63}$/);
const reasonIdKey = z.string().regex(/^[a-z]+(\.[a-z_]+)*$/);
const reviewerTier = z.enum(['strong', 'mid']);
const effortB = z.enum(['medium', 'high', 'xhigh']);
const effortHuman = z.enum(['high', 'xhigh']);
/** Relative to the checkout, no `..`; `$TMPDIR/` as the first part names the run's temporary directory (0045 section 3.6). */
const reportGlob = glob.refine((value) => !value.startsWith('/') && !value.split('/').includes('..'), 'a glob relative to the checkout');
const reportGlobs = z.array(reportGlob).max(32);

export const reviewPolicySchema = z
  .object({
    version: z.literal(1),
    notes,
    check: z
      .object({
        notes,
        setup: argv.optional(),
        /** No shell; write ["sh", "-c", "..."] for one. */
        command: argv,
        timeoutSeconds: z.number().int().min(10).max(3_600).default(600),
        network: z.enum(['none', 'development']).default('none'),
        env: z.array(envName).max(32).default([]),
        reports: z
          .object({
            notes,
            junit: reportGlobs.default([]),
            /** Read the check's own output as libtest text (`cargo test`). */
            libtest: z.boolean().default(false),
          })
          .strict()
          .optional(),
        /** Fewer executed tests than this is `check.no_tests`; 1 applies when `reports` names a source and this is absent. */
        minTests: z.number().int().min(0).max(1_000_000).optional(),
        /** On a red base: send back the failures the base does not have, or nothing. */
        redBaseSendBack: z.enum(['new_failures', 'never']).default('new_failures'),
        /** Opt-in: a failure set that the base has entirely reads as rung B (`check.known_failures`). */
        baselineLowers: z.boolean().default(false),
      })
      .strict()
      .optional(),
    retryLimit: z.number().int().min(0).max(5).default(2),
    paths: z
      .object({
        notes,
        sensitive: globs.default([]),
        migrations: globs.default([]),
        /** Replaces the default test globs. */
        tests: globs.optional(),
        testConfig: globs.default([]),
        build: globs.default([]),
        /** Counted in size at a tenth of their lines. */
        generated: globs.default([]),
      })
      .strict()
      .prefault({}),
    thresholds: z
      .object({
        notes,
        small: size.default({ lines: 150, files: 8 }),
        large: size.default({ lines: 600, files: 25 }),
        run: size.default({ lines: 1_200, files: 40 }),
        swarm: size.default({ lines: 2_000, files: 60 }),
        dirs: z.number().int().min(1).max(1_000).default(4),
        denials: z.number().int().min(1).max(1_000).default(5),
        toolErrors: z.number().int().min(1).max(1_000).default(10),
        accumulate: z.number().int().min(2).max(20).default(3),
      })
      .strict()
      .prefault({}),
    /** Unknown ids are a warning and are ignored. */
    rungs: z.record(reasonIdKey, rung).default({}),
    reviewer: z
      .object({
        notes,
        tier: reviewerTier.default('strong'),
        effortB: effortB.default('high'),
        /** The reviewer that runs before rungs C to E. */
        effortHuman: effortHuman.default('xhigh'),
        timeoutMinutes: z.number().int().min(1).max(120).default(15),
        maxTurns: z.number().int().min(1).max(100).default(30),
        usdPerRun: z.number().positive().max(20).default(2),
        /** The profile setting applies when absent. */
        dailyBudgetUsd: z.number().min(0).max(1_000).optional(),
      })
      .strict()
      .prefault({}),
    outward: z.partialRecord(z.enum(ACTION_CLASS_IDS), outwardMode).default({}),
    /** Bash prefixes of the `deploy` class. */
    deployCommands: z.array(z.string().min(1).max(200)).max(32).default([]),
  })
  .strict();

export type ReviewPolicy = z.output<typeof reviewPolicySchema>;
export type ReviewPolicyInput = z.input<typeof reviewPolicySchema>;

/** The built-in policy: the schema defaults and no check command (0040 section 8.3, file missing). */
export const DEFAULT_REVIEW_POLICY: ReviewPolicy = reviewPolicySchema.parse({ version: 1 });

/**
 * The user-level overlay in the profile setting `review.policy` (0040 section 8.4): the same fields, every one
 * optional and without defaults, so an absent field does not tighten anything. The merge only tightens.
 */
export const userPolicySchema = z
  .object({
    notes,
    check: z
      .object({
        notes,
        setup: argv.optional(),
        command: argv.optional(),
        timeoutSeconds: z.number().int().min(10).max(3_600).optional(),
        network: z.enum(['none', 'development']).optional(),
        env: z.array(envName).max(32).optional(),
        reports: z.object({ notes, junit: reportGlobs.optional(), libtest: z.boolean().optional() }).strict().optional(),
        minTests: z.number().int().min(0).max(1_000_000).optional(),
        redBaseSendBack: z.enum(['new_failures', 'never']).optional(),
        baselineLowers: z.boolean().optional(),
      })
      .strict()
      .optional(),
    retryLimit: z.number().int().min(0).max(5).optional(),
    paths: z
      .object({ notes, sensitive: globs.optional(), migrations: globs.optional(), tests: globs.optional(), testConfig: globs.optional(), build: globs.optional(), generated: globs.optional() })
      .strict()
      .optional(),
    thresholds: z
      .object({
        notes,
        small: size.optional(),
        large: size.optional(),
        run: size.optional(),
        swarm: size.optional(),
        dirs: z.number().int().min(1).max(1_000).optional(),
        denials: z.number().int().min(1).max(1_000).optional(),
        toolErrors: z.number().int().min(1).max(1_000).optional(),
        accumulate: z.number().int().min(2).max(20).optional(),
      })
      .strict()
      .optional(),
    rungs: z.record(reasonIdKey, rung).optional(),
    reviewer: z
      .object({
        notes,
        tier: reviewerTier.optional(),
        effortB: effortB.optional(),
        effortHuman: effortHuman.optional(),
        timeoutMinutes: z.number().int().min(1).max(120).optional(),
        maxTurns: z.number().int().min(1).max(100).optional(),
        usdPerRun: z.number().positive().max(20).optional(),
        dailyBudgetUsd: z.number().min(0).max(1_000).optional(),
      })
      .strict()
      .optional(),
    outward: z.partialRecord(z.enum(ACTION_CLASS_IDS), outwardMode).optional(),
    deployCommands: z.array(z.string().min(1).max(200)).max(32).optional(),
  })
  .strict();

export type UserPolicy = z.output<typeof userPolicySchema>;
