import { toSearchDocument, type ArchiveBlock } from '$lib/domain/archive';
import {
	ArenaClient,
	ArenaRequestError,
	delay,
	paginateChannelContents,
	paginateOwnedChannels
} from '$lib/server/arena/client';
import {
	deleteSearchDocuments,
	listDocumentIds,
	upsertSearchDocuments,
	type TurbopufferConfig
} from '$lib/server/search/turbopuffer-client';
import { EMPTY_CHANNEL_FILTER, exclusionReason, type ChannelFilter } from './channel-filter';
import type { SyncEventSink } from './progress/events';
import type { ChannelManifestEntry } from './channel-manifest';
import { measureBlocks, type ColourStageOptions, type ColourStageSummary } from './colour';
import { mergeColourCache, type ColourCache, type ColourCacheEntry } from './colour/cache';
import { toArchiveBlock } from './normalize';
import { describeBlocks, type VisionStageSummary } from './vision';
import { mergeVisionCache, type VisionCache, type VisionCacheEntry } from './vision/cache';
import type { VisionClient } from './vision/client';
import { applyWriteBack, planWriteBack, type WriteBackSummary } from './vision/writeback';

export interface SyncOptions {
	accessToken: string;
	turbopuffer: TurbopufferConfig;
	fetchFn?: typeof fetch;
	signal?: AbortSignal;
	log?: (message: string) => void;
	/** Structured progress for a status display, independent of the human-readable log. */
	onEvent?: SyncEventSink;
	channelDelayMs?: number;
	delayFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
	maxLeadingChannelFailures?: number;
	channelFilter?: ChannelFilter;
	/** Refuse to prune when it would delete more than this fraction of the namespace. */
	maxPruneFraction?: number;
	/**
	 * Generated text to index. Supplied on every run, not only when the stage is enabled — a sync
	 * without `vision` must still index what previous runs generated, or it would silently strip
	 * every description back out of the namespace.
	 */
	visionCache?: VisionCache;
	/** Omit to index the existing cache without generating anything new. */
	vision?: VisionSyncOptions;
	/** Write generated titles and descriptions back to Are.na. Off by default. */
	pushArena?: boolean;
	/** Measured colour weights to index. Supplied on every run, for the same reason as `visionCache`. */
	colourCache?: ColourCache;
	/** Omit to index the existing colour cache without measuring anything new. */
	colour?: ColourSyncOptions;
}

export interface ColourSyncOptions {
	/** Called as each entry lands, so an interrupted run keeps what it measured. */
	onEntry?: (entry: ColourCacheEntry) => void;
	/** Replaces fetching and decoding each image; for tests. */
	measure?: ColourStageOptions['measure'];
}

export interface VisionSyncOptions {
	client: VisionClient;
	/** Called as each entry lands, so a long run can checkpoint instead of losing work on a crash. */
	onEntry?: (entry: VisionCacheEntry) => void;
}

export interface ChannelSyncFailure {
	slug: string;
	error: string;
}

export interface SyncSummary {
	channelsDiscovered: number;
	channelsIgnored: number;
	channelsPrivateSkipped: number;
	channelsSynced: number;
	channelsFailed: ChannelSyncFailure[];
	blocksFetched: number;
	itemsSkipped: number;
	blocksNormalized: number;
	uniqueBlocks: number;
	documentsUpserted: number;
	upsertBatches: number;
	documentsDeleted: number;
	/** Why stale documents were left in the namespace, or null when pruning ran. */
	pruneSkipped: string | null;
	/** Null when the colour stage did not run. */
	colour: ColourStageSummary | null;
	/** Null when the vision stage did not run. */
	vision: VisionStageSummary | null;
	/** Null when write-back was not requested. */
	writeBack: WriteBackSummary | null;
}

const noop = () => {};
const DEFAULT_CHANNEL_DELAY_MS = 300;
const DEFAULT_MAX_LEADING_CHANNEL_FAILURES = 3;
const DEFAULT_MAX_PRUNE_FRACTION = 0.5;

function maxDate(a: Date | undefined, b: Date | undefined): Date | undefined {
	if (!a) return b;
	if (!b) return a;
	return a > b ? a : b;
}

function mergeBlock(blocksById: Map<string, ArchiveBlock>, block: ArchiveBlock): void {
	const existing = blocksById.get(block.id);
	if (!existing) {
		blocksById.set(block.id, block);
		return;
	}

	const channels = [
		...new Map(
			[...existing.channels, ...block.channels].map((channel) => [channel.slug, channel])
		).values()
	];
	blocksById.set(block.id, {
		...existing,
		channels,
		connectedAt: maxDate(existing.connectedAt, block.connectedAt)
	});
}

