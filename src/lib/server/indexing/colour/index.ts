import type { ArchiveBlock } from '$lib/domain/archive';
import { pool } from '../pool';
import { imageSourceHash } from '../vision/rendition';
import { unsupportedFormatReason } from '../vision';
import { COLOUR_VERSION, isColourCacheHit, type ColourCache, type ColourCacheEntry } from './cache';
import { measureImageColours, type MeasureResult } from './extract';

export interface ColourStageOptions {
	cache: ColourCache;
	concurrency?: number;
	log?: (message: string) => void;
	signal?: AbortSignal;
	now?: () => Date;
	/** Defaults to fetching and decoding the image; replaced in tests. */
	measure?: (url: string, signal?: AbortSignal) => Promise<MeasureResult>;
	/** Called as each entry lands, so an interrupted run keeps what it measured. */
	onEntry?: (entry: ColourCacheEntry) => void;
	onProgress?: (done: number, total: number) => void;
}

export interface ColourFailure {
	blockId: string;
	error: string;
}

export interface ColourStageSummary {
	blocksWithImage: number;
	cacheHits: number;
	measured: number;
	skippedTooLarge: number;
	skippedUnreachable: number;
	skippedUnsupported: number;
	failed: ColourFailure[];
}

export interface ColourStageResult {
	entries: ColourCacheEntry[];
	summary: ColourStageSummary;
}

const noop = () => {};

/**
 * Each block is a CDN download, not a model call, so a handful of workers finishes the archive in
 * minutes. More would only make the run look like the "systematic downloading" Are.na asks
 * people not to do.
 */
const DEFAULT_CONCURRENCY = 4;

export function planColourWork(
	blocks: ArchiveBlock[],
	cache: ColourCache
): { withImage: ArchiveBlock[]; cached: number; pending: ArchiveBlock[] } {
	const withImage = blocks.filter((block) => block.imageUrl);
	const pending: ArchiveBlock[] = [];
	let cached = 0;
	for (const block of withImage) {
		const key = {
			blockId: block.id,
			imageSourceHash: imageSourceHash(block.imageUrl!),
			colourVersion: COLOUR_VERSION
		};
		if (isColourCacheHit(cache.get(block.id), key)) cached += 1;
		else pending.push(block);
	}
	return { withImage, cached, pending };
}

/**
 * Measures every block with an image that is not already cached. Failures are collected rather
 * than thrown, and a block without an entry is simply measured again next run.
 */
export async function measureBlocks(
	blocks: ArchiveBlock[],
	options: ColourStageOptions
): Promise<ColourStageResult> {
	const {
		cache,
		concurrency = DEFAULT_CONCURRENCY,
		log = noop,
		signal,
		now = () => new Date(),
		measure = (url, signal) => measureImageColours(url, { signal }),
		onEntry,
		onProgress = noop
	} = options;

	const { withImage, cached, pending } = planColourWork(blocks, cache);
	const summary: ColourStageSummary = {
		blocksWithImage: withImage.length,
		cacheHits: cached,
		measured: 0,
		skippedTooLarge: 0,
		skippedUnreachable: 0,
		skippedUnsupported: 0,
		failed: []
	};

	if (pending.length === 0) {
		log(`Colour: ${cached} cached, nothing to measure`);
		return { entries: [], summary };
	}
	log(`Colour: ${cached} cached, measuring ${pending.length} block(s)`);

	const entries: ColourCacheEntry[] = [];
	let settled = 0;

	await pool(pending, concurrency, async (block) => {
		if (signal?.aborted) return;
		try {
			const unsupported = unsupportedFormatReason(block.imageContentType);
			if (unsupported) {
				summary.skippedUnsupported += 1;
				log(`  colour skipped ${block.id}: ${unsupported}`);
				return;
			}

			const result = await measure(block.imageUrl!, signal);
			if (result.kind === 'skipped') {
				if (result.cause === 'unreachable') summary.skippedUnreachable += 1;
				else summary.skippedTooLarge += 1;
				log(`  colour skipped ${block.id}: ${result.reason}`);
				return;
			}

			const entry: ColourCacheEntry = {
				block_id: block.id,
				image_src_hash: imageSourceHash(block.imageUrl!),
				colour_version: COLOUR_VERSION,
				frames: result.frames,
				measured_at: now().toISOString(),
				weights: result.weights
			};
			entries.push(entry);
			onEntry?.(entry);
			summary.measured += 1;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			summary.failed.push({ blockId: block.id, error: message });
			log(`  colour failed ${block.id}: ${message}`);
		} finally {
			onProgress(++settled, pending.length);
		}
	});

	return { entries, summary };
}
