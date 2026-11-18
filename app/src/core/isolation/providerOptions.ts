import { z } from 'zod';

/** What `isolation.options` of a profile may hold. Anything else is ignored when read and refused when written. */
export interface IsolationOptions {
  readonly srtBinary?: string | undefined;
  readonly dockerBinary?: string | undefined;
  readonly containerImage?: string | undefined;
  readonly extraWritePaths?: readonly string[] | undefined;
  readonly extraDenyRead?: readonly string[] | undefined;
}

const absolute = z.string().startsWith('/');

export const isolationOptionsSchema = z
  .object({
    srtBinary: z.string().trim().min(1).max(512).optional(),
    dockerBinary: z.string().trim().min(1).max(512).optional(),
    containerImage: z.string().trim().min(1).max(256).optional(),
    extraWritePaths: z.array(absolute).max(64).optional(),
    extraDenyRead: z.array(absolute).max(64).optional(),
  })
  .strict();

/** Reads the stored value; an invalid one reads as no options. */
export function readIsolationOptions(raw: unknown): IsolationOptions {
  const parsed = isolationOptionsSchema.safeParse(raw ?? {});
  return parsed.success ? (parsed.data as IsolationOptions) : {};
}
