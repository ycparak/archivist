import { z } from 'zod';
import { buildChannelManifest } from '$lib/server/indexing/channel-manifest';
import type { SyncEventSink } from '$lib/server/indexing/progress/events';
import {
	applyWrittenBack,
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
	adoptLiveRelease,
	loadProduction,
	jobIdSchema,
	jobKeys,
	jobReportSchema,
	persistRelease
} from './hosted-release';
import { embedEvaluationQueries, evaluationCasesSchema, GATE_POLICIES } from './evaluate';
import { acquireLease } from './lease';
import { loadValidatedRelease } from './release';
import { getJson, putImmutable, putJson, type ObjectStore } from './store';
import {
	discoverySchema,
	HostedJobConfigurationError,
	jobOutcomesSchema,
	storedOutcome,
	type JobOutcomes
} from './job-schemas';
import {
	budgetedVisionClient,
	COST_ASSUMPTIONS,
	createSpendLimiter,
	estimateBackfillCost,
	ledgerSchema,
	MAX_BACKFILL_BLOCKS,
	MAX_BACKFILL_BUDGET_USD,
	type ModelPricing
} from './backfill';
import type { VisionClient } from '$lib/server/indexing/vision/client';
import {
	BATCH_STAGES,
	chunk,
	FAN_OUT_THRESHOLD,
	loadBatchOutcomes,
	type BatchStage
} from './batches';
import { planColourWork } from '$lib/server/indexing/colour';
import { planConnectionWork } from '$lib/server/indexing/connections';
import type { OutcomeSink } from '$lib/server/indexing/outcome';

export const hostedSyncPayloadSchema = z
	.object({
		jobId: jobIdSchema,
		stages: z.object({ colour: z.boolean(), connections: z.boolean() }).strict(),
		/** Describe missing or stale blocks, within a per-run block cap and budget. */
		vision: z
			.union([
				z.literal(false),
				z
					.object({
						maxBlocks: z.number().int().positive().max(MAX_BACKFILL_BLOCKS),
						budgetUsd: z.number().positive().max(MAX_BACKFILL_BUDGET_USD)
					})
					.strict()
			])
			.default(false),
		/** Write generated titles and descriptions to the maintainer's own Are.na blocks. */
		pushArena: z.boolean().default(false),
		gate: z.enum(GATE_POLICIES).default('strict'),
		/** Re-run only the blocks that job left retryable, on its pinned discovery, without pruning. */
		retryOf: jobIdSchema.optional(),
		source: z
			.object({
				sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
				sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/)
			})
			.strict()
	})
	.strict();
export type HostedSyncPayload = z.infer<typeof hostedSyncPayloadSchema>;

export { HostedJobConfigurationError };

const retryableCount = (outcomes: JobOutcomes | null) =>
	outcomes
		? [...outcomes.colour, ...outcomes.connections, ...outcomes.vision].filter((o) => o.retryable)
				.length
		: 0;
const writtenSchema = z
	.object({ blockId: z.string(), title: z.string().optional(), description: z.string().optional() })
	.strict();
/** Hosted vision describes a few blocks at a time; the local CLI's 32 suits a laptop backfill. */
const HOSTED_VISION_CONCURRENCY = 4;

const jobSchema = z
	.object({
		format: z.literal(1),
		jobId: z.string(),
		payloadHash: z.string(),
		createdAt: z.string()
	})
	.strict();
