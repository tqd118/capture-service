import { execFile } from 'node:child_process';
import { config } from './config.js';
import { logger } from './logger.js';
import type { Record } from './types.js';

/**
 * Fires a local desktop notification for a due reminder.
 *
 * Linux: shells out to `notify-send` (or CAPTURE_NOTIFY_CMD override) by
 * default. No cloud push, no email — purely local, matching the manifesto's
 * "shell-native" principle. Failures are logged but never crash the service;
 * the WebSocket `record.reminded` event is the reliable signal either way.
 */
export function notify(record: Record): void {
  if (config.notifyDisabled) {
    logger.low(`Notifications disabled; skipping notify-send for record ${record.id}`);
    return;
  }

  const args = ['-a', 'capture', 'Capture reminder', record.text];
  execFile(config.notifyCommand, args, (error) => {
    if (error) {
      logger.high(`Failed to send desktop notification for record ${record.id}: ${error.message}`);
    } else {
      logger.low(`Sent desktop notification for record ${record.id}`);
    }
  });
}
