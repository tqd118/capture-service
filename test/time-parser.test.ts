import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDeterministic } from '../src/nlp/deterministic-parser.js';

// Built from local components (not an ISO string with a fixed offset) so this
// test is independent of the machine's timezone, matching how the parser
// itself works entirely in local time via Date#setHours/getHours.
// Monday, 2026-08-10 09:00 local.
const NOW = new Date(2026, 7, 10, 9, 0, 0, 0);

function assertLocal(
  result: Date | null,
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
): void {
  assert.ok(result, 'expected a Date, got null');
  assert.equal(result!.getFullYear(), y);
  assert.equal(result!.getMonth(), mo);
  assert.equal(result!.getDate(), d);
  assert.equal(result!.getHours(), h);
  assert.equal(result!.getMinutes(), mi);
  assert.equal(result!.getSeconds(), 0);
}

// ---------------------------------------------------------------------------
// Family 2: через N часов / минут
// ---------------------------------------------------------------------------

test('resolves "через N часов" to a relative offset', () => {
  const result = parseDeterministic('через 2 часа проверить деплой', NOW);
  assert.ok(result);
  assert.equal(result!.getTime() - NOW.getTime(), 2 * 60 * 60 * 1000);
});

test('resolves "через N час" (singular)', () => {
  const result = parseDeterministic('через 1 час', NOW);
  assert.ok(result);
  assert.equal(result!.getTime() - NOW.getTime(), 60 * 60 * 1000);
});

test('resolves "через N часов" (genitive plural)', () => {
  const result = parseDeterministic('через 5 часов', NOW);
  assert.ok(result);
  assert.equal(result!.getTime() - NOW.getTime(), 5 * 60 * 60 * 1000);
});

test('resolves "через N минут"', () => {
  const result = parseDeterministic('напомни через 45 минут', NOW);
  assert.ok(result);
  assert.equal(result!.getTime() - NOW.getTime(), 45 * 60 * 1000);
});

test('resolves "через N минуты"', () => {
  const result = parseDeterministic('через 2 минуты', NOW);
  assert.ok(result);
  assert.equal(result!.getTime() - NOW.getTime(), 2 * 60 * 1000);
});

test('resolves "через N минуту"', () => {
  const result = parseDeterministic('через 1 минуту', NOW);
  assert.ok(result);
  assert.equal(result!.getTime() - NOW.getTime(), 60 * 1000);
});

// ---------------------------------------------------------------------------
// Family 1: relative day + optional time-of-day
// ---------------------------------------------------------------------------

test('resolves "завтра в 10" to tomorrow at 10:00 local time', () => {
  const result = parseDeterministic('завтра в 10 проверить результаты тестов', NOW);
  assertLocal(result, 2026, 7, 11, 10, 0);
});

test('resolves "завтра в 9:30" with explicit minutes', () => {
  const result = parseDeterministic('завтра в 9:30 звонок', NOW);
  assertLocal(result, 2026, 7, 11, 9, 30);
});

test('resolves "послезавтра в 14"', () => {
  const result = parseDeterministic('послезавтра в 14 собеседование', NOW);
  assertLocal(result, 2026, 7, 12, 14, 0);
});

test('bare "завтра" defaults to 10:00', () => {
  const result = parseDeterministic('завтра надо проверить тесты', NOW);
  assertLocal(result, 2026, 7, 11, 10, 0);
});

test('bare "послезавтра" defaults to 10:00', () => {
  const result = parseDeterministic('послезавтра сдать отчёт', NOW);
  assertLocal(result, 2026, 7, 12, 10, 0);
});

test('"завтра утром" → 09:00', () => {
  assertLocal(parseDeterministic('завтра утром пробежка', NOW), 2026, 7, 11, 9, 0);
});

test('"завтра в обед" → 13:00', () => {
  assertLocal(parseDeterministic('завтра в обед созвон', NOW), 2026, 7, 11, 13, 0);
});

test('"завтра вечером" → 19:00', () => {
  assertLocal(parseDeterministic('завтра вечером кино', NOW), 2026, 7, 11, 19, 0);
});

