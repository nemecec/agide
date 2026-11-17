import { z } from 'zod';
import { httpUrl } from './urlSchema';
import { DETAILS_MAX, ITEM_KINDS, URGENCIES } from './types';

const linkAnchorSchema = z.union([
  z.object({ transcriptPath: z.string().min(1).max(4096), byteOffset: z.number().int().nonnegative() }).strict(),
  z.object({ changesetId: z.string().min(1).max(128), file: z.string().max(4096).optional(), hunk: z.number().int().nonnegative().optional() }).strict(),
  z.object({ url: httpUrl }).strict(),
  z.object({ surfaceId: z.string().min(1).max(128) }).strict(),
]);

/** Shape check of `NewItem` before cleaning. Lengths of the cleaned text are checked again by the store. */
export const newItemSchema = z
  .object({
    folderId: z.string().min(1).max(64).nullable(),
    kind: z.enum(ITEM_KINDS),
    urgency: z.enum(URGENCIES).optional(),
    source: z.enum(['hook', 'agent', 'app', 'scheduler']),
    origin: z.string().min(1).max(80),
    sessionId: z.string().min(1).max(64).optional(),
    agentId: z.string().min(1).max(128).optional(),
    linkNodeId: z.string().min(1).max(64).optional(),
    linkAnchor: linkAnchorSchema.optional(),
    message: z.string().min(1).max(1000),
    details: z.string().max(DETAILS_MAX).optional(),
    textAuthor: z.enum(['agent', 'app', 'user']),
    payload: z.json().optional(),
    dedupeKey: z.string().min(1).max(200).optional(),
  })
  .strict();
