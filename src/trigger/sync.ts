import { schemaTask } from '@trigger.dev/sdk';
import { hostedSyncPayloadSchema, runHostedSync } from '../lib/server/maintenance/hosted-sync';
import {
	hostedDependencies,
	maintenanceQueue,
	rethrowForTrigger,
	visionDependencies
} from './hosted';

export const archiveSyncTask = schemaTask({
	id: 'archive-sync',
	schema: hostedSyncPayloadSchema,
	queue: maintenanceQueue,
	// Building and validating a release holds the embedding cache, assets and search engine at once;
	// the default 0.5 GB machine was OOM-killed in the first hosted run.
	machine: 'medium-1x',
	maxDuration: 3600,
	// Each attempt resumes from persisted discovery and records, so one retry repeats no settled work.
	retry: { maxAttempts: 2, minTimeoutInMs: 30_000, maxTimeoutInMs: 120_000 },
	run: async (payload, { signal }) => {
		try {
			return await runHostedSync(payload, {
				...hostedDependencies(signal),
				...(payload.vision ? { vision: await visionDependencies() } : {})
			});
		} catch (error) {
			rethrowForTrigger(error);
		}
	}
});
