import { z } from 'zod';
import type { ArchiveBlock } from '$lib/domain/archive';
import { pool } from '$lib/server/indexing/pool';
import { describeBlock } from '$lib/server/indexing/vision';
import type { VisionCacheEntry } from '$lib/server/indexing/vision/cache';
import type { VisionClient } from '$lib/server/indexing/vision/client';
import { isAnimated } from '$lib/server/indexing/vision/video';
import { sha256 } from '$lib/server/release/release-builder';
import { loadCanonicalCaches, loadRecords, mergeJobRecords, persistRecord } from './caches';
import { visionState, type VisionState } from './coverage';
import { jobIdSchema, jobKeys } from './hosted-release';
import {
	discoverySchema,
	HostedJobConfigurationError,
	storedOutcome,
	type StoredOutcome
} from './job-schemas';
import { acquireLease, LeaseHeldError } from './lease';
import { getJson, putImmutable, putJson, type ObjectStore } from './store';

/** Hard ceilings a payload cannot raise; a larger backfill is several deliberate runs. */
export const MAX_BACKFILL_BLOCKS = 1_000;
export const MAX_BACKFILL_BUDGET_USD = 20;

const STALE_STATES: VisionState[] = [
	'stale-source',
	'stale-prompt',
	'stale-model',
	'stale-input-mode'
];

export const backfillSelectionSchema = z
	.object({
		blockIds: z.array(z.string().min(1)).max(MAX_BACKFILL_BLOCKS).optional(),
		channels: z.array(z.string().min(1)).optional(),
		/** Which cache states to regenerate; valid entries are never selected. */
		include: z.array(z.enum(['missing', 'stale'])).min(1)
	})
	.strict();
type BackfillSelection = z.infer<typeof backfillSelectionSchema>;

export const visionBackfillPayloadSchema = z
	.object({
		jobId: jobIdSchema,
		/** The completed job whose pinned discovery defines the corpus. */
		discoveryJobId: jobIdSchema,
		selection: backfillSelectionSchema,
		maxBlocks: z.number().int().positive().max(MAX_BACKFILL_BLOCKS),
		budgetUsd: z.number().positive().max(MAX_BACKFILL_BUDGET_USD),
		concurrency: z.number().int().positive().max(16).default(4)
	})
	.strict();

export function planVisionBackfill(options: {
	blocks: ArchiveBlock[];
	caches: Parameters<typeof visionState>[1];
	client: Pick<VisionClient, 'model' | 'promptVersion'>;
	selection: BackfillSelection;
	maxBlocks: number;
}) {
	const { selection, client } = options;
	const ids = selection.blockIds && new Set(selection.blockIds);
	const channels = selection.channels && new Set(selection.channels);
	const counts: Partial<Record<VisionState, number>> = {};
	const candidates: ArchiveBlock[] = [];
	for (const block of options.blocks) {
		if (ids && !ids.has(block.id)) continue;
		if (channels && !block.channels.some(({ slug }) => channels.has(slug))) continue;
		const state = visionState(block, options.caches, client);
		counts[state] = (counts[state] ?? 0) + 1;
		const wanted =
			(state === 'missing' && selection.include.includes('missing')) ||
			(STALE_STATES.includes(state) && selection.include.includes('stale'));
		if (wanted) candidates.push(block);
	}
	// Stable order, so a resumed or repeated plan picks the same blocks.
	candidates.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
	const selected = candidates.slice(0, options.maxBlocks);
	return {
		selected,
		states: counts,
		overLimit: candidates.length - selected.length,
		video: selected.filter((b) => isAnimated(b.imageContentType)).length,
		image: selected.filter((b) => !isAnimated(b.imageContentType)).length
	};
}
type VisionBackfillPlan = ReturnType<typeof planVisionBackfill>;

export interface ModelPricing {
	promptUsdPerToken: number;
	completionUsdPerToken: number;
}

