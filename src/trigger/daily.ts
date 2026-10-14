import { AbortTaskRunError, logger, metadata, schedules } from '@trigger.dev/sdk';
import { z } from 'zod';
import { dispatchSiteDeploy } from '../lib/server/maintenance/github';
import { HostedJobConfigurationError, runHostedSync } from '../lib/server/maintenance/hosted-sync';
import { acquireLease, LeaseHeldError } from '../lib/server/maintenance/lease';
import { pruneArtifacts } from '../lib/server/maintenance/retention';
import { hostedDependencies, maintenanceQueue, rethrowForTrigger } from './hosted';
import { SOURCE_IDENTITY } from './source-identity';

const GITHUB_REPOSITORY = 'ycparak/archivist';

export const dailyArchiveSync = schedules.task({
	id: 'daily-archive-sync',
	cron: { pattern: '0 6 * * *', environments: ['PRODUCTION'] },
	queue: maintenanceQueue,
	machine: 'medium-1x',
	maxDuration: 3600,
	retry: { maxAttempts: 2, minTimeoutInMs: 60_000, maxTimeoutInMs: 300_000 },
	run: async (payload, { ctx, signal }) => {
		try {
			const source = SOURCE_IDENTITY;
			if (!source)
				throw new HostedJobConfigurationError(
					'This worker was not deployed by CI with a source identity'
				);
			const commit = ctx.deployment?.git?.commitSha;
			if (commit && commit !== source.sourceRevision)
				throw new HostedJobConfigurationError('Source identity does not match the deployed commit');

			// One job per scheduled day: a duplicate fire or a retry resumes it instead of starting another.
			const jobId = `daily-${payload.timestamp.toISOString().slice(0, 10).replaceAll('-', '')}`;
			const deps = hostedDependencies(signal);
			const report = await runHostedSync(
				{
					jobId,
					stages: { colour: true, connections: true },
					gate: 'no-regression',
					source
				},
				deps
			);
			metadata.set('decision', report.decision);
			if (report.decision === 'rejected')
				throw new AbortTaskRunError(
					`Candidate ${report.candidateVersion} failed the no-regression gate; the live site is unchanged`
				);
			if (report.decision === 'deploy')
				await dispatchSiteDeploy({
					token: z.string().min(1).parse(process.env.GITHUB_DEPLOY_TOKEN),
					repository: GITHUB_REPOSITORY,
					jobId,
					revision: report.sourceRevision
				});

			try {
				const lease = await acquireLease(deps.store, { holder: `prune:${jobId}` });
				try {
					metadata.set('pruned', await pruneArtifacts(deps.store, lease));
				} finally {
					await lease.release();
				}
			} catch (error) {
				// Retention is housekeeping; it must not fail a run whose release was already handed off.
				if (!(error instanceof LeaseHeldError))
					logger.warn('Retention skipped', { error: String(error) });
			}
			return report;
		} catch (error) {
			rethrowForTrigger(error);
		}
	}
});
