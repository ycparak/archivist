import type { ArchiveBlock } from '$lib/domain/archive';
import { pool } from '../pool';
import {
	CONNECTION_COUNT_MAX_AGE_MS,
	isConnectionCacheHit,
	type ConnectionCache,
	type ConnectionCacheEntry
} from './cache';

export interface ConnectionStageOptions {
	cache: ConnectionCache;
	/** Total connections to one block; the default in a sync is `countBlockConnections`. */
	count: (blockId: number, signal?: AbortSignal) => Promise<number>;
	concurrency?: number;
	maxAgeMs?: number;
	now?: () => Date;
	log?: (message: string) => void;
	signal?: AbortSignal;
	/** Called as each entry lands, so an interrupted run keeps what it counted. */
	onEntry?: (entry: ConnectionCacheEntry) => void;
	onProgress?: (done: number, total: number) => void;
}

export interface ConnectionFailure {
	blockId: string;
	error: string;
}

export interface ConnectionStageSummary {
	blocks: number;
	cacheHits: number;
	counted: number;
	failed: ConnectionFailure[];
}

export interface ConnectionStageResult {
	entries: ConnectionCacheEntry[];
	summary: ConnectionStageSummary;
}

const noop = () => {};

/**
 * One small request per block, against an allowance of 300 reads a minute that the run shares with
 * nothing else. A handful of workers is enough to hold that rate; more only queue behind it.
 */
export const CONNECTION_CONCURRENCY = 4;

export function planConnectionWork(
	blocks: ArchiveBlock[],
	cache: ConnectionCache,
	now: Date,
	maxAgeMs: number = CONNECTION_COUNT_MAX_AGE_MS
): { cached: number; pending: ArchiveBlock[] } {
	const pending = blocks.filter(
		(block) => !isConnectionCacheHit(cache.get(block.id), now, maxAgeMs)
	);
	return { cached: blocks.length - pending.length, pending };
}

/**
 * Counts every block whose cached total is missing or old. Failures are collected rather than
 * thrown, and a block without an entry is simply counted again next run.
 */
export async function countConnections(
	blocks: ArchiveBlock[],
	options: ConnectionStageOptions
): Promise<ConnectionStageResult> {
	const {
		cache,
		count,
		concurrency = CONNECTION_CONCURRENCY,
		maxAgeMs = CONNECTION_COUNT_MAX_AGE_MS,
		now = () => new Date(),
		log = noop,
		signal,
		onEntry,
		onProgress = noop
	} = options;

	const { cached, pending } = planConnectionWork(blocks, cache, now(), maxAgeMs);
	const summary: ConnectionStageSummary = {
		blocks: blocks.length,
		cacheHits: cached,
		counted: 0,
		failed: []
	};

	if (pending.length === 0) {
		log(`Connections: ${cached} cached, nothing to count`);
		return { entries: [], summary };
	}
	log(`Connections: ${cached} cached, counting ${pending.length} block(s)`);

	const entries: ConnectionCacheEntry[] = [];
	let settled = 0;

	await pool(pending, concurrency, async (block) => {
		if (signal?.aborted) return;
		try {
			const total = await count(Number(block.id), signal);
			const entry: ConnectionCacheEntry = {
				block_id: block.id,
				total,
				counted_at: now().toISOString()
			};
			entries.push(entry);
			onEntry?.(entry);
			summary.counted += 1;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			summary.failed.push({ blockId: block.id, error: message });
			log(`  connections failed ${block.id}: ${message}`);
		} finally {
			onProgress(++settled, pending.length);
		}
	});

	return { entries, summary };
}