const modelsSchema = z.object({
	data: z.array(
		z.object({
			id: z.string(),
			pricing: z.object({ prompt: z.coerce.number(), completion: z.coerce.number() }).passthrough()
		})
	)
});

/** Public, unauthenticated pricing. Null means the estimate must be reported as unknown. */
export async function fetchModelPricing(
	model: string,
	fetchFn: typeof fetch = fetch
): Promise<ModelPricing | null> {
	try {
		const response = await fetchFn('https://openrouter.ai/api/v1/models', {
			signal: AbortSignal.timeout(20_000)
		});
		if (!response.ok) return null;
		const entry = modelsSchema.parse(await response.json()).data.find(({ id }) => id === model);
		return entry
			? { promptUsdPerToken: entry.pricing.prompt, completionUsdPerToken: entry.pricing.completion }
			: null;
	} catch {
		return null;
	}
}

/**
 * Token assumptions behind the estimate, stated rather than hidden. A run's ledger records the
 * provider's actual costs, which supersede these after the first backfill.
 */
export const COST_ASSUMPTIONS = {
	imageInputTokens: 3_000,
	videoInputTokens: 12_000,
	typicalOutputTokens: 700,
	maxOutputTokens: 2_048,
	/** The client's retry budget: one attempt plus four retries can each be billed. */
	attemptsPerBlock: 5
} as const;

export function estimateBackfillCost(
	plan: Pick<VisionBackfillPlan, 'image' | 'video'>,
	pricing: ModelPricing | null
) {
	if (!pricing) return { known: false as const, assumptions: COST_ASSUMPTIONS };
	const a = COST_ASSUMPTIONS;
	const call = (input: number, output: number) =>
		input * pricing.promptUsdPerToken + output * pricing.completionUsdPerToken;
	const expectedUsd =
		plan.image * call(a.imageInputTokens, a.typicalOutputTokens) +
		plan.video * call(a.videoInputTokens, a.typicalOutputTokens);
	const ceilingPerCallUsd = call(a.videoInputTokens, a.maxOutputTokens);
	return {
		known: true as const,
		expectedUsd,
		/** Every block at the largest input, maximum output and every retry billed. */
		worstCaseUsd: (plan.image + plan.video) * ceilingPerCallUsd * a.attemptsPerBlock,
		ceilingPerCallUsd,
		assumptions: a
	};
}

export const ledgerSchema = z
	.object({
		spentUsd: z.number().nonnegative(),
		/** Blocks started, so a cap holds across resumed attempts. */
		blocks: z.number().int().nonnegative().default(0),
		requests: z.number().int().nonnegative(),
		unknownCostRequests: z.number().int().nonnegative(),
		/** Exposure of blocks in flight when this was written; a resumed run counts it as spent. */
		inFlightUsd: z.number().nonnegative()
	})
	.strict();
type Ledger = z.infer<typeof ledgerSchema>;

/**
 * Reserves a block's worst case before it starts and books what the provider reports when it
 * settles, so spend plus in-flight exposure never exceeds the budget.
 */
export function createSpendLimiter(options: {
	budgetUsd: number;
	reservePerBlockUsd: number;
	ceilingPerCallUsd: number;
	maxBlocks?: number;
	initial?: Ledger;
}) {
	const ledger: Ledger = {
		...(options.initial ?? {
			spentUsd: 0,
			blocks: 0,
			requests: 0,
			unknownCostRequests: 0,
			inFlightUsd: 0
		})
	};
	// Whatever was in flight when a previous attempt died may have been billed in full.
	ledger.spentUsd += ledger.inFlightUsd;
	ledger.inFlightUsd = 0;
	// If real blocks ever cost more than the assumed ceiling, reserve what they actually cost.
	let largestBlockUsd = 0;
	const reserve = () => Math.max(options.reservePerBlockUsd, largestBlockUsd);
	return {
		ledger: () => ({ ...ledger }),
		tryReserve() {
			const reserved = reserve();
			if (ledger.spentUsd + ledger.inFlightUsd + reserved > options.budgetUsd) return null;
			if (options.maxBlocks !== undefined && ledger.blocks >= options.maxBlocks) return null;
			ledger.blocks += 1;
			ledger.inFlightUsd += reserved;
			const costs: (number | null)[] = [];
			return {
				onCost: (usd: number | null) => costs.push(usd),
				settle() {
					ledger.inFlightUsd -= reserved;
					let blockUsd = 0;
					for (const cost of costs) {
						ledger.requests += 1;
						if (cost === null) ledger.unknownCostRequests += 1;
						blockUsd += cost ?? options.ceilingPerCallUsd;
					}
					ledger.spentUsd += blockUsd;
					largestBlockUsd = Math.max(largestBlockUsd, blockUsd);
				}
			};
		}
	};
}

