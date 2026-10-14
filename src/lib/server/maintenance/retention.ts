import { z } from 'zod';
import { jobReportSchema, PRODUCTION_POINTER_KEY, productionPointerSchema } from './hosted-release';
import type { Lease } from './lease';
import { getJson, type ObjectStore } from './store';

const jobSchema = z.object({ createdAt: z.iso.datetime() }).passthrough();
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Daily candidates add a release each run, so storage is bounded here. The live release, the one
 * before it (still open in browser sessions) and the newest candidates are kept; canonical caches
 * and embedding deltas are never touched.
 */
export async function pruneArtifacts(
	store: ObjectStore,
	lease: Lease,
	options: { now?: number; keepCandidates?: number; jobRetentionDays?: number } = {}
) {
	const { now = Date.now(), keepCandidates = 7, jobRetentionDays = 30 } = options;
	const production = (await getJson(store, PRODUCTION_POINTER_KEY, productionPointerSchema))?.value;
	const jobIds = [...new Set((await store.list('jobs/')).map((key) => key.split('/')[1]))];
	const jobs = [];
	for (const jobId of jobIds) {
		const job = await getJson(store, `jobs/${jobId}/job.json`, jobSchema);
		const report = await getJson(store, `jobs/${jobId}/report.json`, jobReportSchema);
		jobs.push({ jobId, createdAt: job?.value.createdAt ?? null, report: report?.value ?? null });
	}
	const candidates = jobs
		.flatMap(({ report }) => (report ? [report] : []))
		.sort((a, b) => b.completedAt.localeCompare(a.completedAt))
		.map(({ candidateVersion }) => candidateVersion);
	const keep = new Set([
		...[production?.version, production?.previousVersion].filter((v): v is string => !!v),
		...[...new Set(candidates)].slice(0, keepCandidates)
	]);

	const deleted = { releases: 0, jobs: 0 };
	const releaseKeys = await store.list('releases/');
	for (const version of new Set(releaseKeys.map((key) => key.split('/')[1]))) {
		if (keep.has(version)) continue;
		for (const key of releaseKeys.filter((k) => k.startsWith(`releases/${version}/`))) {
			lease.assertHeld();
			await store.delete(key);
		}
		deleted.releases += 1;
	}
	const cutoff = now - jobRetentionDays * DAY_MS;
	for (const { jobId, createdAt } of jobs) {
		// A job without a readable creation time is left alone rather than guessed at.
		if (!createdAt || Date.parse(createdAt) >= cutoff || jobId === production?.jobId) continue;
		for (const key of await store.list(`jobs/${jobId}/`)) {
			lease.assertHeld();
			await store.delete(key);
		}
		deleted.jobs += 1;
	}
	return deleted;
}
