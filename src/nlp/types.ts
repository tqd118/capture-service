/**
 * A TimeParser extracts a reminder timestamp from free-form text.
 *
 * Per the manifesto: this layer is a dumb NLP parser, never an agent.
 * It must never classify, prioritize, invent context, or mutate records.
 * If a time expression is ambiguous, it MUST return null rather than guess.
 */
export interface TimeParser {
  readonly name: string;
  parseTimeExpression(text: string, now: Date): Promise<Date | null>;
}
