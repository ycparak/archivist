import { AbortTaskRunError, metadata, schemaTask } from '@trigger.dev/sdk';
import { gzipSync } from 'node:zlib';
import { memoryUsage } from 'node:process';
import { z, ZodError } from 'zod';
import fixture from '../../scripts/fixtures/search-cases.json';
import { parseSlugList } from '../lib/server/indexing/channel-filter';
import type { SyncEvent } from '../lib/server/indexing/progress/events';
import { discoverArchive, enrichArchive } from '../lib/server/indexing/sync';
import { createCloudflareEmbedder } from '../lib/server/search/export';
import {
	HostedJobConfigurationError,
	hostedSyncPayloadSchema,
	runHostedSync
} from '../lib/server/maintenance/hosted-sync';
import { LeaseHeldError } from '../lib/server/maintenance/lease';
import { createR2Store } from '../lib/server/maintenance/r2';

const providerEnvSchema = z.object({
	ARENA_ACCESS_TOKEN: z.string().min(1),
	CLOUDFLARE_ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/i),
	CLOUDFLARE_API_TOKEN: z.string().min(1)
});

export const archiveSyncTask = schemaTask({
	id: 'archive-sync',
	schema: hostedSyncPayloadSchema,
	queue: { name: 'archive-maintenance', concurrencyLimit: 1 },
	maxDuration: 3600,
	// Each attempt resumes from persisted discovery and records, so one retry repeats no settled work.
	retry: { maxAttempts: 2, minTimeoutInMs: 30_000, maxTimeoutInMs: 120_000 },
	run: async (payload, { signal }) => {
		try {
			const env = providerEnvSchema.parse(process.env);
			const store = createR2Store(process.env);
			return await runHostedSync(payload, {
				store,
				signal,
				fixture,
				discover: (discoverySignal) =>
					discoverArchive({
						accessToken: env.ARENA_ACCESS_TOKEN,
						signal: discoverySignal,
						channelFilter: {
							ignore: parseSlugList(process.env.ARENA_IGNORE_CHANNELS),
							allowPrivate: new Set()
						},
						onEvent: progress
					}),
				enrich: (discovery, options) =>
					enrichArchive(discovery, { ...options, accessToken: env.ARENA_ACCESS_TOKEN }),
				embed: createCloudflareEmbedder({
					accountId: env.CLOUDFLARE_ACCOUNT_ID,
					apiToken: env.CLOUDFLARE_API_TOKEN
				}),
				onEvent: progress,
				gzipSize: async (bytes) => gzipSync(bytes).length,
				heapBytes: () => memoryUsage().heapUsed
			});
		} catch (error) {
			if (
				error instanceof ZodError ||
				error instanceof LeaseHeldError ||
				error instanceof HostedJobConfigurationError
			)
				throw new AbortTaskRunError(
					error instanceof ZodError ? 'Invalid configuration' : error.message
				);
			throw error;
		}
	}
});

function progress(event: SyncEvent) {
	if (event.kind === 'phase') metadata.set('phase', event.phase).set('position', null);
	else if (event.kind === 'position')
		metadata.set('position', { done: event.done, total: event.total });
}
