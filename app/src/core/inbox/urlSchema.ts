import { z } from 'zod';

/** A web address an agent or user supplies. Only http and https pass, so a stored link never carries a script scheme. */
export const httpUrl = z
  .url()
  .max(2000)
  .refine((value) => /^https?:\/\//i.test(value), 'must start with http:// or https://');
