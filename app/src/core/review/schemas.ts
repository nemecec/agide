import { z } from 'zod';
import { agentNameSchema, tierSchema } from '../swarm/definition';
import { reviewPolicySchema } from './policy/schema';
import { testRunSummarySchema } from './reports/types';

/**
 * Records of the review ladder (0040 sections 3 and 7, 0041). The SQLite store and the in-memory store keep the
 * same shapes; field names are the camelCase of the columns in `store/reviewMigrations.ts`. Text marked "agent
 * text" is untrusted and shown as plain text only.
 */

export const RUNGS = ['A', 'B', 'C', 'D', 'E'] as const;
export const rungSchema = z.enum(RUNGS);
export type Rung = z.output<typeof rungSchema>;

export const CHANGESET_STATES = ['captured', 'checking', 'assessed', 'in_review', 'queued_for_budget', 'awaiting_human', 'accepted', 'rejected', 'sent_back', 'superseded'] as const;
export const changesetStateSchema = z.enum(CHANGESET_STATES);
export type ChangesetState = z.output<typeof changesetStateSchema>;
/** No transition leaves these states. A merged `accepted` changeset is final too (`mergedCommit` set). */
export const FINAL_STATES: readonly ChangesetState[] = ['rejected', 'superseded'];

export const CAPTURE_TRIGGERS = ['quiet-result', 'agent-ended', 'removal'] as const;
export const captureTriggerSchema = z.enum(CAPTURE_TRIGGERS);
export type CaptureTrigger = z.output<typeof captureTriggerSchema>;

export const CHANGESET_ID_PATTERN = /^cs_[0-9a-f]{16}$/;
export const changesetIdSchema = z.string().regex(CHANGESET_ID_PATTERN, "'cs_' and 16 lower-case hex characters");
export type ChangesetId = z.output<typeof changesetIdSchema>;

const sha = z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/, 'a full git object id');
const hash = z.string().regex(/^[0-9a-f]{64}$/, 'a SHA-256 hash in hex');
const isoTime = z.string().min(1);
const swarmId = z.string().min(1).max(64);

/** What a capture is about. A later PTY path adds its own kind (0040 section 1). */
export const captureSubjectSchema = z.object({ kind: z.literal('swarm-agent'), swarmId, agent: agentNameSchema }).strict();
export type CaptureSubject = z.output<typeof captureSubjectSchema>;

export const REASON_SOURCES = ['rule', 'check', 'telemetry', 'policy', 'claim', 'reviewer', 'agent', 'user', 'repo'] as const;
export const reasonSourceSchema = z.enum(REASON_SOURCES);
export type ReasonSource = z.output<typeof reasonSourceSchema>;

export const REASON_ID_PATTERN = /^[a-z]+(\.[a-z_]+)*$/;

/** A reason as rules, checks, reviewers, agents and the user produce it (0040 section 7.1). */
export const reasonSchema = z
  .object({
    id: z.string().regex(REASON_ID_PATTERN),
    /** A path, a finding id, or '' for the whole changeset. */
    subject: z.string().max(4_096).default(''),
    source: reasonSourceSchema,
    /** JSON; agent text inside it is wrapped as `{ untrusted: true, text }`. */
    evidence: z.record(z.string(), z.unknown()),
    /** After policy overrides. */
    minRung: rungSchema,
    hard: z.boolean(),
  })
  .strict();
export type Reason = z.output<typeof reasonSchema>;
export type ReasonInput = z.input<typeof reasonSchema>;

export const storedReasonSchema = reasonSchema.extend({ changesetId: changesetIdSchema, createdAt: isoTime }).strict();
export type StoredReason = z.output<typeof storedReasonSchema>;

