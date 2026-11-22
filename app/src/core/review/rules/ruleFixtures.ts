import { reviewPolicySchema, type ReviewPolicyInput } from '../policy/schema';
import { changesetRecord, captureFixture, policySnapshot, sha1Of, sha256Of } from '../fakes/fixtures';
import type { ChangesetFile, ChangesetRecord, CheckRecord, Claim, Hunk, Reason, Telemetry } from '../schemas';
import type { AssessInput } from '../types';
import { DefaultRiskRules } from './DefaultRiskRules';

/** Builders for the rule tests: a changeset made of file specs, with hunks built from their lines. */

export interface FileSpec {
  readonly path: string;
  readonly oldPath?: string | null;
  readonly status?: ChangesetFile['status'];
  readonly kind?: ChangesetFile['kind'];
  readonly oldMode?: string | null;
  readonly newMode?: string | null;
  readonly added?: number;
  readonly removed?: number;
  readonly oddName?: boolean;
  /** Hunk bodies, lines with their `+`, `-` and space prefixes, joined by newlines. */
  readonly bodies?: readonly string[];
  /** Shorthand for one body made of added lines. */
  readonly add?: readonly string[];
}

const countLines = (bodies: readonly string[], mark: string): number => bodies.reduce((sum, body) => sum + body.split('\n').filter((line) => line.startsWith(mark)).length, 0);

export function build(specs: readonly FileSpec[]): { files: ChangesetFile[]; hunks: Hunk[] } {
  const files: ChangesetFile[] = [];
  const hunks: Hunk[] = [];
  const changesetId = captureFixture({ seed: 'rules', policyHash: sha256Of('p') }).id;
  specs.forEach((spec, idx) => {
    const bodies = spec.bodies ?? (spec.add === undefined ? [] : [spec.add.map((line) => `+${line}`).join('\n')]);
    const status = spec.status ?? 'M';
    const oldPath = spec.oldPath === undefined ? (status === 'A' ? null : spec.path) : spec.oldPath;
    files.push({
      changesetId,
      idx,
      status,
      oldPath,
      newPath: status === 'D' ? null : spec.path,
      oldMode: spec.oldMode === undefined ? (status === 'A' ? null : '100644') : spec.oldMode,
      newMode: spec.newMode === undefined ? (status === 'D' ? null : '100644') : spec.newMode,
      oldBlob: status === 'A' ? null : sha1Of(`old:${spec.path}`),
      newBlob: status === 'D' ? null : sha1Of(`new:${spec.path}`),
      similarity: null,
      kind: spec.kind ?? 'text',
      added: spec.added ?? countLines(bodies, '+'),
      removed: spec.removed ?? countLines(bodies, '-'),
      oddName: spec.oddName ?? false,
      fileHash: sha256Of(`file:${spec.path}`),
    });
    bodies.forEach((body, hunkIdx) => {
      const lines = body.split('\n');
      hunks.push({
        changesetId,
        fileIdx: idx,
        idx: hunkIdx,
        oldStart: 1,
        oldLines: lines.filter((line) => !line.startsWith('+')).length,
        newStart: 1,
        newLines: lines.filter((line) => !line.startsWith('-')).length,
        section: null,
        body,
        hunkHash: sha256Of(`hunk:${spec.path}:${hunkIdx}:${body}`),
      });
    });
  });
  return { files, hunks };
}

export interface InputOptions {
  readonly files?: readonly FileSpec[];
  readonly policy?: Partial<Omit<ReviewPolicyInput, 'version'>> | undefined;
  readonly policySource?: 'base' | 'default' | 'invalid';
  readonly policyErrors?: string[];
  readonly check?: { checkpoint: CheckRecord['outcome']; base?: CheckRecord['outcome'] };
  readonly telemetry?: Partial<Telemetry>;
  readonly claim?: Claim | null;
  readonly attempt?: number;
  readonly runChangesets?: readonly ChangesetRecord[];
  readonly swarmChangesets?: readonly ChangesetRecord[];
  readonly owns?: readonly string[];
  readonly otherAgentsPaths?: Readonly<Record<string, readonly string[]>>;
}

const checkRecord = (target: 'checkpoint' | 'base', outcome: CheckRecord['outcome']): CheckRecord => ({
  id: `chk_${target}`,
  changesetId: target === 'checkpoint' ? 'cs_aaaaaaaaaaaaaaaa' : null,
  target,
  commitId: sha1Of(target),
  policyHash: sha256Of('p'),
  command: ['pnpm', 'test'],
  outcome,
  notRunReason: outcome === 'not_run' ? 'no isolation' : null,
  exitCode: outcome === 'failed' ? 1 : outcome === 'passed' ? 0 : null,
  signal: null,
  durationMs: 10,
  outputPath: null,
  outputTail: outcome === 'failed' ? 'FAIL x' : '',
  truncated: false,
  startedAt: '2026-11-21T10:00:00.000Z',
  endedAt: '2026-11-21T10:00:01.000Z',
});

export function input(options: InputOptions = {}): AssessInput {
  const { files, hunks } = build(options.files ?? []);
  const capture = captureFixture({ seed: 'rules', policyHash: sha256Of('p'), ...(options.claim === undefined ? {} : { claim: options.claim }) });
  const { changeset } = changesetRecord(capture);
  const policy = policySnapshot(reviewPolicySchema.parse({ version: 1, check: { command: ['pnpm', 'test'] }, ...options.policy }), 'rules');
  return {
    changeset: { ...changeset, attempt: options.attempt ?? 0, telemetry: { ...changeset.telemetry, ...options.telemetry }, ...(options.claim === undefined ? {} : { claim: options.claim }) },
    files,
    hunks,
    policy: { ...policy, source: options.policySource ?? 'base', errors: options.policyErrors ?? null },
    check: options.check === undefined ? undefined : { checkpoint: checkRecord('checkpoint', options.check.checkpoint), ...(options.check.base === undefined ? {} : { base: checkRecord('base', options.check.base) }) },
    runChangesets: options.runChangesets ?? [],
    swarmChangesets: options.swarmChangesets ?? [],
    owns: options.owns ?? [],
    otherAgentsPaths: options.otherAgentsPaths ?? {},
  };
}

export const rules = new DefaultRiskRules();
export const assess = (options: InputOptions = {}): Reason[] => rules.assess(input(options));
export const ids = (reasons: readonly Reason[]): string[] => reasons.map((reason) => reason.id);
export const reasonOf = (reasons: readonly Reason[], id: string): Reason | undefined => reasons.find((reason) => reason.id === id);

/** An earlier changeset of the same agent or of another one, for the size reasons. */
export function otherChangeset(seed: string, patch: Partial<ChangesetRecord>): ChangesetRecord {
  const capture = captureFixture({ seed, policyHash: sha256Of('p') });
  return { ...changesetRecord(capture).changeset, ...patch };
}
