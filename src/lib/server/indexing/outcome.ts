/**
 * What happened to one block in one enrichment stage. A skip is terminal unless it is marked
 * retryable (a source that answered 5xx or 429); a failure is transient and worth another attempt.
 */
export type BlockOutcome<Entry> =
	| { kind: 'done'; entry: Entry }
	| { kind: 'skipped'; cause: SkipCause; reason: string; retryable: boolean }
	| { kind: 'failed'; error: string };

type SkipCause = 'unsupported' | 'too-large' | 'unreachable';

/** The part of an outcome worth keeping once the entry itself has been persisted. */
type UnsettledOutcome = Exclude<BlockOutcome<never>, { kind: 'done' }>;

export type OutcomeSink = (blockId: string, outcome: UnsettledOutcome) => void;

/** Server errors and rate limits clear up on their own; a missing or forbidden source does not. */
export function isRetryableStatus(status: number): boolean {
	return status === 429 || status >= 500;
}

export const errorMessage = (error: unknown) =>
	(error instanceof Error ? error.message : String(error)).slice(0, 300);
