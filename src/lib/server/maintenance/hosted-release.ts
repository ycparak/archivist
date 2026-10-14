import { z } from 'zod';
import type { SearchRelease } from '$lib/search/snapshot';
import { assertPromotion, candidateOriginSchema, validationReportSchema } from './candidate';
import { fencedPut, type Lease } from './lease';
import { loadValidatedRelease, releaseAssets } from './release';
import { getJson, putImmutable, type ObjectStore } from './store';

export const PRODUCTION_POINTER_KEY = 'production/current.json';
export const productionPointerSchema = z
	.object({
		format: z.literal(1),
		fence: z.number().int().positive(),
		version: z.string().regex(/^[a-f0-9]{64}$/),
		jobId: z.string().min(1),
		/** Zero for a release adopted from the live site rather than produced by a job. */
		candidateFence: z.number().int().nonnegative(),
		sourceRevision: z.string().min(1),
		/** Retained so retention never removes the release open browser sessions may still use. */
		previousVersion: z
			.string()
			.regex(/^[a-f0-9]{64}$/)
			.nullable(),
		deployedAt: z.iso.datetime()
	})
	.strict();
export const ADOPTED_LIVE_JOB_ID = 'live-adopted';

export const jobKeys = (jobId: string) => ({
	job: `jobs/${jobId}/job.json`,
	discovery: `jobs/${jobId}/discovery.json`,
	merged: `jobs/${jobId}/merged.json`,
	origin: `jobs/${jobId}/origin.json`,
	validation: `jobs/${jobId}/validation.json`,
	validationMarkdown: `jobs/${jobId}/validation.md`,
	report: `jobs/${jobId}/report.json`
});

export const jobIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/);

export async function persistRelease(
	store: ObjectStore,
	release: SearchRelease,
	assets: ReadonlyMap<string, Uint8Array>
) {
	for (const asset of releaseAssets(release)) {
		const bytes = assets.get(asset.file);
		if (!bytes) throw new Error(`Missing release asset: ${asset.file}`);
		await putImmutable(store, `releases/${release.version}/${asset.file}`, bytes);
	}
	await putImmutable(
		store,
		`releases/${release.version}/manifest.json`,
		new TextEncoder().encode(JSON.stringify(release))
	);
}

export async function loadStoredRelease(store: ObjectStore, version: string) {
	const manifest = await store.get(`releases/${version}/manifest.json`);
	if (!manifest) throw new Error(`Stored release is missing: ${version}`);
	return loadValidatedRelease(
		JSON.parse(new TextDecoder().decode(manifest.bytes)),
		async (asset) => {
			const object = await store.get(`releases/${version}/${asset.file}`);
			if (!object) throw new Error(`Stored release asset is missing: ${asset.file}`);
			return object.bytes;
		}
	);
}

export async function loadProduction(store: ObjectStore) {
	const pointer = await getJson(store, PRODUCTION_POINTER_KEY, productionPointerSchema);
	return {
		pointer: pointer?.value ?? null,
		etag: pointer?.etag ?? null,
		release: pointer ? await loadStoredRelease(store, pointer.value.version) : undefined
	};
}

export const jobReportSchema = z
	.object({
		format: z.literal(1),
		jobId: z.string(),
		status: z.literal('completed'),
		candidateVersion: z.string().regex(/^[a-f0-9]{64}$/),
		passed: z.boolean(),
		/** `deploy` only for a passing candidate that differs from the live release. */
		decision: z.enum(['deploy', 'unchanged', 'rejected']),
		sourceRevision: z.string().min(1),
		blocks: z.number().int().nonnegative(),
		channels: z.number().int().nonnegative(),
		stages: z.record(z.string(), z.unknown()),
		completedAt: z.iso.datetime()
	})
	.strict();

/**
 * Everything a deployment must prove before it touches Worker assets: the job finished and
 * passed, it is not older than what production already runs, the checkout is the code that
 * produced it, and the recomputed evaluation still matches its report.
 */
export async function stageHostedDeployment(options: {
	store: ObjectStore;
	jobId: string;
	sourceRevision: string;
	sourceFingerprint: string;
	fixture: unknown;
}) {
	const { store } = options;
	const keys = jobKeys(jobIdSchema.parse(options.jobId));
	const report = await getJson(store, keys.report, jobReportSchema);
	if (!report) throw new Error('Job has not completed; cancelled or failed jobs cannot deploy');
	if (!report.value.passed) throw new Error('Job candidate failed validation');
	const origin = await getJson(store, keys.origin, candidateOriginSchema);
	const validation = await getJson(store, keys.validation, validationReportSchema);
	if (!origin?.value.job || !validation) throw new Error('Job candidate evidence is missing');
	if (origin.value.job.id !== options.jobId) throw new Error('Candidate belongs to another job');
	if (origin.value.sourceRevision !== options.sourceRevision)
		throw new Error('Check out the candidate source revision before deploying');
	const production = await loadProduction(store);
	if (production.pointer?.jobId === options.jobId) return { status: 'already-live' as const };
	if (production.pointer && production.pointer.candidateFence >= origin.value.job.fence)
		throw new Error('Candidate is superseded by the deployed release');
	const candidate = await loadStoredRelease(store, report.value.candidateVersion);
	await assertPromotion({
		candidate,
		origin: origin.value,
		report: validation.value,
		fixture: options.fixture,
		sourceFingerprint: options.sourceFingerprint,
		baseline: production.release
	});
	return {
		status: 'ready' as const,
		candidate,
		origin: origin.value,
		baseline: production.release,
		productionEtag: production.etag
	};
}

export type StagedDeployment = Extract<
	Awaited<ReturnType<typeof stageHostedDeployment>>,
	{ status: 'ready' }
>;

/**
 * Adopts the release the public site already serves as the production baseline, verifying every
 * asset against its manifest, so the first automatic deployment has something to compare against.
 */
export async function adoptLiveRelease(
	store: ObjectStore,
	lease: Lease,
	siteUrl: string,
	fetchFn: typeof fetch = fetch
) {
	const base = new URL('/search/', siteUrl);
	const fetchBytes = async (url: URL) => {
		const response = await fetchFn(url, { signal: AbortSignal.timeout(60_000) });
		if (!response.ok) throw new Error(`Live release request failed (${response.status})`);
		return new Uint8Array(await response.arrayBuffer());
	};
	const manifest: unknown = JSON.parse(
		new TextDecoder().decode(await fetchBytes(new URL('manifest.json', base)))
	);
	const live = await loadValidatedRelease(manifest, (asset) =>
		fetchBytes(new URL(`releases/${(manifest as SearchRelease).version}/${asset.file}`, base))
	);
	await persistRelease(store, live.release, live.assets);
	await fencedPut(
		store,
		lease,
		PRODUCTION_POINTER_KEY,
		{
			format: 1,
			version: live.release.version,
			jobId: ADOPTED_LIVE_JOB_ID,
			candidateFence: 0,
			sourceRevision: 'live-site',
			previousVersion: null,
			deployedAt: new Date().toISOString()
		},
		null
	);
	return live;
}

export async function recordHostedDeployment(
	store: ObjectStore,
	lease: Lease,
	staged: StagedDeployment
) {
	const job = staged.origin.job!;
	await fencedPut(
		store,
		lease,
		PRODUCTION_POINTER_KEY,
		{
			format: 1,
			version: staged.candidate.release.version,
			jobId: job.id,
			candidateFence: job.fence,
			sourceRevision: staged.origin.sourceRevision,
			previousVersion: staged.baseline?.release.version ?? null,
			deployedAt: new Date().toISOString()
		},
		staged.productionEtag
	);
}
