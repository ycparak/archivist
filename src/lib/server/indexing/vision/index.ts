import type { ArchiveBlock } from '$lib/domain/archive';
import {
	isCacheHit,
	type VisionCache,
	type VisionCacheEntry,
	type VisionCacheKey,
	type VisionInputMode
} from './cache';
import { pool } from '../pool';
import { errorMessage, type BlockOutcome, type OutcomeSink } from '../outcome';
import type { SyncEventSink, VisionOutcome } from '../progress/events';
import type { VisionClient, VisionMedia } from './client';
import { imageSourceHash } from './rendition';
import {
	cleanupStaleTranscodes,
	isAnimated,
	transcodeToVideoDataUrl,
	type TranscodeOptions
} from './video';

interface VisionStageOptions {
	client: VisionClient;
	cache: VisionCache;
	concurrency?: number;
	log?: (message: string) => void;
	signal?: AbortSignal;
	now?: () => Date;
	transcodeOptions?: TranscodeOptions;
	/** Called as each entry lands, so a long run can checkpoint instead of losing work on a crash. */
	onEntry?: (entry: VisionCacheEntry) => void;
	/** Structured progress for a status display. Presentation lives entirely on the other side. */
	onEvent?: SyncEventSink;
	/** Called for every block that did not produce an entry, with why. */
	onOutcome?: OutcomeSink;
	/** Per-request cost reporting; see `DescribeInput.onCost`. */
	onCost?: (usd: number | null) => void;
}

export interface VisionFailure {
	blockId: string;
	error: string;
}

export interface VisionStageSummary {
	blocksWithImage: number;
	cacheHits: number;
	generated: number;
	generatedFromVideo: number;
	skippedTooLarge: number;
	/** An animation whose source could not be downloaded. */
	skippedUnreachable: number;
	skippedUnsupported: number;
	failed: VisionFailure[];
}

interface VisionStageResult {
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

/**
 * Formats a vision provider will accept. SVG is excluded deliberately: Are.na's resizer returns a
 * 500 for it, so the provider fetches a JSON error and reports an invalid image. One block in the
 * reference archive is affected, and without this it fails on every run forever.
 */
const DESCRIBABLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** Why this block cannot be shown to the model at all, or null when it can. */
export function unsupportedFormatReason(contentType: string | null | undefined): string | null {
	const normalized = contentType?.toLowerCase().trim();
	if (!normalized) return null; // Unknown type: let the provider decide rather than pre-judging.
	return DESCRIBABLE_TYPES.has(normalized) ? null : `${normalized} is not a describable image`;
}

/** Animations are read as motion, which needs ffmpeg on PATH to transcode them first. */
function inputModeFor(block: ArchiveBlock): VisionInputMode {
	return isAnimated(block.imageContentType) ? 'video' : 'image';
}

function cacheKey(block: ArchiveBlock, client: VisionClient): VisionCacheKey {
	return {
		blockId: block.id,
		imageSourceHash: imageSourceHash(block.imageUrl ?? ''),
		promptVersion: client.promptVersion,
		model: client.model,
		inputMode: inputModeFor(block)
	};
}

/** What the run would cost before it costs it. */
export function planVisionWork(
	blocks: ArchiveBlock[],
	options: Pick<VisionStageOptions, 'client' | 'cache'>
): { withImage: ArchiveBlock[]; cached: number; pending: ArchiveBlock[] } {
	const { client, cache } = options;
	const withImage = blocks.filter((block) => block.imageUrl);

	const pending: ArchiveBlock[] = [];
	let cached = 0;
	for (const block of withImage) {
		if (isCacheHit(cache.get(block.id), cacheKey(block, client))) cached += 1;
		else pending.push(block);
	}

	return { withImage, cached, pending };
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
		concurrency = DEFAULT_CONCURRENCY,
		log = noop,
		signal,
		onEntry,
		onEvent = noop
	} = options;

	const { withImage, cached, pending } = planVisionWork(blocks, { client, cache });

	const summary: VisionStageSummary = {
		blocksWithImage: withImage.length,
		cacheHits: cached,
		generated: 0,
		generatedFromVideo: 0,
		skippedTooLarge: 0,
		skippedUnreachable: 0,
		skippedUnsupported: 0,
		failed: []
	};

