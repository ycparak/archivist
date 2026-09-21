import type { ArchiveBlock } from '$lib/domain/archive';
import { isCacheHit, type VisionCache, type VisionCacheEntry, type VisionCacheKey } from './cache';
import type { VisionClient } from './client';
import { imageSourceHash } from './rendition';

export interface VisionStageOptions {
	client: VisionClient;
	cache: VisionCache;
	/** Cap on how many uncached blocks this run may pay for. */
	limit?: number;
	/** Ignore the cache for every block, or only for blocks in these channels. */
	revise?: boolean | ReadonlySet<string>;
	concurrency?: number;
	log?: (message: string) => void;
	signal?: AbortSignal;
	now?: () => Date;
	/** Called as each entry lands, so a long run can checkpoint instead of losing work on a crash. */
	onEntry?: (entry: VisionCacheEntry) => void;
}

export interface VisionFailure {
	blockId: string;
	error: string;
}

export interface VisionStageSummary {
	blocksWithImage: number;
	cacheHits: number;
	generated: number;
	skippedTooLarge: number;
	skippedOverLimit: number;
	failed: VisionFailure[];
}

export interface VisionStageResult {
	entries: VisionCacheEntry[];
	summary: VisionStageSummary;
}

const noop = () => {};

/**
 * Measured against the real workload rather than guessed: a single description takes 20-160s
 * (mean ~60s) because the model emits several hundred completion tokens, and per-slot throughput
 * stays roughly flat as slots are added — so wall time scales close to linearly with this number.
 * At 8 the full backfill projected to ~16 hours; at 32 it ran in a few. Providers rate-limit well
 * before this hurts, and the client retries 429s with backoff.
 */
const DEFAULT_CONCURRENCY = 32;

function cacheKey(block: ArchiveBlock, client: VisionClient): VisionCacheKey {
	return {
		blockId: block.id,
		imageSourceHash: imageSourceHash(block.imageUrl ?? ''),
		promptVersion: client.promptVersion,
		model: client.model
	};
}

function isRevised(block: ArchiveBlock, revise: VisionStageOptions['revise']): boolean {
	if (revise === true) return true;
	if (!revise) return false;
	return block.channels.some((channel) => revise.has(channel.slug));
}

/** What the run would cost before it costs it. */
export function planVisionWork(
	blocks: ArchiveBlock[],
	options: Pick<VisionStageOptions, 'client' | 'cache' | 'revise' | 'limit'>
): { withImage: ArchiveBlock[]; cached: number; pending: ArchiveBlock[]; overLimit: number } {
	const { client, cache, revise, limit } = options;
	const withImage = blocks.filter((block) => block.imageUrl);

	const pending: ArchiveBlock[] = [];
	let cached = 0;
	for (const block of withImage) {
		const hit =
			!isRevised(block, revise) && isCacheHit(cache.get(block.id), cacheKey(block, client));
		if (hit) cached += 1;
		else pending.push(block);
	}

	const allowed = limit === undefined ? pending : pending.slice(0, limit);
	return { withImage, cached, pending: allowed, overLimit: pending.length - allowed.length };
}

/** Bounded fan-out over one shared cursor, so a slow block never stalls the others. */
async function pool<T>(items: T[], size: number, worker: (item: T) => Promise<void>) {
	let cursor = 0;
	const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
		for (;;) {
			const index = cursor++;
			if (index >= items.length) return;
			await worker(items[index]);
		}
	});
	await Promise.all(runners);
}

/**
 * Describes every block with an image that isn't already cached. Failures are collected rather than
 * thrown: one unreachable image should not discard a run's worth of paid-for work, and a block with
 * no entry is simply retried next time.
 */
export async function describeBlocks(
	blocks: ArchiveBlock[],
	options: VisionStageOptions
): Promise<VisionStageResult> {
	const {
		client,
		cache,
		limit,
		revise,
		concurrency = DEFAULT_CONCURRENCY,
		log = noop,
		signal,
		now = () => new Date(),
		onEntry
	} = options;

	const { withImage, cached, pending, overLimit } = planVisionWork(blocks, {
		client,
		cache,
		revise,
		limit
	});

	const summary: VisionStageSummary = {
		blocksWithImage: withImage.length,
		cacheHits: cached,
		generated: 0,
		skippedTooLarge: 0,
		skippedOverLimit: overLimit,
		failed: []
	};

	if (pending.length === 0) {
		log(`Vision: ${cached} cached, nothing to generate`);
		return { entries: [], summary };
	}

	log(`Vision: ${cached} cached, describing ${pending.length} block(s)`);

	const entries: VisionCacheEntry[] = [];
	let completed = 0;

	await pool(pending, concurrency, async (block) => {
		if (signal?.aborted) return;

		try {
			const outcome = await client.describe({
				imageUrl: block.imageUrl!,
				imageBytes: block.imageBytes,
				block: {
					type: block.type,
					title: block.title,
					description: block.description,
					sourceTitle: block.sourceTitle
				},
				signal
			});

			if (outcome.kind === 'skipped') {
				summary.skippedTooLarge += 1;
				log(`  skipped ${block.id}: ${outcome.reason}`);
				return;
			}

			const entry = {
				...outcome.result,
				block_id: block.id,
				image_src_hash: imageSourceHash(block.imageUrl!),
				prompt_version: client.promptVersion,
				model: client.model,
				provider: outcome.provider,
				generated_at: now().toISOString()
			};
			entries.push(entry);
			onEntry?.(entry);
			summary.generated += 1;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			summary.failed.push({ blockId: block.id, error: message });
			log(`  failed ${block.id}: ${message}`);
		} finally {
			completed += 1;
			// Also log the final block: without it the tail after the last multiple of 25 runs
			// silently, which reads as a hang when each call can take minutes.
			if (completed % 25 === 0 || completed === pending.length) {
				log(`  ${completed}/${pending.length} described`);
			}
		}
	});

	return { entries, summary };
}
