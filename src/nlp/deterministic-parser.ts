import type { TimeParser } from './types.js';

// Note: `\b` is ASCII-only in JS regexes and does not recognize Cyrillic
// letters as "word" characters, so plain whitespace/punctuation boundaries
// are relied on instead.
const RELATIVE_RE = /через\s+(\d{1,3})\s*(минут[уы]?|мин\.?|час(?:а|ов)?|ч\.?|д(?:ня|ней|ень)?|дн\.?)(?![а-яё])/iu;
const TODAY_AT_RE = /сегодня\s+в\s+(\d{1,2})(?::(\d{2}))?(?!\d)/iu;
const TOMORROW_AT_RE = /завтра\s+в\s+(\d{1,2})(?::(\d{2}))?(?!\d)/iu;
const DAY_AFTER_TOMORROW_AT_RE = /послезавтра\s+в\s+(\d{1,2})(?::(\d{2}))?(?!\d)/iu;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Deterministic, rule-based time parser.
 *
 * Only extracts timestamps for a short, explicit, low-ambiguity set of
 * Russian time expressions. Everything else is left unresolved on purpose
 * (manifesto rule #6: never guess).
 */
export class DeterministicTimeParser implements TimeParser {
  readonly name = 'deterministic';

  async parseTimeExpression(text: string, now: Date): Promise<Date | null> {
    return parseDeterministic(text, now);
  }
}

export function parseDeterministic(text: string, now: Date): Date | null {
  const relative = RELATIVE_RE.exec(text);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2]!.toLowerCase();
    if (Number.isFinite(amount) && amount > 0) {
      const offsetMs = resolveUnitMs(unit, amount);
      if (offsetMs !== null) return new Date(now.getTime() + offsetMs);
    }
  }

  const dayAfterTomorrow = DAY_AFTER_TOMORROW_AT_RE.exec(text);
  if (dayAfterTomorrow?.[1]) return resolveAtTime(now, 2, dayAfterTomorrow[1], dayAfterTomorrow[2]);

  const tomorrow = TOMORROW_AT_RE.exec(text);
  if (tomorrow?.[1]) return resolveAtTime(now, 1, tomorrow[1], tomorrow[2]);

  const today = TODAY_AT_RE.exec(text);
  if (today?.[1]) {
    const candidate = resolveAtTime(now, 0, today[1], today[2]);
    // "today at HH" that has already passed is ambiguous: do not guess
    // "tomorrow" on the user's behalf — just leave it as a plain thought.
    if (candidate && candidate.getTime() <= now.getTime()) return null;
    return candidate;
  }

  return null;
}

function resolveUnitMs(unit: string, amount: number): number | null {
  if (unit.startsWith('мин')) return amount * MINUTE_MS;
  if (unit.startsWith('час') || unit.startsWith('ч')) return amount * HOUR_MS;
  if (unit.startsWith('д')) return amount * DAY_MS;
  return null;
}

function resolveAtTime(now: Date, dayOffset: number, hourStr: string, minuteStr: string | undefined): Date | null {
  const hour = Number(hourStr);
  const minute = minuteStr ? Number(minuteStr) : 0;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;

  const result = new Date(now);
  result.setDate(result.getDate() + dayOffset);
  result.setHours(hour, minute, 0, 0);
  return result;
}
