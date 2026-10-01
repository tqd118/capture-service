import type { TimeParser } from './types.js';

/**
 * Deterministic, rule-based Russian time parser.
 *
 * Only extracts timestamps for an explicit, low-ambiguity set of Russian
 * time expressions. Everything else is left unresolved on purpose
 * (manifesto: never guess).
 *
 * Default times when a day is given without a clock time:
 *   day only (завтра / в пятницу / 15-е / через N дней) → 10:00 local
 *   утром  → 09:00
 *   в обед → 13:00
 *   вечером → 19:00
 *
 * Clock-time rules (`в HH[:MM]` [утра|вечера]):
 *   - Without утра/вечера: HH is 24-hour (0–23). Existing phrases like
 *     «завтра в 10» keep meaning 10:00.
 *   - With «утра»: hour 1–11 → that AM hour; 12 → 00:00.
 *   - With «вечера»: hour 1–11 → hour+12; 12 → 00:00 (midnight).
 *   - Hour 0 with утра/вечера is rejected (nonsensical).
 *
 * Timezone: system local (Europe/Minsk on the target machine), via Date
 * local getters/setters — same as the rest of the service.
 */

// Note: `\b` is ASCII-only in JS regexes and does not recognize Cyrillic
// letters as "word" characters, so plain whitespace/punctuation boundaries
// are relied on instead where needed.

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const DEFAULT_DAY_HOUR = 10;
const MORNING_HOUR = 9;
const MIDDAY_HOUR = 13;
const EVENING_HOUR = 19;

/** Relative offset: через N минут/часов (days handled separately as calendar). */
const RELATIVE_HM_RE =
  /через\s+(\d{1,3})\s*(минут[уы]?|мин\.?|час(?:а|ов)?|ч\.?)(?![а-яё])/iu;

/** через N дней / дня / день — calendar day offset, optional time-of-day after. */
const RELATIVE_DAYS_RE =
  /через\s+(\d{1,3})\s*(?:дней|дня|день|дн\.?)(?![а-яё])/iu;

const DAY_AFTER_TOMORROW_RE = /послезавтра(?![а-яё])/iu;
const TOMORROW_RE = /завтра(?![а-яё])/iu;
const TODAY_RE = /сегодня(?![а-яё])/iu;

/**
 * Weekday after «в» / «во». Accusative forms used in speech
 * (в среду, в пятницу, в субботу); nominative accepted too.
 */
const WEEKDAY_RE =
  /во?\s+(понедельник|пн|вторник|вт|среду|среда|ср|четверг|чт|пятницу|пятница|пт|субботу|суббота|сб|воскресенье|вс)(?![а-яё])/iu;

const WEEKDAY_INDEX: Record<string, number> = {
  понедельник: 1,
  пн: 1,
  вторник: 2,
  вт: 2,
  среду: 3,
  среда: 3,
  ср: 3,
  четверг: 4,
  чт: 4,
  пятницу: 5,
  пятница: 5,
  пт: 5,
  субботу: 6,
  суббота: 6,
  сб: 6,
  воскресенье: 0,
  вс: 0,
};

/** Day-of-month: 15-го / 15-е / 15-ё / 15 числа (bare digits alone are too ambiguous). */
const DOM_RE = /(?<!\d)([1-9]|[12]\d|3[01])(?:-го|-е|-ё|\s+числа)(?!\d)/iu;

/** Time-of-day fragment (optional leading whitespace stripped by caller). */
const TOD_NAMED_RE = /^(?:утром|вечером|в\s+обед)(?![а-яё])/iu;
const TOD_CLOCK_RE =
  /^в\s+(\d{1,2})(?::(\d{2}))?(?!\d)(?:\s*(утра|вечера)(?![а-яё]))?/iu;

export class DeterministicTimeParser implements TimeParser {
  readonly name = 'deterministic';

  async parseTimeExpression(text: string, now: Date): Promise<Date | null> {
    return parseDeterministic(text, now);
  }
}