export const FILE_STATUSES = ['A', 'M', 'D', 'R', 'T'] as const;
export const FILE_KINDS = ['text', 'binary', 'symlink', 'submodule', 'large'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/** One file of a changeset (0040 section 5). Paths are agent text and may hold any byte the name had. */
export const changesetFileSchema = z
  .object({
    changesetId: changesetIdSchema,
    idx: z.number().int().min(0),
    status: z.enum(FILE_STATUSES),
    oldPath: z.string().nullable(),
    newPath: z.string().nullable(),
    oldMode: z.string().nullable(),
    newMode: z.string().nullable(),
    oldBlob: z.string().nullable(),
    newBlob: z.string().nullable(),
    similarity: z.number().int().min(0).max(100).nullable(),
    kind: z.enum(FILE_KINDS),
    added: z.number().int().min(0),
    removed: z.number().int().min(0),
    oddName: z.boolean(),
    fileHash: hash,
  })
  .strict()
  .refine((file) => file.oldPath !== null || file.newPath !== null, 'a file has an old path, a new path or both');
export type ChangesetFile = z.output<typeof changesetFileSchema>;

/** One hunk; `body` keeps the `+`, `-`, space and `\` prefixes and any `\r`. */
export const hunkSchema = z
  .object({
    changesetId: changesetIdSchema,
    fileIdx: z.number().int().min(0),
    idx: z.number().int().min(0),
    oldStart: z.number().int().min(0),
    oldLines: z.number().int().min(0),
    newStart: z.number().int().min(0),
    newLines: z.number().int().min(0),
    /** The text after the second `@@`; agent text. */
    section: z.string().nullable(),
    body: z.string(),
    hunkHash: hash,
  })
  .strict();
export type Hunk = z.output<typeof hunkSchema>;

/** The tool input of `report_outcome`; also the claim of a capture (0040 section 11.2). */
export const reportOutcomeInputSchema = z
  .object({
    summary: z.string().min(1).max(4_000),
    confidence: z.enum(['high', 'medium', 'low']),
    testsRun: z.array(z.string().min(1).max(300)).max(20).default([]),
    unverified: z.array(z.string().min(1).max(300)).max(20).default([]),
    /** Raise only. */
    requestRung: z.enum(['B', 'C', 'D', 'E']).optional(),
  })
  .strict();
export type ReportOutcomeInput = z.output<typeof reportOutcomeInputSchema>;

/** What the working agent says it did: its latest `report_outcome` since the previous capture, else its result text. Agent text. */
export const claimSchema = z.discriminatedUnion('source', [
  reportOutcomeInputSchema.extend({ source: z.literal('report_outcome') }).strict(),
  z.object({ source: z.literal('result'), text: z.string().max(8_000) }).strict(),
]);
export type Claim = z.output<typeof claimSchema>;

/** The run telemetry a capture records (0040 section 7.2, `run.*` reasons). */
export const telemetrySchema = z
  .object({
    endState: z.enum(['running', 'done', 'failed', 'stopped', 'interrupted']),
    endReason: z.string().max(100).optional(),
    turns: z.number().int().min(0),
    retries: z.number().int().min(0),
    denials: z.number().int().min(0),
    deniedTools: z.array(z.string().max(200)).max(50),
    toolErrors: z.number().int().min(0),
    spendUsd: z.number().min(0),
    backgroundStopped: z.number().int().min(0).default(0),
  })
  .strict();
export type Telemetry = z.output<typeof telemetrySchema>;

/** A changeset: one capture of one agent run (0040 sections 3.3 and 4.3). */
export const changesetSchema = z
  .object({
    id: changesetIdSchema,
    swarmId,
    agent: agentNameSchema,
    sessionId: z.string().min(1),
    seq: z.number().int().min(1),
    /** Send-backs of this agent run before this capture. */
    attempt: z.number().int().min(0),
    trigger: captureTriggerSchema,
    repoPath: z.string().min(1),
    commonDir: z.string().min(1),
    baseCommit: sha,
    headCommit: sha,
    checkpointCommit: sha,
    checkpointTree: sha,
    contentHash: hash,
    policyHash: hash,
    /** Relative to the profile data directory. */
    patchPath: z.string().min(1),
    fileCount: z.number().int().min(0),
    added: z.number().int().min(0),
    removed: z.number().int().min(0),
    workerTier: tierSchema,
    claim: claimSchema.nullable(),
    telemetry: telemetrySchema,
    state: changesetStateSchema,
    rung: rungSchema,
    floor: rungSchema,
    supersedes: changesetIdSchema.nullable(),
    mergedCommit: sha.nullable(),
    createdAt: isoTime,
    updatedAt: isoTime,
  })
  .strict()
  .refine((changeset) => changeset.rung >= changeset.floor, 'the rung is never below the floor')
  .refine((changeset) => changeset.mergedCommit === null || changeset.state === 'accepted', 'only an accepted changeset is merged');
export type ChangesetRecord = z.output<typeof changesetSchema>;

export const CHECK_OUTCOMES = ['running', 'passed', 'failed', 'timed_out', 'not_run'] as const;
export type CheckOutcome = (typeof CHECK_OUTCOMES)[number];

/** One run of the project check on the checkpoint or on the base commit (0040 section 6). */
export const checkRecordSchema = z
  .object({
    id: z.string().min(1),
    /** Null for a base run, which is shared by every changeset on the same base and policy. */
    changesetId: changesetIdSchema.nullable(),
    target: z.enum(['checkpoint', 'base']),
    commitId: sha,
    policyHash: hash,
    /** The argv from the base policy; app text. */
    command: z.array(z.string()),
    outcome: z.enum(CHECK_OUTCOMES),
    notRunReason: z.string().max(500).nullable(),
    exitCode: z.number().int().nullable(),
    signal: z.string().nullable(),
    durationMs: z.number().int().min(0).nullable(),
    outputPath: z.string().nullable(),
    /** Untrusted: agent-written code produced it. */
    outputTail: z.string().max(8_000).nullable(),
    truncated: z.boolean(),
    /** The counts of the test reports of this run; absent for a run whose reports were not looked for (0045 section 4.3). */
    tests: testRunSummarySchema.nullable().optional(),
    /** The check this run repeated, for the one rerun of a checkpoint whose failures are all flaky on the base. */
    rerunOf: z.string().nullable().optional(),
    startedAt: isoTime,
    endedAt: isoTime.nullable(),
  })
  .strict()
  .refine((check) => (check.outcome === 'running') === (check.endedAt === null), 'a running check has no end time and an ended one has');
export type CheckRecord = z.output<typeof checkRecordSchema>;

export const RUN_STATES = ['queued', 'running', 'reported', 'failed', 'cancelled'] as const;
export type ReviewRunState = (typeof RUN_STATES)[number];
export const RUN_FAILURES = ['no-report', 'timeout', 'spawn', 'error-result', 'budget', 'superseded', 'user', 'app-exit'] as const;
export type RunFailure = (typeof RUN_FAILURES)[number];

/** One reviewer process for one changeset (0040 section 10). */
export const reviewRunSchema = z
  .object({
    id: z.string().min(1),
    changesetId: changesetIdSchema,
    attempt: z.union([z.literal(1), z.literal(2)]),
    sessionId: z.string().min(1).nullable(),
    model: z.string().min(1),
    effort: z.string().min(1),
    /** The prompt template's version id; set when the run starts. */
    promptVersion: z.string().max(100).nullable(),
    state: z.enum(RUN_STATES),
    failure: z.enum(RUN_FAILURES).nullable(),
    pid: z.number().int().nullable(),
    reservedUsd: z.number().min(0),
    reportedUsd: z.number().min(0),
    rejectedCalls: z.number().int().min(0),
    queuedAt: isoTime,
    startedAt: isoTime.nullable(),
    endedAt: isoTime.nullable(),
  })
  .strict();
export type ReviewRunRecord = z.output<typeof reviewRunSchema>;

export const SEVERITIES = ['blocker', 'major', 'minor', 'nit'] as const;
export type Severity = (typeof SEVERITIES)[number];
/** Findings at these severities block a rung B accept (0040 section 2). */
export const BLOCKING_SEVERITIES: readonly Severity[] = ['blocker', 'major'];

/** One finding as the reviewer sends it in `report_review` (0040 section 11.1). */
export const reportFindingSchema = z
  .object({
    path: z.string().min(1).max(1_000),
    line: z.number().int().min(1),
    side: z.enum(['new', 'old']).default('new'),
    severity: z.enum(SEVERITIES),
    title: z.string().min(1).max(200),
    body: z.string().max(2_000).default(''),
  })
  .strict();

/** The tool input of `report_review` (0040 section 11.1). */
export const reportReviewInputSchema = z
  .object({
    changesetId: changesetIdSchema,
    verdict: z.enum(['accept', 'revise', 'escalate']),
    escalateTo: z.enum(['C', 'D', 'E']).optional(),
    claimCheck: z.enum(['confirmed', 'partly', 'contradicted', 'not_checkable']),
    summary: z.string().min(1).max(2_000),
    findings: z.array(reportFindingSchema).max(50),
  })
  .strict()
  .refine((input) => (input.verdict === 'escalate') === (input.escalateTo !== undefined), {
    message: 'escalateTo is required with verdict escalate and refused with any other verdict',
    path: ['escalateTo'],
  });
export type ReportReviewInput = z.output<typeof reportReviewInputSchema>;

/** A finding after anchoring: the file index, the hunk hash and whether it sits on a changed line. Agent text. */
export const storedFindingSchema = z
  .object({
    idx: z.number().int().min(0),
    fileIdx: z.number().int().min(0),
    side: z.enum(['new', 'old']),
    line: z.number().int().min(1),
    hunkHash: hash,
    onChangedLine: z.boolean(),
    severity: z.enum(SEVERITIES),
    title: z.string().min(1).max(200),
    body: z.string().max(2_000),
  })
  .strict();
export type StoredFinding = z.output<typeof storedFindingSchema>;

/** A stored reviewer report (0040 sections 10.4 to 10.6). */
export const reviewReportSchema = z
  .object({
    id: z.string().min(1),
    runId: z.string().min(1),
    changesetId: changesetIdSchema,
    verdict: z.enum(['accept', 'revise', 'escalate']),
    escalateTo: z.enum(['C', 'D', 'E']).nullable(),
    claimCheck: z.enum(['confirmed', 'partly', 'contradicted', 'not_checkable']),
    /** Agent text. */
    summary: z.string().min(1).max(2_000),
    findings: z.array(storedFindingSchema).max(50),
    droppedFindings: z.number().int().min(0),
    receivedAt: isoTime,
  })
  .strict()
  .refine((report) => (report.verdict === 'escalate') === (report.escalateTo !== null), 'escalateTo goes with verdict escalate only');
export type ReviewReport = z.output<typeof reviewReportSchema>;

export const DECISION_ACTORS = ['app', 'reviewer', 'agent', 'user'] as const;
export type DecisionActor = (typeof DECISION_ACTORS)[number];

/**
 * Every state or rung change. The list of 0040 section 3.3 plus `start_check` (captured to checking),
 * `review_failed` (no report after the last reviewer run) and `undeliverable` (a send-back that did not reach
 * the agent), `no_new_capture` (the agent ended after a send-back without new work), so each row of the transition table has its own action.
 */
export const REVIEW_ACTIONS = [
  'start_check',
  'assess',
  'auto_accept',
  'auto_send_back',
  'start_review',
  'queue_budget',
  'report',
  'review_failed',
  'accept',
  'reject',
  'send_back',
  'reopen',
  'escalate',
  'request_escalation',
  'demote',
  'supersede',
  'undeliverable',
  'no_new_capture',
  'merge',
] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

/** An append-only row per state or rung change (0040 section 3.3). */
export const decisionSchema = z
  .object({
    id: z.string().min(1),
    changesetId: changesetIdSchema,
    actor: z.enum(DECISION_ACTORS),
    actorSessionId: z.string().nullable(),
    action: z.enum(REVIEW_ACTIONS),
    fromState: changesetStateSchema,
    toState: changesetStateSchema,
    fromRung: rungSchema,
    toRung: rungSchema,
    /** The content the decision was made on. */
    contentHash: hash,
    /** User or agent text; required for demote. */
    reason: z.string().max(1_000).nullable(),
    createdAt: isoTime,
  })
  .strict();
export type DecisionRecord = z.output<typeof decisionSchema>;

/** A line comment of the user, sent back to the agent as one batch (0040 section 14). */
export const commentSchema = z
  .object({
    id: z.string().min(1),
    changesetId: changesetIdSchema,
    fileIdx: z.number().int().min(0),
    side: z.enum(['new', 'old']),
    line: z.number().int().min(1),
    hunkHash: hash,
    body: z.string().min(1).max(4_000),
    state: z.enum(['draft', 'sent']),
    /** The decision id of the send-back. */
    sentIn: z.string().nullable(),
    createdAt: isoTime,
  })
  .strict()
  .refine((comment) => (comment.state === 'sent') === (comment.sentIn !== null), 'a sent comment names its send-back');
export type CommentRecord = z.output<typeof commentSchema>;

export const SEEN_LEVELS = ['summary', 'file', 'hunk'] as const;
export type SeenLevel = (typeof SEEN_LEVELS)[number];

/** What the user looked at, bound to a hash so a change makes it lapse (0040 section 13). */
export const seenMarkSchema = z
  .object({
    /** `<swarm id>/<agent>`: marks carry across that agent's changesets. */
    scope: z.string().min(3),
    level: z.enum(SEEN_LEVELS),
    subjectHash: hash,
    /** Where the mark was made. */
    changesetId: changesetIdSchema,
    how: z.enum(['dwell', 'marked']),
    seenAt: isoTime,
  })
  .strict();
export type SeenMark = z.output<typeof seenMarkSchema>;

/** The policy a swarm's changesets are assessed against (0040 section 8.3). */
export const policySnapshotSchema = z
  .object({
    hash,
    source: z.enum(['base', 'default', 'invalid']),
    repoPath: z.string().min(1),
    baseCommit: sha,
    /** The file as read; null when missing. */
    projectJson: z.string().nullable(),
    /** The user-level overlay as applied. */
    userJson: z.string().nullable(),
    effective: reviewPolicySchema,
    /** The zod issues when invalid; unknown reason ids in `rungs` as warnings. */
    errors: z.array(z.string()).nullable(),
    warnings: z.array(z.string()).default([]),
    createdAt: isoTime,
  })
  .strict();
export type PolicySnapshot = z.output<typeof policySnapshotSchema>;

/** The scope of seen marks of an agent: marks carry across that agent's changesets. */
export const seenScope = (swarm: string, agent: string): string => `${swarm}/${agent}`;