class VisionBudgetExhaustedError extends Error {
	override name = 'VisionBudgetExhaustedError';
	constructor() {
		super('Vision budget or block cap reached for this run; the block waits for the next run');
	}
}

/**
 * Puts a spend limiter in front of a vision client, for runs that describe through the ordinary
 * sync stage rather than a backfill. A refused reservation fails just that block, retryably.
 */
export function budgetedVisionClient(
	client: VisionClient,
	limiter: ReturnType<typeof createSpendLimiter>,
	onSettle: () => Promise<void>
): VisionClient {
	return {
		model: client.model,
		promptVersion: client.promptVersion,
		async describe(input) {
			const reservation = limiter.tryReserve();
			if (!reservation) throw new VisionBudgetExhaustedError();
			try {
				await onSettle();
				return await client.describe({
					...input,
					onCost: (usd) => {
						reservation.onCost(usd);
						input.onCost?.(usd);
					}
				});
			} finally {
				reservation.settle();
				await onSettle();
			}
		}
	};
}

interface VisionBackfillDependencies {
	store: ObjectStore;
	client: VisionClient;
	signal: AbortSignal;
	pricing: ModelPricing | null;
	now?: () => Date;
	/** Waits between attempts to take the lease for the final merge. */
	sleep?: (ms: number) => Promise<void>;
}

/**
 * Describes the selected blocks within an explicit block cap and budget, persisting every entry
 * as it settles, then merges them without pruning. It holds the archive lease only for that merge,
 * so a long backfill never blocks the daily sync, and it never writes to Are.na.
 */
interface BackfillReport {
	format: 1;
	jobId: string;
	discoveryJobId: string;
	model: string;
	promptVersion: number;
	planned: number;
	overLimit: number;
	generated: number;
	generatedThisAttempt: number;
	budgetStopped: number;
	outcomes: StoredOutcome[];
	spentUsd: number;
	requests: number;
	unknownCostRequests: number;
	budgetUsd: number;
	estimate: ReturnType<typeof estimateBackfillCost>;
	completedAt: string;
}

