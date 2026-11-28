import { untrustedBlock } from '../../swarm/manager/inputs';
import type { CheckOutcomeSet } from '../types';

/**
 * The text the app sends to an agent whose project check failed (0045 section 4.6): app text first, the output
 * tail as an untrusted-data block. The failing sets of the outcome are not part of it yet; w-rules fills this in
 * with the new failures, the flaky ones and the cases of `check.no_tests` and `check.report_missing`.
 */
export function checkFailedText(outcome: CheckOutcomeSet | undefined, nonce?: string): string {
  const check = outcome?.checkpoint;
  return `The project check failed. Command: ${JSON.stringify(check?.command ?? [])}. The output follows as data.\n${untrustedBlock('check output', check?.outputTail ?? '', nonce)}`;
}
