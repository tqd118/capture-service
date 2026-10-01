# capture-service

A local, event-driven capture/reminder backend. It replaces
`local-notes-service` for the "dump a thought, maybe get reminded" use case
described in the project manifesto. It is a backend only — no UI is included
or modified by this repository.

## Product shape (from the manifesto)

There is exactly **one** entity, a *record*:

```text
text          — the thought, required
createdAt     — set on creation
remindAt?     — set only when a time expression was unambiguous
doneAt?       — set when marked done
archivedAt?   — set when archived
```

There is no `Task`/`Reminder`/`Note` split, no tags, folders, projects,
priorities, sync, mobile app, or AI-agent behavior. If `remindAt` is absent,
the record is just a thought. If present, the service will remind once.

The (future) local LLM is **only** a time-expression extractor. It never
classifies, prioritizes, invents context, or mutates other records. When a
time expression is ambiguous, the service **never guesses** — it just saves
the record without `remindAt`.

## Runtime

- Node.js (>=20) + TypeScript (ESM)
- WebSocket transport (`ws`)
- SQLite (`better-sqlite3`) as the sole source of truth — **no markdown
  files** (the manifesto is explicit: not every thought becomes a file)
- Zod validation
- No polling, anywhere
- Binds only to `127.0.0.1`

## Storage

```text
~/.store/capture/
└── capture.db      # SQLite, mode 0600; parent dir mode 0700
```

### Schema

```sql
CREATE TABLE records (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  createdAt TEXT NOT NULL,     -- ISO 8601
  remindAt TEXT,               -- ISO 8601 or NULL
  doneAt TEXT,                 -- ISO 8601 or NULL
  archivedAt TEXT,             -- ISO 8601 or NULL
  remindedAt TEXT              -- ISO 8601 or NULL; internal only, see below
);
```

`remindedAt` is not one of the manifesto's conceptual fields. It exists
purely so that a reminder fires **exactly once** even across service
restarts (if the process restarts after a reminder already fired, it will
not fire again). It is returned on the wire like any other field in case a
future client finds it useful, but clients should not need to set it.

## Running

```bash
npm install
npm run dev     # tsx watch, for local development
```

Production:

```bash
npm run build
npm start
```

Tests:

```bash
npm test
```

## Environment variables

