import type { SnoozePreset } from './types.js';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const TOMORROW_HOUR = 10;

/**
 * Resolve a snooze preset to an absolute Date.
 *
 * - `15m` / `1h`: offset from `now`
 * - `tomorrow`: next calendar day at 10:00 in the system local timezone
 *   (Europe/Minsk on the target host), matching the deterministic parser's
 *   default day-only clock.
 */
export function computeSnoozeRemindAt(preset: SnoozePreset, now: Date = new Date()): Date {
  if (preset === '15m') return new Date(now.getTime() + 15 * MINUTE_MS);
  if (preset === '1h') return new Date(now.getTime() + HOUR_MS);

  const next = new Date(now.getTime());
  next.setDate(next.getDate() + 1);
  next.setHours(TOMORROW_HOUR, 0, 0, 0);
  return next;
}