export function parseDeterministic(text: string, now: Date): Date | null {
  // 1) Relative hours / minutes — pure offset from now.
  const relativeHm = RELATIVE_HM_RE.exec(text);
  if (relativeHm) {
    const amount = Number(relativeHm[1]);
    const unit = relativeHm[2]!.toLowerCase();
    if (Number.isFinite(amount) && amount > 0) {
      const offsetMs = resolveHmUnitMs(unit, amount);
      if (offsetMs !== null) return new Date(now.getTime() + offsetMs);
    }
  }

  // 2) через N дней (+ optional time-of-day elsewhere / after).
  const relativeDays = RELATIVE_DAYS_RE.exec(text);
  if (relativeDays) {
    const amount = Number(relativeDays[1]);
    if (Number.isFinite(amount) && amount > 0) {
      const tod = findTimeOfDay(text, relativeDays.index + relativeDays[0].length);
      if (tod === 'invalid') return null;
      const { hour, minute } = tod ?? { hour: DEFAULT_DAY_HOUR, minute: 0 };
      return atDayOffset(now, amount, hour, minute);
    }
  }

  // 3) послезавтра / завтра / сегодня — today requires an explicit TOD
  //    (bare «сегодня» is ambiguous; bare «завтра» defaults to 10:00).
  const dayAfter = DAY_AFTER_TOMORROW_RE.exec(text);
  if (dayAfter) {
    return resolveAnchoredDay(text, now, 2, dayAfter.index + dayAfter[0].length, true);
  }

  const tomorrow = TOMORROW_RE.exec(text);
  if (tomorrow) {
    // Guard: «послезавтра» already handled; plain «завтра» substring of it
    // cannot appear here because послезавтра was tried first. Still skip if
    // the match is the «завтра» inside «послезавтра» (already consumed).
    return resolveAnchoredDay(text, now, 1, tomorrow.index + tomorrow[0].length, true);
  }

  const today = TODAY_RE.exec(text);
  if (today) {
    // сегодня alone → null; must have TOD, and must still be ahead.
    const resolved = resolveAnchoredDay(text, now, 0, today.index + today[0].length, false);
    if (resolved && resolved.getTime() <= now.getTime()) return null;
    return resolved;
  }

  // 4) в <weekday>
  const weekday = WEEKDAY_RE.exec(text);
  if (weekday) {
    const key = weekday[1]!.toLowerCase();
    const dow = WEEKDAY_INDEX[key];
    if (dow === undefined) return null;
    const tod = findTimeOfDay(text, weekday.index + weekday[0].length);
    if (tod === 'invalid') return null;
    const { hour, minute } = tod ?? { hour: DEFAULT_DAY_HOUR, minute: 0 };
    return nextWeekday(now, dow, hour, minute);
  }

  // 5) Day-of-month (15-го / 15-е / 15 числа)
  const dom = DOM_RE.exec(text);
  if (dom) {
    const day = Number(dom[1]);
    if (!Number.isInteger(day) || day < 1 || day > 31) return null;
    const tod = findTimeOfDay(text, dom.index + dom[0].length);
    if (tod === 'invalid') return null;
    const { hour, minute } = tod ?? { hour: DEFAULT_DAY_HOUR, minute: 0 };
    return nextDayOfMonth(now, day, hour, minute);
  }

  return null;
}

function resolveAnchoredDay(
  text: string,
  now: Date,
  dayOffset: number,
  searchFrom: number,
  allowDefaultTime: boolean,
): Date | null {
  const tod = findTimeOfDay(text, searchFrom);
  if (tod === 'invalid') return null;
  if (tod === null && !allowDefaultTime) return null;
  const { hour, minute } = tod ?? { hour: DEFAULT_DAY_HOUR, minute: 0 };
  return atDayOffset(now, dayOffset, hour, minute);
}

