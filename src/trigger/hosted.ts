import { AbortTaskRunError, metadata, queue } from '@trigger.dev/sdk';
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
	type HostedSyncDependencies
} from '../lib/server/maintenance/hosted-sync';
import { LeaseHeldError } from '../lib/server/maintenance/lease';
import { createR2Store } from '../lib/server/maintenance/r2';

export const SITE_URL = 'https://archivist.yusufparak.com';

/** Manual and scheduled syncs share one queue so they never run at once; the lease enforces it durably. */
export const maintenanceQueue = queue({ name: 'archive-maintenance', concurrencyLimit: 1 });

const providerEnvSchema = z.object({
	ARENA_ACCESS_TOKEN: z.string().min(1),
	CLOUDFLARE_ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/i),
	CLOUDFLARE_API_TOKEN: z.string().min(1)
});

export function hostedDependencies(signal: AbortSignal): HostedSyncDependencies {
	const env = providerEnvSchema.parse(process.env);
	return {
		store: createR2Store(process.env),
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
		liveSite: { url: SITE_URL },
		gzipSize: async (bytes) => gzipSync(bytes).length,
		heapBytes: () => memoryUsage().heapUsed
	};
}

/** Configuration, lease and payload contradictions fail once; everything else may retry. */
export function rethrowForTrigger(error: unknown): never {
	if (error instanceof ZodError) throw new AbortTaskRunError('Invalid configuration');
	if (error instanceof LeaseHeldError || error instanceof HostedJobConfigurationError)
		throw new AbortTaskRunError(error.message);
	throw error;
}

function progress(event: SyncEvent) {
	if (event.kind === 'phase') metadata.set('phase', event.phase).set('position', null);
	else if (event.kind === 'position')
		metadata.set('position', { done: event.done, total: event.total });
}
