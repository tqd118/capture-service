import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { config } from './config.js';
import { DomainEvents } from './events.js';
import { NotFoundError, ValidationError } from './errors.js';
import { logger } from './logger.js';
import type { TimeParser } from './nlp/index.js';
import type { Record, RecordListFilters } from './types.js';

interface RecordRow {
  id: string;
  text: string;
  createdAt: string;
  remindAt: string | null;
  doneAt: string | null;
  archivedAt: string | null;
  remindedAt: string | null;
}

function rowToRecord(row: RecordRow): Record {
  return { ...row };
}

export interface CreateRecordInput {
  text: string;
  remindAt?: string | null;
}

export interface UpdateRecordInput {
  text?: string;
  remindAt?: string | null;
  doneAt?: string | null;
  archivedAt?: string | null;
}

export class RecordService {
  constructor(
    private readonly db: Database,
    private readonly events: DomainEvents,
    private readonly timeParser: TimeParser,
  ) {}

  async create(input: CreateRecordInput): Promise<Record> {
    const text = input.text.trim();
    if (!text) throw new ValidationError('text must not be empty');
    if (text.length > config.limits.text) {
      throw new ValidationError(`text exceeds maximum length of ${config.limits.text} characters`);
    }

    let remindAt: string | null = null;
    if (input.remindAt !== undefined && input.remindAt !== null) {
      // Client already resolved an explicit ISO timestamp — trust it as-is,
      // no NLP guessing needed.
      remindAt = input.remindAt;
    } else {
      const parsed = await this.safeParseTime(text);
      remindAt = parsed ? parsed.toISOString() : null;
    }

    const now = new Date().toISOString();
    const record: Record = {
      id: crypto.randomUUID(),
      text,
      createdAt: now,
      remindAt,
      doneAt: null,
      archivedAt: null,
      remindedAt: null,
    };

    this.db
      .prepare(
        `INSERT INTO records (id, text, createdAt, remindAt, doneAt, archivedAt, remindedAt)
         VALUES (@id, @text, @createdAt, @remindAt, @doneAt, @archivedAt, @remindedAt)`,
      )
      .run(record);

    logger.low(`Created record ${record.id}${record.remindAt ? ` with remindAt=${record.remindAt}` : ''}`);
    this.events.emitEvent('record.created', { type: 'record.created', record });
    return record;
  }

  list(filters: RecordListFilters = {}): Record[] {
    const clauses: string[] = [];
    if (!filters.includeArchived) clauses.push('archivedAt IS NULL');
    if (!filters.includeDone) clauses.push('doneAt IS NULL');
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM records ${where} ORDER BY createdAt DESC`).all() as RecordRow[];
    return rows.map(rowToRecord);
  }

  get(id: string): Record {
    const row = this.db.prepare('SELECT * FROM records WHERE id = ?').get(id) as RecordRow | undefined;
    if (!row) throw new NotFoundError(id);
    return rowToRecord(row);
  }

  update(id: string, patch: UpdateRecordInput): Record {
    const existing = this.get(id);

    const next: Record = { ...existing };
    if (patch.text !== undefined) {
      const text = patch.text.trim();
      if (!text) throw new ValidationError('text must not be empty');
      if (text.length > config.limits.text) {
        throw new ValidationError(`text exceeds maximum length of ${config.limits.text} characters`);
      }
      next.text = text;
    }
    if (patch.remindAt !== undefined) {
      next.remindAt = patch.remindAt;
      // Changing the reminder time invalidates any previous "already fired" state.
      next.remindedAt = null;
    }
    if (patch.doneAt !== undefined) next.doneAt = patch.doneAt;
    if (patch.archivedAt !== undefined) next.archivedAt = patch.archivedAt;

    this.db
      .prepare(
        `UPDATE records SET text = @text, remindAt = @remindAt, doneAt = @doneAt,
         archivedAt = @archivedAt, remindedAt = @remindedAt WHERE id = @id`,
      )
      .run(next);

    logger.low(`Updated record ${id}`);
    this.events.emitEvent('record.updated', { type: 'record.updated', record: next });
    return next;
  }

  markDone(id: string): Record {
    const existing = this.get(id);
    return this.update(id, { doneAt: existing.doneAt ?? new Date().toISOString() });
  }

  archive(id: string): Record {
    const existing = this.get(id);
    return this.update(id, { archivedAt: existing.archivedAt ?? new Date().toISOString() });
  }

  delete(id: string): void {
    this.get(id);
    this.db.prepare('DELETE FROM records WHERE id = ?').run(id);
    logger.medium(`Deleted record ${id}`);
    this.events.emitEvent('record.deleted', { type: 'record.deleted', id });
  }

  /** Nearest active record with a pending reminder, or null if none exist. */
  findNextPendingReminder(): Record | null {
    const row = this.db
      .prepare(
        `SELECT * FROM records
         WHERE remindAt IS NOT NULL AND remindedAt IS NULL
           AND doneAt IS NULL AND archivedAt IS NULL
         ORDER BY remindAt ASC LIMIT 1`,
      )
      .get() as RecordRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  markReminded(id: string): Record {
    const existing = this.get(id);
    const next: Record = { ...existing, remindedAt: new Date().toISOString() };
    this.db.prepare('UPDATE records SET remindedAt = @remindedAt WHERE id = @id').run(next);
    return next;
  }


  /** Preview-only parse: same NLP path as create, no DB write. */
  async parsePreview(text: string): Promise<{ remindAt: string | null }> {
    const trimmed = text.trim();
    if (!trimmed) return { remindAt: null };
    if (trimmed.length > config.limits.text) {
      throw new ValidationError(`text exceeds maximum length of ${config.limits.text} characters`);
    }
    const parsed = await this.safeParseTime(trimmed);
    return { remindAt: parsed ? parsed.toISOString() : null };
  }

  private async safeParseTime(text: string): Promise<Date | null> {
    try {
      return await this.timeParser.parseTimeExpression(text, new Date());
    } catch (error) {
      logger.medium(`Time parser (${this.timeParser.name}) failed, treating as plain thought: ${(error as Error).message}`);
      return null;
    }
  }
}
