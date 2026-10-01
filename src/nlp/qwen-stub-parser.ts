import { logger } from '../logger.js';
import type { TimeParser } from './types.js';
import { DeterministicTimeParser } from './deterministic-parser.js';

/**
 * Placeholder hook for a future local Qwen3-4B parser.
 *
 * The LLM, when wired up, must only extract a time EXPRESSION from the
 * text; the deterministic code remains responsible for turning that
 * expression into an actual timestamp (manifesto rule #6). This stub does
 * not call any LLM yet — it only documents the intended wiring point and
 * falls back to the deterministic parser so the service never depends on a
 * running model to start.
 */
export class QwenStubTimeParser implements TimeParser {
  readonly name = 'qwen-stub';
  private readonly fallback = new DeterministicTimeParser();

  constructor(private readonly endpointUrl: string | null) {}

  async parseTimeExpression(text: string, now: Date): Promise<Date | null> {
    if (!this.endpointUrl) {
      logger.medium('CAPTURE_NLP_PROVIDER=qwen but CAPTURE_QWEN_URL is not set; falling back to deterministic parser.');
      return this.fallback.parseTimeExpression(text, now);
    }

    // TODO: call `this.endpointUrl` to ask Qwen3-4B for a raw time
    // expression substring only (e.g. "завтра в 10"), then feed that
    // substring back through parseDeterministic() for the actual
    // timestamp conversion. Never let the model return a timestamp or
    // make any decision beyond "which substring, if any, looks temporal".
    logger.medium('Qwen time parser is not implemented yet; falling back to deterministic parser.');
    return this.fallback.parseTimeExpression(text, now);
  }
}