test('"послезавтра утром"', () => {
  assertLocal(parseDeterministic('послезавтра утром', NOW), 2026, 7, 12, 9, 0);
});

test('"через 3 дня" defaults to 10:00 on that calendar day', () => {
  assertLocal(parseDeterministic('через 3 дня проверить', NOW), 2026, 7, 13, 10, 0);
});

test('"через 2 дня вечером"', () => {
  assertLocal(parseDeterministic('через 2 дня вечером', NOW), 2026, 7, 12, 19, 0);
});

test('"через 1 день в 15:30"', () => {
  assertLocal(parseDeterministic('через 1 день в 15:30', NOW), 2026, 7, 11, 15, 30);
});

test('"завтра в 3 вечера" → 15:00 (12h with вечера)', () => {
  assertLocal(parseDeterministic('завтра в 3 вечера', NOW), 2026, 7, 11, 15, 0);
});

test('"завтра в 3 утра" → 03:00', () => {
  assertLocal(parseDeterministic('завтра в 3 утра', NOW), 2026, 7, 11, 3, 0);
});

test('"завтра в 11 вечера" → 23:00', () => {
  assertLocal(parseDeterministic('завтра в 11 вечера', NOW), 2026, 7, 11, 23, 0);
});

test('"завтра в 12 вечера" → 00:00', () => {
  assertLocal(parseDeterministic('завтра в 12 вечера', NOW), 2026, 7, 11, 0, 0);
});

test('"завтра в 12 утра" → 00:00', () => {
  assertLocal(parseDeterministic('завтра в 12 утра', NOW), 2026, 7, 11, 0, 0);
});

test('"завтра в 15" bare 13–23 is 24h', () => {
  assertLocal(parseDeterministic('завтра в 15', NOW), 2026, 7, 11, 15, 0);
});

test('"завтра в 15:30"', () => {
  assertLocal(parseDeterministic('завтра в 15:30', NOW), 2026, 7, 11, 15, 30);
});

test('"сегодня в HH" that already passed is ambiguous, not guessed forward', () => {
  // NOW is 09:00, so "сегодня в 8" already happened today.
  const result = parseDeterministic('сегодня в 8 забыл отправить письмо', NOW);
  assert.equal(result, null);
});

test('"сегодня в HH" still ahead today resolves normally', () => {
  assertLocal(parseDeterministic('сегодня в 18 забрать посылку', NOW), 2026, 7, 10, 18, 0);
});

test('"сегодня утром" at 09:00 is already past → null', () => {
  assert.equal(parseDeterministic('сегодня утром', NOW), null);
});

test('"сегодня вечером" still ahead', () => {
  assertLocal(parseDeterministic('сегодня вечером', NOW), 2026, 7, 10, 19, 0);
});

test('bare "сегодня" without time → null (no default)', () => {
  assert.equal(parseDeterministic('сегодня надо вспомнить', NOW), null);
});

test('invalid hour in explicit expression is rejected, not clamped', () => {
  assert.equal(parseDeterministic('завтра в 27 это бред', NOW), null);
});

test('invalid minutes rejected', () => {
  assert.equal(parseDeterministic('завтра в 10:99', NOW), null);
});

// ---------------------------------------------------------------------------
// Family 3: в <день недели>
// ---------------------------------------------------------------------------

test('"в пятницу" from Monday → this Friday 10:00', () => {
  // NOW = Mon 2026-08-10 → Fri 2026-08-14
  assertLocal(parseDeterministic('в пятницу созвон', NOW), 2026, 7, 14, 10, 0);
});

test('"в пт вечером"', () => {
  assertLocal(parseDeterministic('в пт вечером', NOW), 2026, 7, 14, 19, 0);
});

test('"в понедельник" from Monday 09:00 with default 10:00 → today 10:00', () => {
  assertLocal(parseDeterministic('в понедельник проверить', NOW), 2026, 7, 10, 10, 0);
});

test('"в понедельник в 8" from Monday 09:00 → next Monday 08:00 (past today)', () => {
  assertLocal(parseDeterministic('в понедельник в 8', NOW), 2026, 7, 17, 8, 0);
});

