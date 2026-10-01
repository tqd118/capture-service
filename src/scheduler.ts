import { DomainEvents } from './events.js';
import { logger } from './logger.js';
import { notify } from './notifier.js';
import type { RecordService } from './record-service.js';

/**
 * Deterministic reminder scheduler.
 *
 * Mirrors the legacy notes-service scheduler shape: at most one active
 * timer, always pointed at the single nearest pending reminder, rebuilt
 * after every mutation and at startup. No polling.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly records: RecordService,
    private readonly events: DomainEvents,
  ) {
    this.events.on('record.created', () => this.reschedule());
    this.events.on('record.updated', () => this.reschedule());
    this.events.on('record.deleted', () => this.reschedule());
  }

  start(): void {
    this.reschedule();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private reschedule(): void {
    this.stop();

    const next = this.records.findNextPendingReminder();
    if (!next || !next.remindAt) return;

    const dueInMs = Math.max(0, new Date(next.remindAt).getTime() - Date.now());
    if (dueInMs === 0) {
      logger.medium(`Record ${next.id} reminder was already due (missed while offline); firing now.`);
    }

    this.timer = setTimeout(() => this.fire(next.id), dueInMs);
  }

  private fire(id: string): void {
    let record;
    try {
      record = this.records.markReminded(id);
    } catch (error) {
      logger.high(`Failed to mark record ${id} as reminded: ${(error as Error).message}`);
      this.reschedule();
      return;
    }

    logger.low(`Firing reminder for record ${id}`);
    this.events.emitEvent('record.reminded', { type: 'record.reminded', record });
    notify(record);
    this.reschedule();
  }
}
