import { schemaTask } from '@trigger.dev/sdk';
import { gzipSync } from 'node:zlib';
import { memoryUsage } from 'node:process';
import { z } from 'zod';
import { validateSyntheticRelease } from '../lib/server/maintenance/synthetic';

export const validationSmokeTask = schemaTask({
	id: 'validate-search-smoke',
	schema: z.object({}).strict(),
	retry: { maxAttempts: 1 },
	maxDuration: 60,
	run: async () => {
		const report = await validateSyntheticRelease({
			gzipSize: async (bytes) => gzipSync(bytes).length,
			heapBytes: () => memoryUsage().heapUsed
		});
		if (!report.passed) throw new Error('Synthetic search validation failed');
		return {
			candidate: report.candidateVersion,
			passed: report.passed,
			cases: report.results.length,
			mobile: report.mobile
		};
	}
});
