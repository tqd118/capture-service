import { config } from '../config.js';
import type { TimeParser } from './types.js';
import { DeterministicTimeParser } from './deterministic-parser.js';
import { QwenStubTimeParser } from './qwen-stub-parser.js';

export type { TimeParser } from './types.js';
export { parseDeterministic } from './deterministic-parser.js';

export function createTimeParser(): TimeParser {
  if (config.nlpProvider === 'qwen') return new QwenStubTimeParser(config.qwenUrl);
  return new DeterministicTimeParser();
}
