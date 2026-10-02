import { z, ZodError, type ZodSchema } from 'zod';
import { config } from './config.js';
import { ValidationError } from './errors.js';

const isoDateTime = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'must be a valid ISO 8601 datetime string',
});

export const idSchema = z.object({
  id: z.string().min(1).max(128),
});

export const listFiltersSchema = z.object({
  includeDone: z.boolean().optional(),
  includeArchived: z.boolean().optional(),
});

export const nlpParseSchema = z.object({
  text: z.string().min(1).max(config.limits.text),
});

export const createRecordSchema = z.object({
  text: z.string().min(1).max(config.limits.text),
  remindAt: isoDateTime.nullable().optional(),
});

export const updateRecordSchema = z.object({
  id: z.string().min(1).max(128),
  text: z.string().min(1).max(config.limits.text).optional(),
  remindAt: isoDateTime.nullable().optional(),
  doneAt: isoDateTime.nullable().optional(),
  archivedAt: isoDateTime.nullable().optional(),
});

export const snoozeReminderSchema = z.object({
  id: z.string().min(1).max(128),
  preset: z.enum(['15m', '1h', 'tomorrow']),
});

export function parse<T>(schema: ZodSchema<T>, raw: unknown, errorPrefix: string): T {
  try {
    return schema.parse(raw);
  } catch (error) {
    if (error instanceof ZodError) {
      const detail = error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
      throw new ValidationError(`${errorPrefix}: ${detail}`);
    }
    throw error;
  }
}