/**
 * Look for a time-of-day right after `from`, or (if none) anywhere later in
 * the string after skipping intervening non-TOD words carefully: we only
 * accept TOD that starts at `from` after optional whitespace, OR after a
 * short run of whitespace-separated tokens that are not themselves another
 * day-anchor. For simplicity and no-guessing: only match TOD that appears
 * immediately after optional whitespace at `from`, OR a single TOD scan of
 * the remainder that starts with whitespace + TOD keyword/clock.
 *
 * Returns:
 *   {hour, minute} — explicit TOD
 *   null           — no TOD found (caller may apply default)
 *   'invalid'      — TOD present but malformed (e.g. в 27)
 */
function findTimeOfDay(
  text: string,
  from: number,
): { hour: number; minute: number } | null | 'invalid' {
  const rest = text.slice(from);
  const trimmedStart = rest.match(/^\s*/)?.[0].length ?? 0;
  const slice = rest.slice(trimmedStart);
  if (!slice) return null;

  const named = TOD_NAMED_RE.exec(slice);
  if (named) {
    const word = named[0].toLowerCase().replace(/\s+/g, ' ');
    if (word === 'утром') return { hour: MORNING_HOUR, minute: 0 };
    if (word === 'вечером') return { hour: EVENING_HOUR, minute: 0 };
    if (word === 'в обед') return { hour: MIDDAY_HOUR, minute: 0 };
  }

  const clock = TOD_CLOCK_RE.exec(slice);
  if (clock) {
    const parsed = resolveClockHour(clock[1]!, clock[2], clock[3]);
    return parsed === null ? 'invalid' : parsed;
  }

  return null;
}

function resolveClockHour(
  hourStr: string,
  minuteStr: string | undefined,
  meridiem: string | undefined,
): { hour: number; minute: number } | null {
  let hour = Number(hourStr);
  const minute = minuteStr ? Number(minuteStr) : 0;
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (minute < 0 || minute > 59) return null;

  const m = meridiem?.toLowerCase();
  if (m === 'утра') {
    if (hour < 1 || hour > 12) return null;
    if (hour === 12) hour = 0;
    // 1–11 stay as-is
  } else if (m === 'вечера') {
    if (hour < 1 || hour > 12) return null;
    if (hour === 12) hour = 0;
    else hour = hour + 12;
  } else {
    // 24-hour clock, no marker
    if (hour < 0 || hour > 23) return null;
  }

  return { hour, minute };
}

function resolveHmUnitMs(unit: string, amount: number): number | null {
  if (unit.startsWith('мин')) return amount * MINUTE_MS;
  if (unit.startsWith('час') || unit === 'ч' || unit.startsWith('ч.')) return amount * HOUR_MS;
  return null;
}

function atDayOffset(now: Date, dayOffset: number, hour: number, minute: number): Date {
  const result = new Date(now);
  result.setDate(result.getDate() + dayOffset);
  result.setHours(hour, minute, 0, 0);
  return result;
}

function nextWeekday(now: Date, targetDow: number, hour: number, minute: number): Date {
  const result = new Date(now);
  const current = now.getDay();
  let delta = (targetDow - current + 7) % 7;
  result.setDate(result.getDate() + delta);
  result.setHours(hour, minute, 0, 0);
  // Same calendar day but time already passed → next week.
  if (result.getTime() <= now.getTime()) {
    result.setDate(result.getDate() + 7);
  }
  return result;
}

function nextDayOfMonth(now: Date, day: number, hour: number, minute: number): Date | null {
  // Try this month; if that date is invalid (e.g. 31 in February) or already
  // past (including same day with time passed), roll to next month. Cap at
  // one month ahead — if next month also lacks that day, reject (no guessing).
  const attempt = (year: number, month: number): Date | null => {
    // month is 0-based. Construct and verify the day didn't overflow.
    const d = new Date(year, month, day, hour, minute, 0, 0);
    if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) {
      return null;
    }
    return d;
  };

  const y = now.getFullYear();
  const m = now.getMonth();
  const thisMonth = attempt(y, m);
  if (thisMonth && thisMonth.getTime() > now.getTime()) return thisMonth;

  const nextMonth = m === 11 ? attempt(y + 1, 0) : attempt(y, m + 1);
  if (nextMonth && nextMonth.getTime() > now.getTime()) return nextMonth;

  return null;
}
