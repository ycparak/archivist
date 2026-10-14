import { z } from 'zod';
import { archiveBlockSchema } from '$lib/domain/archive';
import { buildChannelManifest } from '$lib/server/indexing/channel-manifest';
import type { SyncEventSink } from '$lib/server/indexing/progress/events';
import {
	buildDocuments,
	type DiscoveredArchive,
	type EnrichmentOptions,
	type SyncSummary
} from '$lib/server/indexing/sync';
import { buildSearchRelease, sha256 } from '$lib/server/search/release-builder';
import {
	hostedEmbeddingCache,
	loadCanonicalCaches,
	loadRecords,
	mergeJobRecords,
	persistRecord,
	type ArchiveCaches,
	type CacheStage,
	type StageEntries
} from './caches';
import { candidateOriginSchema, formatValidationReport, validateCandidate } from './candidate';
import {
	loadProduction,
	jobIdSchema,
	jobKeys,
	jobReportSchema,
	persistRelease
} from './hosted-release';
import { embedEvaluationQueries, evaluationCasesSchema } from './evaluate';
import { acquireLease } from './lease';
import { loadValidatedRelease } from './release';
import { getJson, putImmutable, putJson, type ObjectStore } from './store';

export const hostedSyncPayloadSchema = z
	.object({
		jobId: jobIdSchema,
		stages: z.object({ colour: z.boolean(), connections: z.boolean() }).strict(),
		/** Vision generation and Are.na write-back are not available to hosted jobs yet. */
		vision: z.literal(false).default(false),
		pushArena: z.literal(false).default(false),
		source: z
			.object({
				sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
				sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/)
			})
			.strict()
	})
	.strict();
export type HostedSyncPayload = z.infer<typeof hostedSyncPayloadSchema>;

/** A payload or state contradiction that retrying cannot fix. */
export class HostedJobConfigurationError extends Error {
	override name = 'HostedJobConfigurationError';
}

const jobSchema = z
	.object({
		format: z.literal(1),
		jobId: z.string(),
		payloadHash: z.string(),
		createdAt: z.string()
	})
	.strict();
const discoverySchema = z
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

export interface HostedSyncDependencies {
	store: ObjectStore;
	discover: (signal: AbortSignal) => Promise<DiscoveredArchive>;
	enrich: (
		discovery: DiscoveredArchive,
		options: Omit<EnrichmentOptions, 'accessToken'>
	) => Promise<{ summary: SyncSummary }>;
	embed: (texts: string[]) => Promise<number[][]>;
	fixture: unknown;
	signal: AbortSignal;
	onEvent?: SyncEventSink;
	gzipSize: (bytes: Uint8Array) => Promise<number>;
	heapBytes: () => number;
	leaseTtlMs?: number;
	now?: () => number;
}