export async function runVisionBackfill(
	rawPayload: unknown,
	deps: VisionBackfillDependencies
): Promise<BackfillReport> {
	const payload = visionBackfillPayloadSchema.parse(rawPayload);
	const { store, client, signal } = deps;
	const keys = jobKeys(payload.jobId);
	const encoder = new TextEncoder();
	const payloadHash = await sha256(encoder.encode(JSON.stringify(payload)));
	const job = await getJson(store, keys.job, z.object({ payloadHash: z.string() }).passthrough());
	if (job && job.value.payloadHash !== payloadHash)
		throw new HostedJobConfigurationError('Job ID was reused with a different payload');
	if (!job)
		await putJson(
			store,
			keys.job,
			{ format: 1, jobId: payload.jobId, payloadHash, createdAt: new Date().toISOString() },
			{ ifAbsent: true }
		);
	const done = await getJson(store, `jobs/${payload.jobId}/backfill.json`, z.unknown());
	if (done) return done.value as BackfillReport;

	const source = await store.get(jobKeys(payload.discoveryJobId).discovery);
	if (!source)
		throw new HostedJobConfigurationError(`Job ${payload.discoveryJobId} has no pinned discovery`);
	await putImmutable(store, keys.discovery, source.bytes);
	const discovery = discoverySchema.parse(JSON.parse(new TextDecoder().decode(source.bytes)));

	const { caches } = await loadCanonicalCaches(store);
	const records = await loadRecords(store, payload.jobId, 'vision');
	const recorded = new Set(records.map(({ block_id }) => block_id));
	const plan = planVisionBackfill({
		blocks: discovery.blocks,
		caches,
		client,
		selection: payload.selection,
		maxBlocks: payload.maxBlocks
	});
	const estimate = estimateBackfillCost(plan, deps.pricing);
	if (!estimate.known)
		throw new HostedJobConfigurationError('Model pricing is unavailable; refusing to spend blind');
	const ledgerKey = `jobs/${payload.jobId}/spend.json`;
	const limiter = createSpendLimiter({
		budgetUsd: payload.budgetUsd,
		reservePerBlockUsd: estimate.ceilingPerCallUsd * COST_ASSUMPTIONS.attemptsPerBlock,
		ceilingPerCallUsd: estimate.ceilingPerCallUsd,
		initial: (await getJson(store, ledgerKey, ledgerSchema))?.value
	});

	const outcomes: StoredOutcome[] = [];
	let generated = 0;
	let budgetStopped = 0;
	// Ledger writes are serialized so a slower write can never land after a newer one.
	let saving = Promise.resolve();
	const saveLedger = () =>
		(saving = saving.then(() => putJson(store, ledgerKey, limiter.ledger()).then(() => {})));
	await pool(
		plan.selected.filter(({ id }) => !recorded.has(id)),
		payload.concurrency,
		async (block) => {
			if (signal.aborted) return;
			const reservation = limiter.tryReserve();
			if (!reservation) {
				budgetStopped += 1;
				return;
			}
			try {
				await saveLedger();
				const outcome = await describeBlock(block, {
					client,
					signal,
					now: deps.now,
					onCost: reservation.onCost
				});
				if (outcome.kind === 'done') {
					await persistRecord(store, payload.jobId, 'vision', outcome.entry);
					generated += 1;
				} else outcomes.push(storedOutcome(block.id, outcome));
			} finally {
				reservation.settle();
				await saveLedger();
			}
		}
	);
	await saving;
	signal.throwIfAborted();

	const entries: VisionCacheEntry[] = await loadRecords(store, payload.jobId, 'vision');
	if (entries.length) await mergeWhenFree(store, payload.jobId, entries, deps.sleep);
	const ledger = limiter.ledger();
	const report: BackfillReport = {
		format: 1,
		jobId: payload.jobId,
		discoveryJobId: payload.discoveryJobId,
		model: client.model,
		promptVersion: client.promptVersion,
		planned: plan.selected.length,
		overLimit: plan.overLimit,
		generated: entries.length,
		generatedThisAttempt: generated,
		budgetStopped,
		outcomes,
		spentUsd: Number(ledger.spentUsd.toFixed(6)),
		requests: ledger.requests,
		unknownCostRequests: ledger.unknownCostRequests,
		budgetUsd: payload.budgetUsd,
		estimate,
		completedAt: new Date().toISOString()
	};
	await putJson(store, `jobs/${payload.jobId}/backfill.json`, report);
	return report;
}

async function mergeWhenFree(
	store: ObjectStore,
	jobId: string,
	entries: VisionCacheEntry[],
	sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
) {
	for (let attempt = 0; ; attempt++) {
		try {
			const lease = await acquireLease(store, {
				holder: `backfill:${jobId}`,
				sameHolderTakeover: true
			});
			try {
				await mergeJobRecords(store, lease, {
					jobId,
					records: { vision: entries },
					liveBlockIds: null
				});
				return;
			} finally {
				await lease.release();
			}
		} catch (error) {
			// The daily sync may hold the lease for a few minutes; wait it out rather than fail.
			if (!(error instanceof LeaseHeldError) || attempt >= 20) throw error;
			await sleep(30_000);
		}
	}
}
