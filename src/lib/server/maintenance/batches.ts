import { z } from 'zod';
import { measureBlocks, type ColourStageOptions } from '$lib/server/indexing/colour';
import { COLOUR_VERSION, type ColourCacheEntry } from '$lib/server/indexing/colour/cache';
import { countConnections, type ConnectionStageOptions } from '$lib/server/indexing/connections';
import type { OutcomeSink } from '$lib/server/indexing/outcome';
import { imageSourceHash } from '$lib/server/indexing/vision/rendition';
import { persistRecord, recordKey } from './caches';
import { jobIdSchema, jobKeys } from './hosted-release';
import {
	discoverySchema,
	storedOutcome,
	storedOutcomeSchema,
	type StoredOutcome
} from './job-schemas';
import { getJson, putJson, type ObjectStore } from './store';

/** Large enough that a normal morning (a few hundred stale counts) stays in one process. */
export const FAN_OUT_THRESHOLD = 500;
export const BATCH_SIZE = 50;
export const BATCH_STAGES = ['colour', 'connections'] as const;
export type BatchStage = (typeof BATCH_STAGES)[number];

export const enrichBatchPayloadSchema = z
	.object({
		jobId: jobIdSchema,
		stage: z.enum(BATCH_STAGES),
		batch: z.number().int().nonnegative(),
		blockIds: z.array(z.string().min(1)).min(1).max(BATCH_SIZE)
	})
	.strict();
export type EnrichBatchPayload = z.infer<typeof enrichBatchPayloadSchema>;

const batchOutcomesSchema = z.array(storedOutcomeSchema);
const outcomesPrefix = (jobId: string, stage: BatchStage) => `jobs/${jobId}/outcomes/${stage}/`;

export function chunk<T>(items: T[], size = BATCH_SIZE): T[][] {
	return Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
		items.slice(i * size, (i + 1) * size)
	);
}

/**
 * Enriches one batch of a job's pinned blocks. Children never touch canonical caches or the lease:
 * they only add job records, which the parent merges. A retried batch skips colour already
 * recorded (its key is deterministic) and recounts connections, which costs one request each.
 */
export async function runEnrichBatch(
	rawPayload: unknown,
	deps: {
		store: ObjectStore;
		signal: AbortSignal;
		measure?: ColourStageOptions['measure'];
		count: ConnectionStageOptions['count'];
	}
) {
	const { jobId, stage, batch, blockIds } = enrichBatchPayloadSchema.parse(rawPayload);
	const { store, signal } = deps;
	const discovery = await getJson(store, jobKeys(jobId).discovery, discoverySchema);
	if (!discovery) throw new Error(`Job ${jobId} has no pinned discovery`);
	const wanted = new Set(blockIds);
	const blocks = discovery.value.blocks.filter(({ id }) => wanted.has(id));
	if (blocks.length !== wanted.size) throw new Error('Batch names blocks outside the job');

	const writes: Promise<void>[] = [];
	const outcomes: StoredOutcome[] = [];
	const onOutcome: OutcomeSink = (...args) => outcomes.push(storedOutcome(...args));
	let entries = 0;
	if (stage === 'colour') {
		const pending = [];
		for (const block of blocks) {
			const key = await recordKey(jobId, 'colour', {
				block_id: block.id,
				image_src_hash: imageSourceHash(block.imageUrl ?? ''),
				colour_version: COLOUR_VERSION
			} as ColourCacheEntry);
			if (!(await store.get(key))) pending.push(block);
		}
		await measureBlocks(pending, {
			cache: new Map(),
			signal,
			measure: deps.measure,
			onOutcome,
			onEntry: (entry) => {
				entries += 1;
				writes.push(persistRecord(store, jobId, 'colour', entry));
			}
		});
	} else {
		await countConnections(blocks, {
			cache: new Map(),
			count: deps.count,
			signal,
			onOutcome,
			onEntry: (entry) => {
				entries += 1;
				writes.push(persistRecord(store, jobId, 'connections', entry));
			}
		});
	}
	await Promise.all(writes);
	signal.throwIfAborted();
	await putJson(store, `${outcomesPrefix(jobId, stage)}${batch}.json`, outcomes);
	return { entries, outcomes: outcomes.length };
}

export async function loadBatchOutcomes(store: ObjectStore, jobId: string, stage: BatchStage) {
	const outcomes: StoredOutcome[] = [];
	for (const key of await store.list(outcomesPrefix(jobId, stage))) {
		const batch = await getJson(store, key, batchOutcomesSchema);
		if (batch) outcomes.push(...batch.value);
	}
	return outcomes;
}