/** How far a known failure's expected ranks may slip before the no-regression gate rejects it. */
export const NO_REGRESSION_RANK_TOLERANCE = 10;

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
	/** When set and no production pointer exists, adopt the release this site serves as the baseline. */
	liveSite?: { url: string; fetchFn?: typeof fetch };
	/**
	 * Runs a stage's batches as separate child runs and resolves once all of them finish. When
	 * set, a stage with more than `FAN_OUT_THRESHOLD` pending blocks fans out instead of running here.
	 */
	fanOut?: (jobId: string, stage: BatchStage, batches: string[][]) => Promise<void>;
	/** Required when the payload enables vision. */
	vision?: { client: VisionClient; pricing: ModelPricing | null };
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

		const discovery = await pinnedDiscovery(
			store,
			keys.discovery,
			payload.retryOf ? () => originalDiscovery(store, payload.retryOf!) : deps.discover,
			signal
		);
		checkpoint();
		const retryIds = payload.retryOf
			? await retryableBlockIds(store, payload.retryOf, payload.stages)
			: null;
		// A retry enriches only its failed blocks; the candidate is still built from the whole corpus.
		const work: DiscoveredArchive = retryIds
			? { ...discovery, blocks: discovery.blocks.filter(({ id }) => retryIds.has(id)) }
			: discovery;

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
		if (payload.vision) {
			if (!deps.vision) throw new HostedJobConfigurationError('Vision needs a vision client');
			records.vision = await loadRecords(store, payload.jobId, 'vision');
			for (const entry of records.vision) caches.vision.set(entry.block_id, entry);
		}

		const merged = await getJson(
			store,
			keys.merged,
			z.object({
				at: z.string(),
				colour: z.unknown(),
				connections: z.unknown(),
				vision: z.unknown().optional(),
				writeBack: z.unknown().optional(),
				visionSpend: z.unknown().optional()
			})
		);
		let visionSpend: unknown = merged?.value.visionSpend ?? null;
		let summary: SyncSummary = discovery.summary;
		let finalCaches: ArchiveCaches;
		if (merged) {
			// A resumed attempt reports the stage results the merging attempt recorded.
			summary = {
				...summary,
				colour: (merged.value.colour ?? null) as SyncSummary['colour'],
				connections: (merged.value.connections ?? null) as SyncSummary['connections'],
				vision: (merged.value.vision ?? null) as SyncSummary['vision'],
				writeBack: (merged.value.writeBack ?? null) as SyncSummary['writeBack']
			};
			finalCaches = (await loadCanonicalCaches(store)).caches;
		} else {
			const writes: Promise<void>[] = [];
			const outcomes: JobOutcomes = { colour: [], connections: [], vision: [] };
			const onOutcome =
				(stage: keyof JobOutcomes): OutcomeSink =>
				(...args) =>
					outcomes[stage].push(storedOutcome(...args));
			const onEntry =
				<S extends CacheStage>(stage: S) =>
				(entry: StageEntries[S]) => {
					records[stage]!.push(entry);
					writes.push(persistRecord(store, payload.jobId, stage, entry));
				};
			const pending: Record<BatchStage, string[]> = {
				colour: payload.stages.colour
					? planColourWork(work.blocks, caches.colour).pending.map(({ id }) => id)
					: [],
				connections: payload.stages.connections
					? planConnectionWork(work.blocks, caches.connections, new Date()).pending.map(
							({ id }) => id
						)
					: []
			};
			const fanned = BATCH_STAGES.filter(
				(stage) => deps.fanOut && pending[stage].length > FAN_OUT_THRESHOLD
			);
			const inProcess = (stage: BatchStage) => payload.stages[stage] && !fanned.includes(stage);
			let saveLedger: (() => Promise<void>) | undefined;
			let limiter: ReturnType<typeof createSpendLimiter> | undefined;
			let visionClient: VisionClient | undefined;
			if (payload.vision) {
				const estimate = estimateBackfillCost({ image: 0, video: 1 }, deps.vision!.pricing);
				if (estimate.known) {
					const ledgerKey = `jobs/${payload.jobId}/spend.json`;
					const spend = createSpendLimiter({
						budgetUsd: payload.vision.budgetUsd,
						maxBlocks: payload.vision.maxBlocks,
						reservePerBlockUsd: estimate.ceilingPerCallUsd * COST_ASSUMPTIONS.attemptsPerBlock,
						ceilingPerCallUsd: estimate.ceilingPerCallUsd,
						initial: (await getJson(store, ledgerKey, ledgerSchema))?.value
					});
					let saving = Promise.resolve();
					const save = () =>
						(saving = saving.then(() => putJson(store, ledgerKey, spend.ledger()).then(() => {})));
					limiter = spend;
					saveLedger = save;
					visionClient = budgetedVisionClient(deps.vision!.client, spend, save);
				} else visionSpend = { skipped: 'Model pricing unavailable; no vision this run' };
			}
			const writtenPrefix = `jobs/${payload.jobId}/writeback/`;
			const alreadyWritten = new Set(
				(await store.list(writtenPrefix)).map((key) => key.slice(writtenPrefix.length, -5))
			);
			({ summary } = await deps.enrich(work, {
				signal,
				onEvent: deps.onEvent,
				visionCache: caches.vision,
				colourCache: caches.colour,
				connectionCache: caches.connections,
				colour: inProcess('colour')
					? { onEntry: onEntry('colour'), onOutcome: onOutcome('colour') }
					: undefined,
				connections: inProcess('connections')
					? { onEntry: onEntry('connections'), onOutcome: onOutcome('connections') }
					: undefined,
				vision: visionClient && {
					client: visionClient,
					concurrency: HOSTED_VISION_CONCURRENCY,
					onEntry: onEntry('vision'),
					onOutcome: onOutcome('vision')
				},
				pushArena: payload.pushArena,
				writeBack: {
					skip: alreadyWritten,
					onWritten: async ({ blockId, update }) => {
						lease.assertHeld();
						await putImmutable(
							store,
							`${writtenPrefix}${blockId}.json`,
							new TextEncoder().encode(
								JSON.stringify(
									writtenSchema.parse({
										blockId,
										title: update.title,
										description: update.description
									})
								)
							)
						);
					}
				}
			}));
			await saveLedger?.();
			if (limiter) visionSpend = limiter.ledger();
			// Every settled entry must be durable before the job can merge or report success.
			await Promise.all(writes);
			for (const stage of fanned) {
				checkpoint();
				const batches = chunk(pending[stage]);
				await deps.fanOut!(payload.jobId, stage, batches);
				// The wait may have suspended this process; renewal proves the lease is still ours.
				await lease.renew();
				checkpoint();
				const settled = await loadRecords(store, payload.jobId, stage);
				(records as Record<BatchStage, unknown[]>)[stage] = settled;
				outcomes[stage] = await loadBatchOutcomes(store, payload.jobId, stage);
				summary = {
					...summary,
					[stage]: {
						batches: batches.length,
						pending: pending[stage].length,
						entries: settled.length,
						outcomes: outcomes[stage].length
					} as never
				};
			}
			await putJson(store, keys.outcomes, outcomes);
			checkpoint();
			finalCaches = await mergeJobRecords(store, lease, {
				jobId: payload.jobId,
				records,
				liveBlockIds: retryIds ? null : new Set(discovery.blocks.map(({ id }) => id))
			});
			await putJson(store, keys.merged, {
				at: new Date().toISOString(),
				colour: summary.colour,
				connections: summary.connections,
				vision: summary.vision,
				writeBack: summary.writeBack,
				visionSpend
			});
		}

		deps.onEvent?.({ kind: 'phase', phase: 'building' });
		const written = new Map<string, z.infer<typeof writtenSchema>>();
		for (const key of await store.list(`jobs/${payload.jobId}/writeback/`)) {
			const record = await getJson(store, key, writtenSchema);
			if (record) written.set(record.value.blockId, record.value);
		}
		const documents = buildDocuments(
			applyWrittenBack(discovery.blocks, written),
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

		if (deps.liveSite && !(await loadProduction(store)).pointer)
			await adoptLiveRelease(store, lease, deps.liveSite.url, deps.liveSite.fetchFn);
		const production = await loadProduction(store);
		const origin = candidateOriginSchema.parse({
			format: 1,
			kind: 'public-export',
			complete: true,
			...payload.source,
			baselineVersion: production.release?.release.version ?? null,
			maxRankDrop: payload.gate === 'no-regression' ? NO_REGRESSION_RANK_TOLERANCE : null,
			gate: payload.gate,
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
			retryable: retryableCount(
				(await getJson(store, keys.outcomes, jobOutcomesSchema))?.value ?? null
			),
			decision: !validation.passed
				? 'rejected'
				: production.pointer?.version === candidate.release.version
					? 'unchanged'
					: 'deploy',
			sourceRevision: origin.sourceRevision,
			blocks: discovery.blocks.length,
			channels: discovery.channels.length,
			stages: {
				colour: summary.colour,
				connections: summary.connections,
				vision: summary.vision,
				visionSpend,
				writeBack: summary.writeBack
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

async function originalDiscovery(store: ObjectStore, jobId: string): Promise<DiscoveredArchive> {
	const existing = await getJson(store, jobKeys(jobId).discovery, discoverySchema);
	if (!existing)
		throw new HostedJobConfigurationError(`Job ${jobId} has no pinned discovery to retry`);
	return { ...existing.value, complete: true };
}

async function retryableBlockIds(
	store: ObjectStore,
	jobId: string,
	stages: HostedSyncPayload['stages']
): Promise<Set<string>> {
	const outcomes = await getJson(store, jobKeys(jobId).outcomes, jobOutcomesSchema);
	if (!outcomes) throw new HostedJobConfigurationError(`Job ${jobId} recorded no block outcomes`);
	const ids = new Set<string>();
	for (const stage of ['colour', 'connections'] as const)
		if (stages[stage])
			for (const outcome of outcomes.value[stage]) if (outcome.retryable) ids.add(outcome.blockId);
	if (!ids.size) throw new HostedJobConfigurationError(`Job ${jobId} left nothing to retry`);
	return ids;
}
