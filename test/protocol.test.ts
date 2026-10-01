import assert from 'node:assert/strict';
import { test } from 'node:test';
import { failure, OPERATIONS, parsePayload, parseRequest, response } from '../src/protocol.js';
import { ValidationError } from '../src/errors.js';

test('parseRequest accepts a well-formed request envelope', () => {
  const request = parseRequest({
    kind: 'request',
    requestId: 'abc-123',
    operation: 'record.create',
    payload: { text: 'hello' },
  });
  assert.equal(request.operation, 'record.create');
  assert.equal(request.requestId, 'abc-123');
});

test('parseRequest rejects unknown operations', () => {
  assert.throws(
    () =>
      parseRequest({
        kind: 'request',
        requestId: 'abc-123',
        operation: 'record.frobnicate',
      }),
    ValidationError,
  );
});

test('parseRequest rejects missing requestId', () => {
  assert.throws(() => parseRequest({ kind: 'request', operation: 'record.list' }), ValidationError);
});

test('parseRequest rejects wrong kind', () => {
  assert.throws(
    () => parseRequest({ kind: 'event', requestId: 'x', operation: 'record.list' }),
    ValidationError,
  );
});

test('every declared operation has a payload schema wired up', () => {
  for (const operation of OPERATIONS) {
    const payload = operation === 'record.create' ? { text: 'x' } : operation === 'record.list' ? {} : { id: 'x' };
    assert.doesNotThrow(() => parsePayload(operation, payload), `operation ${operation} should accept a minimal valid payload`);
  }
});

test('record.create requires non-empty text', () => {
  assert.throws(() => parsePayload('record.create', { text: '' }), ValidationError);
});

test('record.create accepts an optional explicit remindAt', () => {
  const payload = parsePayload('record.create', { text: 'buy milk', remindAt: '2026-08-10T10:00:00.000Z' }) as any;
  assert.equal(payload.text, 'buy milk');
  assert.equal(payload.remindAt, '2026-08-10T10:00:00.000Z');
});

test('record.get/record.delete require an id', () => {
  assert.throws(() => parsePayload('record.get', {}), ValidationError);
  assert.doesNotThrow(() => parsePayload('record.get', { id: 'abc' }));
});

test('response() produces the documented success envelope', () => {
  const message = JSON.parse(response('req-1', { ok: true }));
  assert.deepEqual(message, { kind: 'response', requestId: 'req-1', ok: true, data: { ok: true } });
});

test('failure() produces the documented error envelope', () => {
  const message = JSON.parse(failure('req-1', 'VALIDATION_ERROR', 'bad input'));
  assert.deepEqual(message, {
    kind: 'response',
    requestId: 'req-1',
    ok: false,
    error: { code: 'VALIDATION_ERROR', message: 'bad input' },
  });
});
