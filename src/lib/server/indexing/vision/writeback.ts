import type { ArchiveBlock } from '$lib/domain/archive';
import { ArenaRateLimitError, type ArenaBlockUpdate } from '$lib/server/arena/client';
import type { VisionCache, VisionCacheEntry } from './cache';
import { PROMPT_VERSION } from './prompt';
import { lowQualityTitleReason, type LowQualityTitleReason } from '$lib/domain/titles';

/**
 * Pushing generated text back to Are.na, which is the one part of this feature that writes to the
 * maintainer's actual archive. Two rules keep it safe:
 *
 * - Only blocks the maintainer authored. `PUT /v3/blocks/:id` is owner-only, and 21% of the archive
 *   was authored by other Are.na users.
 * - A description is written only when there is none. An existing description is prose the
 *   maintainer chose to keep; a title, by contrast, is replaced only when it carries no information
 *   (see `titles.ts`).
 */

export type TitleAction = { kind: 'add' } | { kind: 'replace'; reason: LowQualityTitleReason };

export interface WriteBackPlan {
	blockId: string;
	arenaUrl: string;
	title: { action: TitleAction; from: string | null; to: string } | null;
	description: { to: string } | null;
	update: ArenaBlockUpdate;
}

export interface WriteBackSkips {
	notOwned: number;
	noVisionResult: number;
	nothingToChange: number;
}

function metadataFor(entry: VisionCacheEntry, now: Date): ArenaBlockUpdate['metadata'] {
	return {
		vision_v: PROMPT_VERSION,
		vision_at: now.toISOString(),
		vision_src: entry.image_src_hash
	};
}

/**
 * What write-back would do, without doing any of it; `applyWriteBack` acts on the plan.
 */
export function planWriteBack(
	blocks: ArchiveBlock[],
	cache: VisionCache,
	options: { ownerId: number; now?: () => Date }
): { plans: WriteBackPlan[]; skipped: WriteBackSkips } {
	const { ownerId, now = () => new Date() } = options;
	const timestamp = now();
	const plans: WriteBackPlan[] = [];
	const skipped: WriteBackSkips = { notOwned: 0, noVisionResult: 0, nothingToChange: 0 };

	for (const block of blocks) {
		if (block.ownerId !== ownerId) {
			skipped.notOwned += 1;
			continue;
		}

		const entry = cache.get(block.id);
		if (!entry) {
			skipped.noVisionResult += 1;
			continue;
		}

		const currentTitle = block.title?.trim() ?? '';
		const reason = lowQualityTitleReason(currentTitle, block.description);
		const titleAction: TitleAction | null = !currentTitle
			? { kind: 'add' }
			: reason
				? { kind: 'replace', reason }
				: null;

		const needsDescription = !(block.description?.trim() ?? '');

		if (!titleAction && !needsDescription) {
			skipped.nothingToChange += 1;
			continue;
		}

		const update: ArenaBlockUpdate = { metadata: metadataFor(entry, timestamp) };
		if (titleAction) update.title = entry.title;
		if (needsDescription) update.description = entry.description;

		plans.push({
			blockId: block.id,
			arenaUrl: block.arenaUrl,
			title: titleAction
				? { action: titleAction, from: currentTitle || null, to: entry.title }
				: null,
			description: needsDescription ? { to: entry.description } : null,
			update
		});
	}

	return { plans, skipped };
}

export interface WriteBackFailure {
	blockId: string;
	error: string;
}

export interface WriteBackSummary {
	/** Blocks this run intended to write. Not the sum of the field counts below — one block can
	 * change both its title and its description. */
	blocksPlanned: number;
	titlesAdded: number;
	titlesReplaced: number;
	descriptionsAdded: number;
	blocksUpdated: number;
	failed: WriteBackFailure[];
	skipped: WriteBackSkips;
}

export interface ApplyWriteBackOptions {
	updateBlock: (id: number, body: ArenaBlockUpdate) => Promise<void>;
	/** Are.na is rate-limited and this is a write path; requests are paced, not parallelised. */
	delayMs?: number;
	delayFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
	log?: (message: string) => void;
	signal?: AbortSignal;
	/** How many times one block waits out a rate limit before it is recorded as failed. */
	rateLimitRetries?: number;
	/** Called after each successful write, before the next one starts. */
	onWritten?: (plan: WriteBackPlan) => Promise<void> | void;
}

const noop = () => {};

/**
 * Are.na documents 120 requests per minute for an authenticated free account — one per 500ms. An
 * earlier 300ms ran at 200/min and rate-limited 171 of 584 writes.
 */
const DEFAULT_WRITE_DELAY_MS = 500;
const DEFAULT_RATE_LIMIT_RETRIES = 3;

/**
 * If the first writes all fail the same way, the cause is the credential or the endpoint, not the
 * blocks — so stop rather than spending hundreds of requests proving it.
 */
const MAX_LEADING_FAILURES = 5;

export async function applyWriteBack(
	plans: WriteBackPlan[],
	skipped: WriteBackSkips,
	options: ApplyWriteBackOptions
): Promise<WriteBackSummary> {
	const {
		updateBlock,
		delayMs = DEFAULT_WRITE_DELAY_MS,
		delayFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		log = noop,
		signal,
		rateLimitRetries = DEFAULT_RATE_LIMIT_RETRIES,
		onWritten
	} = options;

	// Every count here describes what was actually written, not what was planned — a summary that
	// reports the plan makes a partly failed run look complete.
	const summary: WriteBackSummary = {
		blocksPlanned: plans.length,
		titlesAdded: 0,
		titlesReplaced: 0,
		descriptionsAdded: 0,
		blocksUpdated: 0,
		failed: [],
		skipped
	};

	for (const [index, plan] of plans.entries()) {
		if (signal?.aborted) break;

		let lastError: unknown;
		for (let attempt = 0; attempt <= rateLimitRetries; attempt += 1) {
			try {
				await updateBlock(Number(plan.blockId), plan.update);
				lastError = undefined;
				break;
			} catch (error) {
				lastError = error;
				// Are.na tells us how long to wait; anything else is not worth retrying per block.
				if (!(error instanceof ArenaRateLimitError) || attempt === rateLimitRetries) break;
				await delayFn(error.retryAfterMs, signal);
				if (signal?.aborted) break;
			}
		}

		if (lastError === undefined) {
			await onWritten?.(plan);
			summary.blocksUpdated += 1;
			if (plan.title?.action.kind === 'add') summary.titlesAdded += 1;
			if (plan.title?.action.kind === 'replace') summary.titlesReplaced += 1;
			if (plan.description) summary.descriptionsAdded += 1;
		} else {
			const message = lastError instanceof Error ? lastError.message : String(lastError);
			summary.failed.push({ blockId: plan.blockId, error: message });

			if (summary.blocksUpdated === 0 && summary.failed.length >= MAX_LEADING_FAILURES) {
				throw new Error(
					`Aborting Are.na write-back: the first ${summary.failed.length} writes all failed (most recently block ${plan.blockId}: ${message}). This usually means ARENA_ACCESS_TOKEN is read-only — writing titles and descriptions needs write scope (use a read + write token, or pass --no-push-arena) — not that these blocks are individually broken.`,
					{ cause: lastError }
				);
			}
		}

		if ((index + 1) % 25 === 0 || index === plans.length - 1) {
			log(`  ${index + 1}/${plans.length} block(s) written`);
		}
		if (index < plans.length - 1) await delayFn(delayMs, signal);
	}

	return summary;
}
