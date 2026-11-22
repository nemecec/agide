import type { Reason } from '../schemas';
import { escapePath } from './classify';
import { changedLines, nameOf, type RuleContext } from './context';
import { detectSecret } from './secrets';

const MAX_FINDINGS = 20;

/** `secret.added`: added lines only, evidence holds the path, line and detector id and never the matched text. */
export function secretReasons(ctx: RuleContext): Reason[] {
  const reasons: Reason[] = [];
  for (const file of ctx.files) {
    if (file.kind !== 'text' && file.kind !== 'symlink') continue;
    const findings: { line: number; detector: string }[] = [];
    for (const hunk of ctx.hunksOf(file)) {
      for (const { line, text } of changedLines(hunk).added) {
        const detector = detectSecret(text);
        if (detector !== undefined) findings.push({ line, detector });
      }
    }
    if (findings.length === 0) continue;
    const shown = escapePath(nameOf(file));
    reasons.push(ctx.make('secret.added', { subject: shown, evidence: { path: shown, line: findings[0]!.line, detector: findings[0]!.detector, count: findings.length, findings: findings.slice(0, MAX_FINDINGS) } }));
  }
  return reasons;
}
