import { z } from 'zod';
import type { BlockedPattern } from './redaction';

const blockedFile = z.array(z.strictObject({ origin: z.string().min(1), pathPrefix: z.string().optional() }));

/** The profile's blocked-address file: a JSON list of origins with an optional path prefix. Throws on any other shape. */
export function parseBlockedPatterns(text: string): BlockedPattern[] {
  return blockedFile.parse(JSON.parse(text)).map((entry) => (entry.pathPrefix === undefined ? { origin: entry.origin } : { origin: entry.origin, pathPrefix: entry.pathPrefix }));
}