function pruneBlockReason(
	summary: SyncSummary,
	documentCount: number,
	signal: AbortSignal | undefined
): string | null {
	if (signal?.aborted) return 'sync was aborted before every channel was fetched';
	if (summary.channelsFailed.length > 0) {
		return `${summary.channelsFailed.length} channel(s) failed, so their blocks would look stale`;
	}
	if (documentCount === 0) return 'no blocks were fetched';
	return null;
}

export async function syncArchive(options: SyncOptions): Promise<{
	blocks: ArchiveBlock[];
	channels: ChannelManifestEntry[];
	visionCache: VisionCacheEntry[] | null;
	colourCache: ColourCacheEntry[] | null;
	summary: SyncSummary;
}> {
	const {
		accessToken,
		turbopuffer,
		fetchFn,
		signal,
		log = noop,
		onEvent = noop,
		channelDelayMs = DEFAULT_CHANNEL_DELAY_MS,
		delayFn = delay,
		maxLeadingChannelFailures = DEFAULT_MAX_LEADING_CHANNEL_FAILURES,
		channelFilter = EMPTY_CHANNEL_FILTER,
		maxPruneFraction = DEFAULT_MAX_PRUNE_FRACTION,
		visionCache: existingVisionCache = new Map<string, VisionCacheEntry>(),
		vision,
		pushArena,
		colourCache: existingColourCache = new Map<string, ColourCacheEntry>(),
		colour
	} = options;
	const client = new ArenaClient({ accessToken, fetchFn });

	const summary: SyncSummary = {
		channelsDiscovered: 0,
		channelsIgnored: 0,
		channelsPrivateSkipped: 0,
		channelsSynced: 0,
		channelsFailed: [],
		blocksFetched: 0,
		itemsSkipped: 0,
		blocksNormalized: 0,
		uniqueBlocks: 0,
		documentsUpserted: 0,
		upsertBatches: 0,
		documentsDeleted: 0,
		pruneSkipped: null,
		colour: null,
		vision: null,
		writeBack: null
	};

	const me = await client.me();
	log(`Resolved account: ${me.slug}`);

	onEvent({ kind: 'phase', phase: 'discovering' });
	const channels: ChannelManifestEntry[] = [];
	for await (const page of paginateOwnedChannels(client, me.id, { signal })) {
		for (const channel of page.data) {
			summary.channelsDiscovered += 1;
			const reason = exclusionReason(channel, channelFilter);
			if (reason === 'ignored') summary.channelsIgnored += 1;
			else if (reason === 'private') summary.channelsPrivateSkipped += 1;
			else channels.push({ slug: channel.slug, title: channel.title });
		}
	}
	log(
		`Discovered ${summary.channelsDiscovered} owned channel(s); syncing ${channels.length} (${summary.channelsIgnored} ignored, ${summary.channelsPrivateSkipped} private skipped)`
	);

	onEvent({ kind: 'phase', phase: 'fetching' });
	const blocksById = new Map<string, ArchiveBlock>();
	let leadingFailureCount = 0;

	for (const [index, channel] of channels.entries()) {
		try {
			let blocksInChannel = 0;

			for await (const page of paginateChannelContents(client, channel.slug, { signal })) {
				for (const item of page.data) {
					if (item.type === 'Channel') {
						summary.itemsSkipped += 1;
						continue;
					}

					summary.blocksFetched += 1;
					const block = toArchiveBlock(item, channel);
					summary.blocksNormalized += 1;
					mergeBlock(blocksById, block);
					blocksInChannel += 1;
				}
			}

			summary.channelsSynced += 1;
			log(`[${index + 1}/${channels.length}] ${channel.slug}: ${blocksInChannel} block(s)`);
		} catch (error) {
			if (!(error instanceof ArenaRequestError)) throw error;

			const message = error.message;
			summary.channelsFailed.push({ slug: channel.slug, error: message });
			log(`[${index + 1}/${channels.length}] ${channel.slug}: failed — ${message}`);

			if (summary.channelsSynced === 0) {
				leadingFailureCount += 1;
				if (leadingFailureCount >= maxLeadingChannelFailures) {
					throw new Error(
						`Aborting sync: the first ${leadingFailureCount} channels all failed (most recently "${channel.slug}": ${message}). This usually means the access token is invalid or has lost access, not that these channels are individually broken.`,
						{ cause: error }
					);
				}
			}
		}

		onEvent({
			kind: 'position',
			done: index + 1,
			total: channels.length,
			label: channel.slug
		});

		const isLastChannel = index === channels.length - 1;
		if (signal?.aborted) break;
		if (!isLastChannel) await delayFn(channelDelayMs, signal);
	}

	summary.uniqueBlocks = blocksById.size;

	const blocks = [...blocksById.values()];
	// Same reasoning as pruning: a failed channel's blocks only look gone, and so do an aborted run's,
	// so their cached work stays.
	const fetchedIds = new Set(blocks.map((block) => block.id));
	const liveIds = (cache: ReadonlyMap<string, unknown>) =>
		summary.channelsFailed.length > 0 || signal?.aborted
			? new Set([...fetchedIds, ...cache.keys()])
			: fetchedIds;

	let colourCache: ColourCacheEntry[] | null = null;
	let colourWeights: ColourCache = existingColourCache;
	if (colour) {
		onEvent({ kind: 'phase', phase: 'measuring' });
		const { entries, summary: colourSummary } = await measureBlocks(blocks, {
			cache: existingColourCache,
			log,
			signal,
			onEntry: colour.onEntry,
			measure: colour.measure,
			onProgress: (done, total) => onEvent({ kind: 'position', done, total })
		});
		summary.colour = colourSummary;
		colourCache = mergeColourCache(existingColourCache, entries, liveIds(existingColourCache));
		colourWeights = new Map(colourCache.map((entry) => [entry.block_id, entry]));
	}

	// Runs on the deduplicated set, so a block in five channels is described once.
	let visionCache: VisionCacheEntry[] | null = null;
	let visionText: VisionCache = existingVisionCache;
	if (vision) {
		onEvent({ kind: 'phase', phase: 'describing' });
		const { entries, summary: visionSummary } = await describeBlocks(blocks, {
			...vision,
			cache: existingVisionCache,
			log,
			onEvent,
			signal
		});
		summary.vision = visionSummary;
		visionCache = mergeVisionCache(existingVisionCache, entries, liveIds(existingVisionCache));
		visionText = new Map(visionCache.map((entry) => [entry.block_id, entry]));
	}

	// Before indexing, because a failure here should not cost the upsert.
	if (pushArena) {
		onEvent({ kind: 'phase', phase: 'writing-back' });
		const { plans, skipped } = planWriteBack(blocks, visionText, { ownerId: me.id });
		log(`Are.na write-back: updating ${plans.length} block(s)`);
		summary.writeBack = await applyWriteBack(plans, skipped, {
			updateBlock: (id, body) => client.updateBlock(id, body),
			log,
			signal
		});
	}

	onEvent({ kind: 'phase', phase: 'upserting' });
	const documents = blocks.map((block) =>
		toSearchDocument(block, visionText.get(block.id), colourWeights.get(block.id)?.weights)
	);
	const { batches, rowsUpserted } = await upsertSearchDocuments(documents, turbopuffer, {
		log,
		onProgress: (done, total) => onEvent({ kind: 'position', done, total })
	});
	summary.documentsUpserted = rowsUpserted;
	summary.upsertBatches = batches;
	log(`Upserted ${rowsUpserted} document(s) into Turbopuffer across ${batches} batch(es) total`);

	onEvent({ kind: 'phase', phase: 'pruning' });
	const pruneBlocker = pruneBlockReason(summary, documents.length, signal);
	if (pruneBlocker) {
		summary.pruneSkipped = pruneBlocker;
	} else {
		const keep = new Set(documents.map((document) => document.id));
		const stale = (await listDocumentIds(turbopuffer)).filter((id) => !keep.has(id));
		const existingCount = keep.size + stale.length;

		if (stale.length === 0) {
			log('No stale documents to prune');
		} else if (stale.length > existingCount * maxPruneFraction) {
			summary.pruneSkipped = `would delete ${stale.length} of ${existingCount} document(s), over the ${maxPruneFraction * 100}% safety limit`;
		} else {
			const { rowsDeleted } = await deleteSearchDocuments(stale, turbopuffer, {
				log,
				onProgress: (done, total) => onEvent({ kind: 'position', done, total })
			});
			summary.documentsDeleted = rowsDeleted;
			log(`Pruned ${rowsDeleted} stale document(s) from Turbopuffer`);
		}
	}
	if (summary.pruneSkipped) log(`Skipped pruning: ${summary.pruneSkipped}`);

	onEvent({ kind: 'phase', phase: 'done' });
	return { blocks, channels, visionCache, colourCache, summary };
}
