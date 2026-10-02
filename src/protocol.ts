import { z } from 'zod';
import {
  createRecordSchema,
  idSchema,
  listFiltersSchema,
  nlpParseSchema,
  parse,
  snoozeReminderSchema,
  updateRecordSchema,
} from './validation.js';

export const OPERATIONS = [
  'record.create',
  'record.list',
  'record.get',
  'record.update',
  'record.delete',
  'record.markDone',
  'record.archive',
  'nlp.parse',
  'reminder.listPending',
  'reminder.dismiss',
  'reminder.ok',
  'reminder.snooze',
] as const;

export type Operation = (typeof OPERATIONS)[number];

const requestSchema = z.object({
  kind: z.literal('request'),
  requestId: z.string().min(1).max(128),
  operation: z.enum(OPERATIONS),
  payload: z.unknown().optional(),
});

export type Request = z.infer<typeof requestSchema>;

export function parseRequest(raw: unknown): Request {
  return parse(requestSchema, raw, 'Invalid WebSocket request');
}

export function parsePayload(operation: Operation, payload: unknown): unknown {
  switch (operation) {
    case 'record.create':
      return parse(createRecordSchema, payload, 'Invalid record.create payload');
    case 'record.list':
      return parse(listFiltersSchema, payload ?? {}, 'Invalid record.list payload');
    case 'record.get':
    case 'record.delete':
    case 'record.markDone':
    case 'record.archive':
    case 'reminder.dismiss':
    case 'reminder.ok':
      return parse(idSchema, payload, `Invalid ${operation} payload`);
    case 'record.update':
      return parse(updateRecordSchema, payload, 'Invalid record.update payload');
    case 'nlp.parse':
      return parse(nlpParseSchema, payload, 'Invalid nlp.parse payload');
    case 'reminder.listPending':
      return parse(z.object({}).strict(), payload ?? {}, 'Invalid reminder.listPending payload');
    case 'reminder.snooze':
      return parse(snoozeReminderSchema, payload, 'Invalid reminder.snooze payload');
  }
}

export function response(requestId: string, data: unknown): string {
  return JSON.stringify({ kind: 'response', requestId, ok: true, data });
}

export function failure(requestId: string, code: string, message: string): string {
  return JSON.stringify({ kind: 'response', requestId, ok: false, error: { code, message } });
}

export function event(name: string, data: unknown): string {
  return JSON.stringify({ kind: 'event', event: name, data });
}
