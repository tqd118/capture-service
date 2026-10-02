export interface Record {
  id: string;
  text: string;
  createdAt: string;
  remindAt: string | null;
  doneAt: string | null;
  archivedAt: string | null;
  /** Internal reliability field: set once the reminder has fired, so restarts never re-fire it. Not part of the manifesto's conceptual fields, but required for exactly-once delivery. */
  remindedAt: string | null;
  /**
   * Set when the user dismisses an in-app reminder notification without
   * deleting or snoozing. Pending notifications are `remindedAt` set and
   * this field null — survives UI restart via `reminder.listPending`.
   */
  reminderDismissedAt: string | null;
}

export interface RecordListFilters {
  includeDone?: boolean;
  includeArchived?: boolean;
}

export type SnoozePreset = '15m' | '1h' | 'tomorrow';
