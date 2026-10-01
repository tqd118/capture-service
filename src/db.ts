import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';
import { logger } from './logger.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  remindAt TEXT,
  doneAt TEXT,
  archivedAt TEXT,
  remindedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_records_remindAt ON records(remindAt);
`;

export class CaptureDb {
  readonly raw: Database.Database;

  constructor(dbPath: string = config.dbPath) {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(dir, 0o700);
    } catch (error) {
      logger.medium(`Could not enforce 0700 permissions on ${dir}: ${(error as Error).message}`);
    }

    this.raw = new Database(dbPath);
    this.raw.pragma('journal_mode = WAL');
    this.raw.pragma('foreign_keys = ON');
    this.raw.exec(SCHEMA);

    try {
      fs.chmodSync(dbPath, 0o600);
    } catch (error) {
      logger.medium(`Could not enforce 0600 permissions on ${dbPath}: ${(error as Error).message}`);
    }
  }

  close(): void {
    this.raw.close();
  }
}
