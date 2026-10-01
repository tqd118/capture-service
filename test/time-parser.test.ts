import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDeterministic } from '../src/nlp/deterministic-parser.js';

// Built from local components (not an ISO string with a fixed offset) so this
// test is independent of the machine's timezone, matching how the parser
// itself works entirely in local time via Date#setHours/getHours.
const NOW = new Date(2026, 7, 10, 9, 0, 0, 0);

test('resolves "через N часов" to a relative offset', () => {
  const result = parseDeterministic('через 2 часа проверить деплой', NOW);
  assert.ok(result);
  assert.equal(result!.getTime() - NOW.getTime(), 2 * 60 * 60 * 1000);
});

test('resolves "через N минут"', () => {
  const result = parseDeterministic('напомни через 45 минут', NOW);
  assert.ok(result);
  assert.equal(result!.getTime() - NOW.getTime(), 45 * 60 * 1000);
});

test('resolves "завтра в 10" to tomorrow at 10:00 local time', () => {
  const result = parseDeterministic('завтра в 10 проверить результаты тестов', NOW);
  assert.ok(result);
  assert.equal(result!.getHours(), 10);
  assert.equal(result!.getMinutes(), 0);
  assert.equal(result!.getDate(), NOW.getDate() + 1);
});

test('resolves "завтра в 9:30" with explicit minutes', () => {
  const result = parseDeterministic('завтра в 9:30 звонок', NOW);
  assert.ok(result);
  assert.equal(result!.getHours(), 9);
  assert.equal(result!.getMinutes(), 30);
});

test('resolves "послезавтра в 14"', () => {
  const result = parseDeterministic('послезавтра в 14 собеседование', NOW);
  assert.ok(result);
  assert.equal(result!.getHours(), 14);
  assert.equal(result!.getDate(), NOW.getDate() + 2);
});

test('"сегодня в HH" that already passed is ambiguous, not guessed forward', () => {
  // NOW is 09:00, so "сегодня в 8" already happened today.
  const result = parseDeterministic('сегодня в 8 забыл отправить письмо', NOW);
  assert.equal(result, null);
});

test('"сегодня в HH" still ahead today resolves normally', () => {
  const result = parseDeterministic('сегодня в 18 забрать посылку', NOW);
  assert.ok(result);
  assert.equal(result!.getHours(), 18);
  assert.equal(result!.getDate(), NOW.getDate());
});

test('plain "завтра" without explicit time is ambiguous (no remindAt)', () => {
  const result = parseDeterministic('завтра надо проверить тесты', NOW);
  assert.equal(result, null);
});

test('vague time-of-day words are never guessed (manifesto example)', () => {
  const result = parseDeterministic('надо сделать это вечером', NOW);
  assert.equal(result, null);
});

test('plain thought with no time expression at all', () => {
  const result = parseDeterministic('мне пришла в голову странная идея насчёт Quickshell', NOW);
  assert.equal(result, null);
});

test('invalid hour in explicit expression is rejected, not clamped', () => {
  const result = parseDeterministic('завтра в 27 это бред', NOW);
  assert.equal(result, null);
});
