import os from 'node:os';
import path from 'node:path';

export const config = {
  storeDir: path.join(os.homedir(), '.store', 'capture'),
  dbPath: path.join(os.homedir(), '.store', 'capture', 'capture.db'),
  host: '127.0.0.1',
  port: Number(process.env.CAPTURE_PORT ?? 17343),
  nlpProvider: (process.env.CAPTURE_NLP_PROVIDER ?? 'deterministic') as 'deterministic' | 'qwen',
  qwenUrl: process.env.CAPTURE_QWEN_URL ?? null,
  notifyCommand: process.env.CAPTURE_NOTIFY_CMD ?? 'notify-send',
  notifyDisabled: process.env.CAPTURE_NOTIFY_DISABLE === '1',
  limits: {
    text: 8 * 1024,
    requestBytes: 1 * 1024 * 1024,
  },
};
