import { z } from 'zod';
import { archiveBlockSchema } from '$lib/domain/archive';
import type { OutcomeSink } from '$lib/server/indexing/outcome';
import type { SyncSummary } from '$lib/server/indexing/sync';

export const discoverySchema = z
	.object({
		format: z.literal(1),
		complete: z.literal(true),
		ownerId: z.number().int(),
		channels: z.array(z.object({ slug: z.string().min(1), title: z.string().min(1) }).strict()),
		blocks: z.array(archiveBlockSchema).min(1),
		summary: z.custom<SyncSummary>((value) => typeof value === 'object' && value !== null),
		discoveredAt: z.iso.datetime()
	})
	.strict();

export const storedOutcomeSchema = z
	.object({
		blockId: z.string(),
		kind: z.enum(['skipped', 'failed']),
		cause: z.enum(['unsupported', 'too-large', 'unreachable']).nullable(),
		retryable: z.boolean(),
		reason: z.string()
	})
	.strict();
export type StoredOutcome = z.infer<typeof storedOutcomeSchema>;

export const jobOutcomesSchema = z
	.object({
		colour: z.array(storedOutcomeSchema),
		connections: z.array(storedOutcomeSchema),
		vision: z.array(storedOutcomeSchema).default([])
	})
	.strict();
export type JobOutcomes = z.infer<typeof jobOutcomesSchema>;

export function storedOutcome(...[blockId, outcome]: Parameters<OutcomeSink>): StoredOutcome {
	return {
		blockId,
		kind: outcome.kind,
		cause: outcome.kind === 'skipped' ? outcome.cause : null,
		retryable: outcome.kind === 'failed' || outcome.retryable,
		reason: outcome.kind === 'failed' ? outcome.error : outcome.reason
	};
}

/** A payload or state contradiction that retrying cannot fix. */
export class HostedJobConfigurationError extends Error {
	override name = 'HostedJobConfigurationError';
}