| Variable                 | Default                  | Meaning                                                              |
|---------------------------|---------------------------|------------------------------------------------------------------------|
| `CAPTURE_PORT`            | `17343`                  | WebSocket port. Deliberately different from the legacy notes service's `17342` so both can run side by side during migration. |
| `CAPTURE_NLP_PROVIDER`    | `deterministic`          | `deterministic` or `qwen` (see [NLP layer](#nlp-layer)).               |
| `CAPTURE_QWEN_URL`        | unset                    | HTTP endpoint for a future local Qwen3-4B parser. Unused today.        |
| `CAPTURE_NOTIFY_CMD`      | `notify-send`            | Command used to raise desktop notifications.                           |
| `CAPTURE_NOTIFY_DISABLE`  | unset                    | Set to `1` to skip firing desktop notifications (still emits the WebSocket event). Useful for headless dev/test. |

## WebSocket protocol

Connect to:

```text
ws://127.0.0.1:17343
```

Same envelope style as the legacy notes service:

Request:

```json
{
  "kind": "request",
  "requestId": "client-generated-id",
  "operation": "record.create",
  "payload": { "text": "завтра в 10 проверить результаты тестов" }
}
```

Response (success):

```json
{ "kind": "response", "requestId": "client-generated-id", "ok": true, "data": {} }
```

Response (failure):

```json
{
  "kind": "response",
  "requestId": "client-generated-id",
  "ok": false,
  "error": { "code": "VALIDATION_ERROR", "message": "..." }
}
```

Event (server-initiated, no `requestId`):

```json
{ "kind": "event", "event": "record.created", "data": { } }
```

Events are broadcast only to currently connected clients — there is no
delivery queue or guaranteed delivery, same spirit as the legacy service.

### Events

- `server.started` — `{ at: string }`
- `record.created` — the full record
- `record.updated` — the full record
- `record.deleted` — `{ id: string }`
- `record.reminded` — the full record, emitted exactly once when its
  `remindAt` fires

### Operations

#### `record.create`

Payload:

```json
{ "text": "string, required", "remindAt": "ISO 8601 string, optional" }
```

- If `remindAt` is provided explicitly, it is trusted as-is (the client
  already resolved the time) and no NLP parsing runs.
- Otherwise the server runs the time parser over `text`. If it finds a
  clear, unambiguous time expression, `remindAt` is set; otherwise the
  record is saved as a plain thought with `remindAt: null`.

Returns the created record.

#### `record.list`

Payload (all optional):

```json
{ "includeDone": false, "includeArchived": false }
```

Returns an array of records (metadata + text — records are short, so
there's no separate "get full content" step). By default, done and
archived records are excluded.

#### `record.get`

Payload: `{ "id": "uuid" }`. Returns the record or a `NOT_FOUND` error.

#### `record.update`

Payload:

```json
{
  "id": "uuid",
  "text": "optional new text",
  "remindAt": "optional ISO string, or null to clear",
  "doneAt": "optional ISO string, or null to clear",
  "archivedAt": "optional ISO string, or null to clear"
}
```

Changing `remindAt` resets the internal "already reminded" state, so a
record can be reminded again if the user pushes the time forward.

#### `record.delete`

Payload: `{ "id": "uuid" }`. Deletion is intentionally by ID only.

#### `record.markDone`

Payload: `{ "id": "uuid" }`. Sets `doneAt` to now (idempotent — calling it
twice keeps the original timestamp).

#### `record.archive`

Payload: `{ "id": "uuid" }`. Sets `archivedAt` to now (idempotent, same as
above).

## Scheduler

Mirrors the legacy service's approach: a single `setTimeout` is kept
pointed at the nearest pending reminder (`remindAt IS NOT NULL AND
remindedAt IS NULL AND doneAt IS NULL AND archivedAt IS NULL`). It is
rebuilt on every `record.created` / `record.updated` / `record.deleted`
event and once at startup.

If a reminder was already due while the service was offline, it fires
immediately on startup (logged as `medium` priority) instead of being
silently skipped — reliability over cleverness.

## Notifications

On fire, the service:

1. Marks the record as reminded (`remindedAt`) so it never fires twice.
2. Emits the `record.reminded` WebSocket event to all connected clients.
3. Shells out to `notify-send -a capture "Capture reminder" "<text>"`
   (Linux desktop notification). Override the command with
   `CAPTURE_NOTIFY_CMD`, or disable it entirely with
   `CAPTURE_NOTIFY_DISABLE=1`. A failure to notify is logged but never
   crashes the service or blocks the WebSocket event — the event is the
   reliable signal.

No cloud push, no email, no mobile notifications — purely local, matching
the manifesto's "shell-native" principle.

## NLP layer

`TimeParser` (`src/nlp/types.ts`) is a small pluggable interface:

```ts
interface TimeParser {
  readonly name: string;
  parseTimeExpression(text: string, now: Date): Promise<Date | null>;
}
```

### `deterministic` (default)

Rule-based Russian patterns in `src/nlp/deterministic-parser.ts`.
The parser **never guesses**: only the constructions below match; anything
else yields `null` (record saved as a plain thought).

**Supported constructions**

1. **Relative day + optional time-of-day**
   - `завтра` / `послезавтра` / `через N дней` (N integer; forms день/дня/дней)
   - optional: `утром` | `в обед` | `вечером` | `в <time>`
2. **Relative duration** — `через N часов` / `через N минут`
   (forms час/часа/часов, минута/минуты/минут). Pure offset from now.
3. **Weekday** — `в понедельник` … `в воскресенье` (accusative/nominative)
   and short forms `пн`/`вт`/`ср`/`чт`/`пт`/`сб`/`вс`. Next occurrence from
   now; same weekday with a time already past rolls to next week.
4. **Day of month** — `15-го` / `15-е` / `15 числа` (bare digits alone are
   not matched). That day this month if still upcoming at the resolved
   time, else next month; if next month has no such day → `null`.

**Default clock times** (local / system timezone, Europe/Minsk on the
target host):

| Phrase                         | Time  |
|--------------------------------|-------|
| Day only (завтра / в пятницу / 15-е / через N дней) | **10:00** |
| `утром`                        | **09:00** |
| `в обед`                       | **13:00** |
| `вечером`                      | **19:00** |

**Clock-time rules** for `в HH[:MM]` with optional `утра`/`вечера`:

- No marker: 24-hour clock (`в 10` → 10:00, `в 15:30` → 15:30; hour 0–23).
- `утра`: hour 1–11 as AM; `в 12 утра` → 00:00.
- `вечера`: hour 1–11 → hour+12; `в 12 вечера` → 00:00.
- Invalid hour/minute → `null` (not clamped).

`сегодня` **requires** an explicit time-of-day (no 10:00 default). If that
time has already passed today, the result is `null` (no silent roll to
tomorrow). Standalone vague words like «вечером» / «утром» without a day
anchor also resolve to `null`.

### `qwen` (future hook, not implemented)

Setting `CAPTURE_NLP_PROVIDER=qwen` selects `QwenStubTimeParser`
(`src/nlp/qwen-stub-parser.ts`), which currently just falls back to the
deterministic parser and logs that it is unimplemented. **The service
never requires a running LLM to start.** When wired up, the intended
contract stays the same as the manifesto demands: the model may only
extract a raw time-expression substring from the text; converting that
substring into an actual timestamp remains the job of the deterministic
code path, never the model.

## Logging

Logs go only to stdout/stderr:

```text
[2026-08-10T12:00:00.000Z] [low] Created record ...
[2026-08-10T12:00:00.000Z] [medium] Deleted record ...
[2026-08-10T12:00:00.000Z] [high] Request ... failed: ...
```

Priorities:

- `low`: normal create/read/scheduler activity
- `medium`: deletion, validation errors, missed scheduler reminders
- `high`: database failures, failed requests, WebSocket failures, fatal
  process errors

## Explicitly out of scope (MVP)

Per the manifesto and task scope: Quickshell/`framed` UI changes, Obsidian
integration, sync, mobile, semantic search, tags, projects, recurring
tasks, knowledge graph, and any AI-agent behavior beyond "extract a time
expression". These are not deferred-but-planned — they are rejected by
design unless daily use of this MVP proves otherwise.

## Migrating from `local-notes-service`

This service does **not** read, write, or dual-write to the old notes
database or its markdown files — the two can simply run side by side
(different ports: `17342` vs `17343`) during a transition. Migrating old
note content into capture records, if ever wanted, is a manual/future
exercise and intentionally out of scope here.

## Adapting the `framed` client (future task, not done here)

This repository does not touch any Quickshell/`framed` files. For
reference, the existing `NotesService.qml` singleton pattern (WebSocket url
+ `_send(operation, payload)` + `_pendingRequests` keyed by `requestId` +
`_handleEvent` dispatch) maps directly onto this protocol — swap the
`note.*` operation names for `record.*` ones and the URL for
`ws://127.0.0.1:17343`. That adaptation is intentionally left for a
follow-up task.
