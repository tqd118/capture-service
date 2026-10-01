import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { DomainEvents } from '../src/events.js';
import { NotFoundError } from '../src/errors.js';
import { clampTimerDelay, MAX_TIMER_MS, Scheduler } from '../src/scheduler.js';
import type { Record } from '../src/types.js';
import type { RecordService } from '../src/record-service.js';

process.env.CAPTURE_NOTIFY_DISABLE = '1';

function makeRecord(overrides: Partial<Record> = {}): Record {
  return {
    id: 'rec-1',
    text: 'test reminder',
    createdAt: new Date().toISOString(),
    remindAt: null,
    doneAt: null,
    archivedAt: null,
    remindedAt: null,
    ...overrides,
  };
}

function makeFakeRecords(initial: Record | null): {
  records: Pick<RecordService, 'findNextPendingReminder' | 'get' | 'markReminded'>;
  marked: string[];
  setNext(next: Record | null): void;
} {
  let next = initial;
  const store = new Map<string, Record>();
  if (initial) store.set(initial.id, { ...initial });
  const marked: string[] = [];

  return {
    marked,
    setNext(r) {
      next = r;
      if (r) store.set(r.id, { ...r });
    },
    records: {
      findNextPendingReminder() {
        return next && next.remindAt && !next.remindedAt && !next.doneAt && !next.archivedAt
          ? { ...next }
          : null;
      },
      get(id: string) {
        const r = store.get(id);
        if (!r) throw new NotFoundError(id);
        return { ...r };
      },
      markReminded(id: string) {
        const r = store.get(id);
        if (!r) throw new NotFoundError(id);
        const updated = { ...r, remindedAt: new Date().toISOString() };
        store.set(id, updated);
        if (next?.id === id) next = updated;
        marked.push(id);
        return { ...updated };
      },
    },
  };
}

test('clampTimerDelay keeps short delays unchanged', () => {
  assert.equal(clampTimerDelay(0), 0);
  assert.equal(clampTimerDelay(-100), 0);
  assert.equal(clampTimerDelay(5_000), 5_000);
  assert.equal(clampTimerDelay(MAX_TIMER_MS), MAX_TIMER_MS);
});

test('clampTimerDelay caps values above 24h (and above 2^31-1)', () => {
  const overflow = 2_147_483_647 + 1;
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  assert.equal(clampTimerDelay(overflow), MAX_TIMER_MS);
  assert.equal(clampTimerDelay(thirtyDays), MAX_TIMER_MS);
  assert.ok(MAX_TIMER_MS <= 2_147_483_647);
});

test('scheduler does not markReminded when chunk fires early; only when due', async (t) => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 9, 1, 12, 0, 0) });
  t.after(() => mock.timers.reset());

  const remindAt = new Date(Date.now() + 2 * MAX_TIMER_MS + 60_000).toISOString();
  const fake = makeFakeRecords(makeRecord({ id: 'far', remindAt }));
  const events = new DomainEvents();
  const remindedEvents: string[] = [];
  events.on('record.reminded', (p) => remindedEvents.push(p.record.id));

  const scheduler = new Scheduler(fake.records as RecordService, events);
  scheduler.start();

  // First 24h chunk elapses — still not due.
  mock.timers.tick(MAX_TIMER_MS);
  assert.deepEqual(fake.marked, [], 'must not markReminded on early chunk');
  assert.deepEqual(remindedEvents, []);

  // Second 24h chunk — still ~60s early.
  mock.timers.tick(MAX_TIMER_MS);
  assert.deepEqual(fake.marked, []);
  assert.deepEqual(remindedEvents, []);

  // Remaining time — now actually due.
  mock.timers.tick(60_000);
  assert.deepEqual(fake.marked, ['far']);
  assert.deepEqual(remindedEvents, ['far']);

  scheduler.stop();
});

test('scheduler marks and notifies immediately when already overdue', async (t) => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 9, 1, 12, 0, 0) });
  t.after(() => mock.timers.reset());

  const remindAt = new Date(Date.now() - 60_000).toISOString();
  const fake = makeFakeRecords(makeRecord({ id: 'overdue', remindAt }));
  const events = new DomainEvents();
  const remindedEvents: string[] = [];
  events.on('record.reminded', (p) => remindedEvents.push(p.record.id));

  const scheduler = new Scheduler(fake.records as RecordService, events);
  scheduler.start();

  // dueInMs === 0 → setTimeout(0); advance past it.
  mock.timers.tick(0);
  assert.deepEqual(fake.marked, ['overdue']);
  assert.deepEqual(remindedEvents, ['overdue']);

  scheduler.stop();
});
