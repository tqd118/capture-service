import { CaptureDb } from './db.js';
import { DomainEvents } from './events.js';
import { logger } from './logger.js';
import { createTimeParser } from './nlp/index.js';
import { RecordService } from './record-service.js';
import { Scheduler } from './scheduler.js';
import { CaptureServer } from './server.js';

async function main(): Promise<void> {
  const db = new CaptureDb();
  const events = new DomainEvents();
  const timeParser = createTimeParser();
  const records = new RecordService(db.raw, events, timeParser);
  const scheduler = new Scheduler(records, events);
  const server = new CaptureServer(records, events, db, scheduler);

  await server.start();
  scheduler.start();

  const startedAt = new Date().toISOString();
  events.emitEvent('server.started', { type: 'server.started', at: startedAt });
  logger.low(`capture-service started at ${startedAt} (nlp=${timeParser.name})`);

  const shutdown = async (signal: string) => {
    logger.low(`Received ${signal}, shutting down.`);
    try {
      await server.stop();
      process.exit(0);
    } catch (error) {
      logger.high(`Error during shutdown: ${(error as Error).message}`);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('uncaughtException', (error) => logger.high(`Uncaught exception: ${error.message}`));
  process.on('unhandledRejection', (reason) => logger.high(`Unhandled rejection: ${String(reason)}`));
}

main().catch((error) => {
  logger.high(`Fatal startup error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
