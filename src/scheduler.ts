import { DomainEvents } from './events.js';
import { logger } from './logger.js';
import { notify } from './notifier.js';
import type { RecordService } from './record-service.js';

/**
 * Node's setTimeout delay is a signed 32-bit int (~24.9 days). Values above
 * 2^31-1 wrap / fire immediately, which would permanently markReminded a
 * far-future reminder. Cap each timer to a 24h chunk and re-check on fire.
 */
export const MAX_TIMER_MS = 24 * 60 * 60 * 1000;

/** Clamp a due-in delay to [0, MAX_TIMER_MS] for safe setTimeout use. */
export function clampTimerDelay(dueInMs: number): number {
  if (!Number.isFinite(dueInMs) || dueInMs <= 0) return 0;
  return Math.min(dueInMs, MAX_TIMER_MS);
}

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

    const delay = clampTimerDelay(dueInMs);
    this.timer = setTimeout(() => this.fire(next.id), delay);
  }

  private fire(id: string): void {
    let record;
    try {
      record = this.records.get(id);
    } catch (error) {
      logger.high(`Failed to load record ${id} for reminder: ${(error as Error).message}`);
      this.reschedule();
      return;
    }

    // No longer a pending reminder (deleted fields / already fired / cleared).
    if (!record.remindAt || record.remindedAt || record.doneAt || record.archivedAt) {
      this.reschedule();
      return;
    }

    const dueInMs = new Date(record.remindAt).getTime() - Date.now();
    if (dueInMs > 0) {
      // Chunked timer woke early — remindAt still in the future. Do NOT
      // markReminded; just point the timer at the next safe chunk.
      logger.low(`Record ${id} reminder chunk elapsed; still due in ${dueInMs}ms — rescheduling.`);
      this.reschedule();
      return;
    }

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
