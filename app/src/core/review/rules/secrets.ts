/**
 * Secret detectors over added lines (0040 section 7.2). A detector reports its id only: the matched text is never
 * stored, logged or put into evidence.
 */

export interface SecretDetector {
  readonly id: string;
  readonly pattern: RegExp;
  /** For an assignment: the capture group holding the literal, which must look random. */
  readonly literalGroup?: number;
}

const ASSIGNMENT = /(?:key|token|secret|passw(?:or)?d)\w*["']?\s*[:=]\s*["']([^"'\s]{20,})["']/i;

/** In order: the first detector that matches a line names it. */
export const SECRET_DETECTORS: readonly SecretDetector[] = [
  { id: 'private-key', pattern: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
  { id: 'aws-access-key', pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/ },
  { id: 'github-token', pattern: /\b(?:gh[opsur]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/ },
  { id: 'slack-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { id: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { id: 'openai-key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/ },
  { id: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
  { id: 'secret-assignment', pattern: ASSIGNMENT, literalGroup: 1 },
];

/** Shannon entropy in bits per character. */
export function entropy(text: string): number {
  if (text.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

const MIN_ENTROPY = 3.5;

/** The id of the detector that matches the line, or undefined. */
export function detectSecret(line: string): string | undefined {
  for (const detector of SECRET_DETECTORS) {
    const match = detector.pattern.exec(line);
    if (match === null) continue;
    if (detector.literalGroup !== undefined && entropy(match[detector.literalGroup] ?? '') < MIN_ENTROPY) continue;
    return detector.id;
  }
  return undefined;
}