export async function runHostedSync(rawPayload: unknown, deps: HostedSyncDependencies) {
	const payload = hostedSyncPayloadSchema.parse(rawPayload);
	const { store } = deps;
	const keys = jobKeys(payload.jobId);
	const done = await getJson(store, keys.report, jobReportSchema);
	if (done) return done.value;

	const lease = await acquireLease(store, {
		holder: `job:${payload.jobId}`,
		ttlMs: deps.leaseTtlMs,
		now: deps.now,
		sameHolderTakeover: true
	});
	const signal = AbortSignal.any([deps.signal, lease.signal]);
	const checkpoint = () => {
		signal.throwIfAborted();
		lease.assertHeld();
	};
	try {
		const payloadHash = await sha256(new TextEncoder().encode(JSON.stringify(payload)));
		const job = await getJson(store, keys.job, jobSchema);
		if (job && job.value.payloadHash !== payloadHash)
			throw new HostedJobConfigurationError('Job ID was reused with a different payload');
		if (!job)
			await putJson(
				store,
				keys.job,
				{ format: 1, jobId: payload.jobId, payloadHash, createdAt: new Date().toISOString() },
				{ ifAbsent: true }
			);

		const discovery = await pinnedDiscovery(store, keys.discovery, deps.discover, signal);
		checkpoint();

		const { caches } = await loadCanonicalCaches(store);
		const records: Partial<{ [S in CacheStage]: StageEntries[S][] }> = {};
		if (payload.stages.colour) {
			records.colour = await loadRecords(store, payload.jobId, 'colour');
			for (const entry of records.colour) caches.colour.set(entry.block_id, entry);
		}
		if (payload.stages.connections) {
			records.connections = await loadRecords(store, payload.jobId, 'connections');
			for (const entry of records.connections) caches.connections.set(entry.block_id, entry);
		}

		const merged = await getJson(store, keys.merged, z.object({ at: z.string() }));
		let summary: SyncSummary = discovery.summary;
		let finalCaches: ArchiveCaches;
		if (merged) finalCaches = (await loadCanonicalCaches(store)).caches;
		else {
			const writes: Promise<void>[] = [];
			const onEntry =
				<S extends CacheStage>(stage: S) =>
				(entry: StageEntries[S]) => {
					records[stage]!.push(entry);
					writes.push(persistRecord(store, payload.jobId, stage, entry));
				};
			({ summary } = await deps.enrich(discovery, {
				signal,
				onEvent: deps.onEvent,
				visionCache: caches.vision,
				colourCache: caches.colour,
				connectionCache: caches.connections,
				colour: payload.stages.colour ? { onEntry: onEntry('colour') } : undefined,
				connections: payload.stages.connections ? { onEntry: onEntry('connections') } : undefined
			}));
			// Every settled entry must be durable before the job can merge or report success.
			await Promise.all(writes);
			checkpoint();
			finalCaches = await mergeJobRecords(store, lease, {
				jobId: payload.jobId,
				records,
				liveBlockIds: new Set(discovery.blocks.map(({ id }) => id))
			});
			await putJson(store, keys.merged, { at: new Date().toISOString() });
		}

		deps.onEvent?.({ kind: 'phase', phase: 'building' });
		const documents = buildDocuments(
			discovery.blocks,
			finalCaches.vision,
			finalCaches.colour,
			finalCaches.connections
		);
		const embeddings = await hostedEmbeddingCache(store);
		const built = await buildSearchRelease(
			documents,
			buildChannelManifest(discovery.channels),
			async (texts) => {
				signal.throwIfAborted();
				return deps.embed(texts);
			},
			embeddings.entries,
			embeddings.checkpoint
		);
		checkpoint();
		await persistRelease(store, built.release, built.assets);
		const candidate = await loadValidatedRelease(built.release, async (asset) =>
			built.assets.get(asset.file)!
		);

		const production = await loadProduction(store);
		const origin = candidateOriginSchema.parse({
			format: 1,
			kind: 'public-export',
			complete: true,
			...payload.source,
			baselineVersion: production.release?.release.version ?? null,
			maxRankDrop: null,
			job: { id: payload.jobId, fence: lease.token }
		});
		const queryVectors = await embedEvaluationQueries(
			evaluationCasesSchema.parse(deps.fixture),
			deps.embed
		);
		const validation = await validateCandidate({
			candidate,
			origin,
			fixture: deps.fixture,
			queryVectors,
			baseline: production.release,
			gzipSize: deps.gzipSize,
			heapBytes: deps.heapBytes
		});
		checkpoint();
		await putJson(store, keys.origin, origin);
		await putJson(store, keys.validation, validation);
		await store.put(
			keys.validationMarkdown,
			new TextEncoder().encode(formatValidationReport(validation))
		);
		const report = jobReportSchema.parse({
			format: 1,
			jobId: payload.jobId,
			status: 'completed',
			candidateVersion: candidate.release.version,
			passed: validation.passed,
			blocks: discovery.blocks.length,
			channels: discovery.channels.length,
			stages: {
				colour: summary.colour,
				connections: summary.connections
			},
			completedAt: new Date().toISOString()
		});
		checkpoint();
		await putJson(store, keys.report, report);
		deps.onEvent?.({ kind: 'phase', phase: 'done' });
		return report;
	} finally {
		await lease.release();
	}
}

/**
 * A resumed job reuses the corpus it first discovered instead of rediscovering a changed archive
 * mid-run. Only complete discovery is ever persisted.
 */
async function pinnedDiscovery(
	store: ObjectStore,
	key: string,
	discover: HostedSyncDependencies['discover'],
	signal: AbortSignal
): Promise<DiscoveredArchive> {
	const existing = await getJson(store, key, discoverySchema);
	if (existing) return { ...existing.value, complete: true };
	const discovery = await discover(signal);
	signal.throwIfAborted();
	if (!discovery.complete || !discovery.blocks.length || !discovery.channels.length)
		throw new Error('Archive discovery was incomplete or empty; nothing was persisted');
	const snapshot = discoverySchema.parse({
		format: 1,
		complete: true,
		ownerId: discovery.ownerId,
		channels: discovery.channels,
		blocks: discovery.blocks,
		summary: discovery.summary,
		discoveredAt: new Date().toISOString()
	});
	await putImmutable(store, key, new TextEncoder().encode(JSON.stringify(snapshot)));
	return discovery;
}
