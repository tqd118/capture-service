import { execFile } from 'node:child_process';
import { config } from './config.js';
import { logger } from './logger.js';
import type { Record } from './types.js';

/**
 * Optional local desktop notification for a due reminder.
 *
 * Disabled by default — the reliable channel is the WebSocket
 * `record.reminded` event plus `reminder.listPending` on reconnect (in-app
 * drawer). Opt in with CAPTURE_NOTIFY_ENABLE=1.
 *
 * When enabled: shells out to `notify-send` (or CAPTURE_NOTIFY_CMD). Failures
 * are logged but never crash the service. `record.text` is passed after `--`
 * so a leading `-` cannot be interpreted as a notify-send option.
 */
export function notify(record: Record): void {
  if (config.notifyDisabled) {
    logger.low(`Notifications disabled; skipping notify-send for record ${record.id}`);
    return;
  }

  const args = ['-a', 'capture', 'Capture reminder', '--', record.text];
  execFile(config.notifyCommand, args, (error) => {
    if (error) {
      logger.high(`Failed to send desktop notification for record ${record.id}: ${error.message}`);
    } else {
      logger.low(`Sent desktop notification for record ${record.id}`);
    }
  });
}
