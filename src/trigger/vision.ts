import { metadata, schemaTask } from '@trigger.dev/sdk';
import { z } from 'zod';
import { createVisionClient } from '../lib/server/indexing/vision/client';
import {
	fetchModelPricing,
	runVisionBackfill,
	visionBackfillPayloadSchema
} from '../lib/server/maintenance/backfill';
import { createR2Store } from '../lib/server/maintenance/r2';
import { rethrowForTrigger } from './hosted';

/**
 * The only hosted task that spends OpenRouter credit. It runs only when a maintainer triggers it
 * with an explicit block cap and budget, never on a schedule, and never writes to Are.na.
 */
export const visionBackfillTask = schemaTask({
	id: 'archive-vision-backfill',
	schema: visionBackfillPayloadSchema,
	queue: { name: 'archive-vision', concurrencyLimit: 1 },
	// Animations are transcoded with ffmpeg before description.
	machine: 'small-2x',
	maxDuration: 3600,
	// A retry resumes: settled blocks are skipped and the spend ledger carries over.
	retry: { maxAttempts: 2, minTimeoutInMs: 30_000, maxTimeoutInMs: 120_000 },
	run: async (payload, { signal }) => {
		try {
			const { OPENROUTER_API_KEY } = z
				.object({ OPENROUTER_API_KEY: z.string().min(1) })
				.parse(process.env);
			const client = createVisionClient({ apiKey: OPENROUTER_API_KEY });
			const report = await runVisionBackfill(payload, {
				store: createR2Store(process.env),
				client,
				signal,
				pricing: await fetchModelPricing(client.model)
			});
			metadata.set('generated', report.generated).set('spentUsd', report.spentUsd);
			return report;
		} catch (error) {
			rethrowForTrigger(error);
		}
	}
});
