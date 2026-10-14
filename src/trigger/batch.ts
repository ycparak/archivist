import { schemaTask } from '@trigger.dev/sdk';
import { z } from 'zod';
import { ArenaClient, countBlockConnections } from '../lib/server/arena/client';
import { CONNECTION_CONCURRENCY } from '../lib/server/indexing/connections';
import { enrichBatchPayloadSchema, runEnrichBatch } from '../lib/server/maintenance/batches';
import { createR2Store } from '../lib/server/maintenance/r2';

/** Two batches at a time keeps Are.na reads and CDN downloads polite and the free plan cheap. */
const BATCH_CONCURRENCY = 2;

export const enrichBatchTask = schemaTask({
	id: 'archive-enrich-batch',
	schema: enrichBatchPayloadSchema,
	queue: { name: 'archive-enrich-batches', concurrencyLimit: BATCH_CONCURRENCY },
	machine: 'small-1x',
	maxDuration: 900,
	retry: { maxAttempts: 2, minTimeoutInMs: 10_000, maxTimeoutInMs: 60_000 },
	run: async (payload, { signal }) => {
		const accessToken = z
			.object({ ARENA_ACCESS_TOKEN: z.string().min(1) })
			.parse(process.env).ARENA_ACCESS_TOKEN;
		const client = new ArenaClient({ accessToken });
		return runEnrichBatch(payload, {
			store: createR2Store(process.env),
			signal,
			count: (blockId, countSignal) =>
				countBlockConnections(client, blockId, {
					signal: countSignal,
					rateLimitSafetyMargin: CONNECTION_CONCURRENCY * BATCH_CONCURRENCY
				})
		});
	}
});
