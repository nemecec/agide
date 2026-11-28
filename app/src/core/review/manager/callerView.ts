import { cleanLine } from '../../inbox/text';
import { quotedValue, untrustedBlock } from '../../swarm/manager/inputs';
import type { FailureSets, TestRef } from '../reports/types';
import type { ChangesetDetail, ReviewCaller } from '../types';

export const HUNK_TEXT_MAX = 100 * 1024;

const wrap = (source: string, text: string): { readonly untrusted: string } => ({ untrusted: untrustedBlock(source, text) });

const isUntrustedText = (value: unknown): value is { untrusted: true; text: string } =>
  typeof value === 'object' && value !== null && (value as { untrusted?: unknown }).untrusted === true && typeof (value as { text?: unknown }).text === 'string';

/** The text of a failing test was written by the code under test: a session reads suite, name and message as quoted data. */
function testRefForCaller(ref: TestRef): unknown {
  return { key: ref.key, suite: quotedValue(ref.suite), name: quotedValue(ref.name), message: ref.message === null ? null : wrap('test-report', ref.message) };
}

function failuresForCaller(failures: FailureSets): unknown {
  return { ...failures, new: failures.new.map(testRefForCaller), known: failures.known.map(testRefForCaller), flaky: failures.flaky.map(testRefForCaller), fixed: failures.fixed.map(testRefForCaller) };
}

/** Evidence with agent text in tagged blocks; the ref names and tips of the user's other branches stay out. */
function evidenceFor(reasonId: string, evidence: unknown): unknown {
  if (reasonId === 'repo.ref_moved') return {};
  if (isUntrustedText(evidence)) return wrap('working-agent', evidence.text);
  if (Array.isArray(evidence)) return evidence.map((item) => evidenceFor(reasonId, item));
  if (typeof evidence === 'object' && evidence !== null) return Object.fromEntries(Object.entries(evidence).map(([key, value]) => [key, evidenceFor(reasonId, value)]));
  return evidence;
}

/**
 * What a session reads of a changeset (0040 section 11.3): the diff text, the agent's claim, the reviewer's words,
 * paths and reasons given by people are data, so they arrive in tagged blocks or as quoted values. Hunk text stops
 * at 100 KB. The user reads the records as they are.
 */
export function detailForCaller(detail: ChangesetDetail, caller: ReviewCaller): unknown {
  if (caller.kind === 'ui') return detail;
  let budget = HUNK_TEXT_MAX;
  let cut = false;
  const hunks = detail.hunks?.flatMap((hunk) => {
    if (budget <= 0) return [];
    const body = hunk.body.slice(0, budget);
    budget -= body.length;
    const truncated = body.length < hunk.body.length;
    cut ||= truncated;
    return [{ ...hunk, section: hunk.section === null ? null : quotedValue(hunk.section), body: wrap('diff', body), ...(truncated ? { truncated: true, note: 'This hunk was cut at the size cap.' } : {}) }];
  });
  const { claim } = detail.changeset;
  return {
    ...detail,
    changeset: {
      ...detail.changeset,
      repoPath: undefined,
      commonDir: undefined,
      patchPath: undefined,
      claim: claim === null ? null : wrap('working-agent', JSON.stringify(claim)),
    },
    files: detail.files.map((file) => ({ ...file, oldPath: file.oldPath === null ? null : quotedValue(file.oldPath), newPath: file.newPath === null ? null : quotedValue(file.newPath) })),
    ...(hunks === undefined ? {} : { hunks, hunksTruncated: cut || detail.hunks!.length > hunks.length }),
    checks: detail.checks.map((check) => ({ ...check, outputTail: check.outputTail === null ? null : wrap('check', check.outputTail), outputPath: undefined })),
    ...(detail.failures === undefined ? {} : { failures: failuresForCaller(detail.failures) }),
    ...(detail.report === undefined
      ? {}
      : {
          report: {
            ...detail.report,
            summary: wrap('reviewer', detail.report.summary),
            findings: detail.report.findings.map((finding) => ({ ...finding, title: wrap('reviewer', finding.title), body: wrap('reviewer', finding.body) })),
          },
        }),
    reasons: detail.reasons.map((reason) => ({ ...reason, evidence: evidenceFor(reason.id, reason.evidence) })),
    runs: detail.runs.map((run) => ({ ...run, sessionId: undefined, pid: undefined })),
    decisions: detail.decisions.map((decision) => ({ ...decision, actorSessionId: undefined, reason: decision.reason === null ? null : cleanLine(decision.reason).slice(0, 300) })),
    comments: detail.comments.map((comment) => ({ ...comment, body: quotedValue(comment.body, 1_000) })),
  };
}
