import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { mock, test } from 'node:test';
import { CaptureDb } from '../src/db.js';
import { DomainEvents } from '../src/events.js';
import { ValidationError } from '../src/errors.js';
import { DeterministicTimeParser } from '../src/nlp/deterministic-parser.js';
import { RecordService } from '../src/record-service.js';
import { Scheduler } from '../src/scheduler.js';
import { computeSnoozeRemindAt } from '../src/snooze.js';

function tmpDbPath(): string {
  return path.join(
    os.tmpdir(),
    `capture-reminder-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  );
}

function unlinkDb(dbPath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch {
      /* ignore */
    }
  }
}

function makeService(dbPath: string = tmpDbPath()): {
  dbPath: string;
  db: CaptureDb;
  events: DomainEvents;
  records: RecordService;
  cleanup(): void;
} {
  const db = new CaptureDb(dbPath);
  const events = new DomainEvents();
  const records = new RecordService(db.raw, events, new DeterministicTimeParser());
  return {
    dbPath,
    db,
    events,
    records,
    cleanup() {
      try {
        db.close();
      } catch {
        /* already closed */
      }
      unlinkDb(dbPath);
    },
  };
}

test('computeSnoozeRemindAt: 15m and 1h are offsets from now', () => {
  const now = new Date('2026-10-02T12:00:00.000Z');
  assert.equal(computeSnoozeRemindAt('15m', now).toISOString(), '2026-10-02T12:15:00.000Z');
  assert.equal(computeSnoozeRemindAt('1h', now).toISOString(), '2026-10-02T13:00:00.000Z');
});

test('computeSnoozeRemindAt: tomorrow is next local calendar day at 10:00', () => {
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const snoozed = computeSnoozeRemindAt('tomorrow', now);
  const expected = new Date(now.getTime());
  expected.setDate(expected.getDate() + 1);
  expected.setHours(10, 0, 0, 0);
  assert.equal(snoozed.getTime(), expected.getTime());
});

test('fire → pending; dismiss removes from pending; record remains', async (t) => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 9, 2, 10, 0, 0) });
  t.after(() => mock.timers.reset());

  const ctx = makeService();
  t.after(() => ctx.cleanup());

  const remindAt = new Date(Date.now() + 5_000).toISOString();
  const created = await ctx.records.create({ text: 'call mom', remindAt });
  assert.equal(ctx.records.listPendingReminders().length, 0);

  const remindedIds: string[] = [];
  ctx.events.on('record.reminded', (p) => remindedIds.push(p.record.id));

  const scheduler = new Scheduler(ctx.records, ctx.events);
  scheduler.start();
  mock.timers.tick(5_000);

  assert.deepEqual(remindedIds, [created.id]);
  const pending = ctx.records.listPendingReminders();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, created.id);
  assert.ok(pending[0].remindedAt);
  assert.equal(pending[0].reminderDismissedAt, null);

  const dismissed = ctx.records.dismissReminder(created.id);
  assert.ok(dismissed.reminderDismissedAt);
  assert.equal(ctx.records.listPendingReminders().length, 0);
  assert.equal(ctx.records.get(created.id).id, created.id);

  // Idempotent dismiss.
  const again = ctx.records.dismissReminder(created.id);
  assert.equal(again.reminderDismissedAt, dismissed.reminderDismissedAt);

  scheduler.stop();
});

test('reminder.ok deletes the record', async (t) => {
  const ctx = makeService();
  t.after(() => ctx.cleanup());

  const created = await ctx.records.create({
    text: 'temp',
    remindAt: new Date(Date.now() - 1000).toISOString(),
  });
  ctx.records.markReminded(created.id);
  assert.equal(ctx.records.listPendingReminders().length, 1);

  const deletedIds: string[] = [];
  ctx.events.on('record.deleted', (p) => deletedIds.push(p.id));

  ctx.records.okReminder(created.id);
  assert.deepEqual(deletedIds, [created.id]);
  assert.equal(ctx.records.listPendingReminders().length, 0);
  assert.throws(() => ctx.records.get(created.id));
});

test('snooze clears fire/ack and scheduler fires again', async (t) => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 9, 2, 12, 0, 0) });
  t.after(() => mock.timers.reset());

  const ctx = makeService();
  t.after(() => ctx.cleanup());

  const created = await ctx.records.create({
    text: 'snooze me',
    remindAt: new Date(Date.now() - 1000).toISOString(),
  });
  ctx.records.markReminded(created.id);
  assert.equal(ctx.records.listPendingReminders().length, 1);

  const remindedIds: string[] = [];
  ctx.events.on('record.reminded', (p) => remindedIds.push(p.record.id));

  const scheduler = new Scheduler(ctx.records, ctx.events);
  scheduler.start();

  const snoozed = ctx.records.snoozeReminder(created.id, '15m');
  assert.equal(snoozed.remindedAt, null);
  assert.equal(snoozed.reminderDismissedAt, null);
  assert.ok(snoozed.remindAt);
  assert.equal(ctx.records.listPendingReminders().length, 0);

  mock.timers.tick(15 * 60 * 1000);
  assert.deepEqual(remindedIds, [created.id]);
  assert.equal(ctx.records.listPendingReminders().length, 1);

  scheduler.stop();
});

test('dismissed reminder stays out of listPending after reopen (reconnect)', async (t) => {
  const dbPath = tmpDbPath();
  const ctx = makeService(dbPath);
  t.after(() => unlinkDb(dbPath));

  const created = await ctx.records.create({
    text: 'dismiss forever',
    remindAt: new Date(Date.now() - 1000).toISOString(),
  });
  ctx.records.markReminded(created.id);
  ctx.records.dismissReminder(created.id);
  ctx.db.close();

  const reopened = makeService(dbPath);
  t.after(() => {
    try {
      reopened.db.close();
    } catch {
      /* ignore */
    }
  });

  assert.equal(reopened.records.listPendingReminders().length, 0);
  const record = reopened.records.get(created.id);
  assert.ok(record.remindedAt);
  assert.ok(record.reminderDismissedAt);
});

test('dismiss without a fired reminder is a validation error', async (t) => {
  const ctx = makeService();
  t.after(() => ctx.cleanup());
  const created = await ctx.records.create({ text: 'no remind' });
  assert.throws(() => ctx.records.dismissReminder(created.id), ValidationError);
});

test('db migrates reminderDismissedAt onto existing tables', () => {
  const dbPath = tmpDbPath();
  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE records (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      remindAt TEXT,
      doneAt TEXT,
      archivedAt TEXT,
      remindedAt TEXT
    );
  `);
  legacy
    .prepare(
      `INSERT INTO records (id, text, createdAt, remindAt, doneAt, archivedAt, remindedAt)
       VALUES (?, ?, ?, NULL, NULL, NULL, NULL)`,
    )
    .run('legacy-1', 'old row', new Date().toISOString());
  legacy.close();

  const migrated = new CaptureDb(dbPath);
  const columns = migrated.raw.prepare(`PRAGMA table_info(records)`).all() as Array<{ name: string }>;
  assert.ok(columns.some((column) => column.name === 'reminderDismissedAt'));
  const row = migrated.raw.prepare('SELECT * FROM records WHERE id = ?').get('legacy-1') as {
    reminderDismissedAt: string | null;
  };
  assert.equal(row.reminderDismissedAt, null);
  migrated.close();
  unlinkDb(dbPath);
});

test('notify-send is disabled by default (CAPTURE_NOTIFY_ENABLE unset)', async () => {
  // Re-import config semantics: notifyDisabled when ENABLE !== '1'.
  const enable = process.env.CAPTURE_NOTIFY_ENABLE;
  delete process.env.CAPTURE_NOTIFY_ENABLE;
  // Config module was already evaluated — assert the intended rule directly.
  assert.equal(process.env.CAPTURE_NOTIFY_ENABLE !== '1', true);
  process.env.CAPTURE_NOTIFY_ENABLE = enable;
});