test('"во вторник в 15"', () => {
  assertLocal(parseDeterministic('во вторник в 15', NOW), 2026, 7, 11, 15, 0);
});

test('"в среду утром"', () => {
  assertLocal(parseDeterministic('в среду утром', NOW), 2026, 7, 12, 9, 0);
});

test('"в сб" short form', () => {
  assertLocal(parseDeterministic('в сб', NOW), 2026, 7, 15, 10, 0);
});

test('"в воскресенье в 12:00"', () => {
  assertLocal(parseDeterministic('в воскресенье в 12:00', NOW), 2026, 7, 16, 12, 0);
});

test('"в чт в 3 вечера"', () => {
  assertLocal(parseDeterministic('в чт в 3 вечера', NOW), 2026, 7, 13, 15, 0);
});

// ---------------------------------------------------------------------------
// Family 4: day-of-month
// ---------------------------------------------------------------------------

test('"15-го" from Aug 10 → Aug 15 10:00', () => {
  assertLocal(parseDeterministic('15-го сдать отчёт', NOW), 2026, 7, 15, 10, 0);
});

test('"15-е вечером"', () => {
  assertLocal(parseDeterministic('15-е вечером', NOW), 2026, 7, 15, 19, 0);
});

test('"15 числа в 14:00"', () => {
  assertLocal(parseDeterministic('15 числа в 14:00', NOW), 2026, 7, 15, 14, 0);
});

test('"5-го" already past this month from Aug 10 → next month Sep 5 10:00', () => {
  assertLocal(parseDeterministic('5-го оплатить', NOW), 2026, 8, 5, 10, 0);
});

test('"10-го в 8" same day but time past → next month', () => {
  // NOW = Aug 10 09:00; 10-го в 8 already past today
  assertLocal(parseDeterministic('10-го в 8', NOW), 2026, 8, 10, 8, 0);
});

test('"10-го в 18" same day still ahead', () => {
  assertLocal(parseDeterministic('10-го в 18', NOW), 2026, 7, 10, 18, 0);
});

test('"31-го" from Aug 10 → Aug 31 10:00', () => {
  assertLocal(parseDeterministic('31-го', NOW), 2026, 7, 31, 10, 0);
});

test('"31-го" from Jan 15 when next month is February → null if Feb has no 31', () => {
  // Jan 15 2026; 31 this month still ahead → Jan 31
  const jan = new Date(2026, 0, 15, 12, 0, 0, 0);
  assertLocal(parseDeterministic('31-го', jan), 2026, 0, 31, 10, 0);
});

test('"31-го" from Jan 31 12:00 past default → Feb has no 31 → null', () => {
  const jan31 = new Date(2026, 0, 31, 12, 0, 0, 0);
  assert.equal(parseDeterministic('31-го', jan31), null);
});

// ---------------------------------------------------------------------------
// No match → null
// ---------------------------------------------------------------------------

test('vague time-of-day words alone are never guessed', () => {
  assert.equal(parseDeterministic('надо сделать это вечером', NOW), null);
});

test('утром alone → null', () => {
  assert.equal(parseDeterministic('утром сделать зарядку', NOW), null);
});

test('plain thought with no time expression at all', () => {
  assert.equal(
    parseDeterministic('мне пришла в голову странная идея насчёт Quickshell', NOW),
    null,
  );
});

test('bare number without ordinal marker is not a day-of-month', () => {
  assert.equal(parseDeterministic('купить 15 яблок', NOW), null);
});

test('flexible spacing and case: "Завтра  В  10"', () => {
  assertLocal(parseDeterministic('Завтра  В  10 проверить', NOW), 2026, 7, 11, 10, 0);
});

test('flexible case: "ЧЕРЕЗ 2 ЧАСА"', () => {
  const result = parseDeterministic('ЧЕРЕЗ 2 ЧАСА', NOW);
  assert.ok(result);
  assert.equal(result!.getTime() - NOW.getTime(), 2 * 60 * 60 * 1000);
});

test('zero amount rejected', () => {
  assert.equal(parseDeterministic('через 0 минут', NOW), null);
});