	if (pending.length === 0) {
		log(`Vision: ${cached} cached, nothing to generate`);
		return { entries: [], summary };
	}

	log(`Vision: ${cached} cached, describing ${pending.length} block(s)`);
	onEvent({ kind: 'vision-planned', pending: pending.length, cached });

	if (pending.some((block) => isAnimated(block.imageContentType))) {
		const { removed } = await cleanupStaleTranscodes();
		if (removed) log(`  cleared ${removed} scratch director(ies) from an interrupted run`);
	}

	const entries: VisionCacheEntry[] = [];

	await pool(pending, concurrency, async (block) => {
		if (signal?.aborted) return;
		onEvent({ kind: 'vision-started', blockId: block.id });
		const outcome = await describeBlock(block, options);
		if (outcome.kind === 'done') {
			entries.push(outcome.entry);
			onEntry?.(outcome.entry);
			summary.generated += 1;
			if (outcome.entry.input_mode === 'video') summary.generatedFromVideo += 1;
		} else {
			options.onOutcome?.(block.id, outcome);
			if (outcome.kind === 'failed') {
				summary.failed.push({ blockId: block.id, error: outcome.error });
				log(`  failed ${block.id}: ${outcome.error}`);
			} else {
				if (outcome.cause === 'unsupported') summary.skippedUnsupported += 1;
				else if (outcome.cause === 'unreachable') summary.skippedUnreachable += 1;
				else summary.skippedTooLarge += 1;
				log(`  skipped ${block.id}: ${outcome.reason}`);
			}
		}
		const settled: VisionOutcome =
			outcome.kind === 'done' ? 'generated' : outcome.kind === 'skipped' ? 'skipped' : 'failed';
		onEvent({ kind: 'vision-settled', blockId: block.id, outcome: settled });
	});

	return { entries, summary };
}

/** Describes one block. Never throws: a failure is an outcome, so a caller can retry just it. */
export async function describeBlock(
	block: ArchiveBlock,
	options: Pick<
		VisionStageOptions,
		'client' | 'signal' | 'now' | 'transcodeOptions' | 'onEvent' | 'onCost'
	>
): Promise<BlockOutcome<VisionCacheEntry>> {
	const {
		client,
		signal,
		now = () => new Date(),
		transcodeOptions,
		onEvent = noop,
		onCost
	} = options;
	try {
		const unsupported = unsupportedFormatReason(block.imageContentType);
		if (unsupported)
			return { kind: 'skipped', cause: 'unsupported', reason: unsupported, retryable: false };

		const mode = inputModeFor(block);
		let media: VisionMedia;
		if (mode === 'video') {
			const transcoded = await transcodeToVideoDataUrl(block.imageUrl!, {
				signal,
				onStage: (stage) => onEvent({ kind: 'vision-stage', blockId: block.id, stage }),
				...transcodeOptions
			});
			if (transcoded.kind === 'skipped')
				return {
					kind: 'skipped',
					cause: transcoded.cause,
					reason: transcoded.reason,
					retryable: transcoded.retryable ?? false
				};
			media = { kind: 'video', dataUrl: transcoded.dataUrl };
		} else {
			media = { kind: 'image', url: block.imageUrl!, bytes: block.imageBytes };
		}

		onEvent({ kind: 'vision-stage', blockId: block.id, stage: 'awaiting-model' });
		const described = await client.describe({
			media,
			block: {
				type: block.type,
				title: block.title,
				description: block.description,
				sourceTitle: block.sourceTitle
			},
			signal,
			onCost
		});
		if (described.kind === 'skipped')
			return { kind: 'skipped', cause: 'too-large', reason: described.reason, retryable: false };

		return {
			kind: 'done',
			entry: {
				...described.result,
				block_id: block.id,
				image_src_hash: imageSourceHash(block.imageUrl!),
				prompt_version: client.promptVersion,
				model: client.model,
				input_mode: mode,
				provider: described.provider,
				generated_at: now().toISOString()
			}
		};
	} catch (error) {
		return { kind: 'failed', error: errorMessage(error) };
	}
}
