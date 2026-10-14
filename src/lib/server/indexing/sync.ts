import { toSearchDocument, type ArchiveBlock, type SearchDocument } from '$lib/domain/archive';
import {
	ArenaClient,
	type ArenaBlockUpdate,
	ArenaRequestError,
	countBlockConnections,
	delay,
	paginateChannelContents,
	paginateOwnedChannels
} from '$lib/server/arena/client';
import { exclusionReason } from './channel-filter';
import type { SyncEventSink } from './progress/events';
import type { ChannelManifestEntry } from '$lib/domain/search';
import { measureBlocks, type ColourStageOptions, type ColourStageSummary } from './colour';
import { mergeColourCache, type ColourCache, type ColourCacheEntry } from './colour/cache';
import {
	CONNECTION_CONCURRENCY,
	countConnections,
	type ConnectionStageOptions,
	type ConnectionStageSummary
} from './connections';
import {
	mergeConnectionCache,
	type ConnectionCache,
	type ConnectionCacheEntry
} from './connections/cache';
import { toArchiveBlock } from './normalize';
import type { OutcomeSink } from './outcome';
import { describeBlocks, type VisionStageSummary } from './vision';
import { mergeVisionCache, type VisionCache, type VisionCacheEntry } from './vision/cache';
import type { VisionClient } from './vision/client';
import {
	applyWriteBack,
	planWriteBack,
	type WriteBackPlan,
	type WriteBackSummary
} from './vision/writeback';

export interface SyncOptions {
	accessToken: string;
	output?: 'export';
	fetchFn?: typeof fetch;
	signal?: AbortSignal;
	log?: (message: string) => void;
	/** Structured progress for a status display, independent of the human-readable log. */
	onEvent?: SyncEventSink;
	channelDelayMs?: number;
	delayFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
	maxLeadingChannelFailures?: number;
	/** Slugs of public or closed channels to leave out; private channels are always left out. */
	ignoreChannels?: ReadonlySet<string>;
	/**
	 * Generated text to index. Supplied on every run, not only when the stage is enabled — a sync
	 * without `vision` must still index what previous runs generated, or it would silently strip
	 * every description out of the export.
	 */
	visionCache?: VisionCache;
	/** Omit to index the existing cache without generating anything new. */
	vision?: VisionSyncOptions;
	/** Write generated titles and descriptions back to Are.na. Off by default. */
	pushArena?: boolean;
	/** Hosted resumability: blocks already written by an earlier attempt, and a hook per write. */
	writeBack?: {
		skip?: ReadonlySet<string>;
		onWritten?: (plan: WriteBackPlan) => Promise<void> | void;
	};
	/** Measured colour weights to index. Supplied on every run, for the same reason as `visionCache`. */
	colourCache?: ColourCache;
	/** Omit to index the existing colour cache without measuring anything new. */
	colour?: ColourSyncOptions;
	/** Every block's total connections to index. Supplied on every run, for the same reason as `visionCache`. */
	connectionCache?: ConnectionCache;
	/** Omit to index the existing counts without asking Are.na for any. */
	connections?: ConnectionsSyncOptions;
}

interface ConnectionsSyncOptions {
	/** Called as each entry lands, so an interrupted run keeps what it counted. */
	onEntry?: (entry: ConnectionCacheEntry) => void;
	/** Replaces asking Are.na for a block's total; for tests. */
	count?: ConnectionStageOptions['count'];
	/** Every block that produced no entry, with why. */
	onOutcome?: OutcomeSink;
}

interface ColourSyncOptions {
	/** Called as each entry lands, so an interrupted run keeps what it measured. */
	onEntry?: (entry: ColourCacheEntry) => void;
	/** Replaces fetching and decoding each image; for tests. */
	measure?: ColourStageOptions['measure'];
	/** Every block that produced no entry, with why. */
	onOutcome?: OutcomeSink;
}

export interface VisionSyncOptions {
	client: VisionClient;
	concurrency?: number;
	/** Every block that produced no entry, with why. */
	onOutcome?: OutcomeSink;
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
	/** Null when the colour stage did not run. */
	colour: ColourStageSummary | null;
	/** Null when the connections stage did not run. */
	connections: ConnectionStageSummary | null;
	/** Null when the vision stage did not run. */
	vision: VisionStageSummary | null;
	/** Null when write-back was not requested. */
	writeBack: WriteBackSummary | null;
}

const noop = () => {};
const DEFAULT_CHANNEL_DELAY_MS = 300;
const DEFAULT_MAX_LEADING_CHANNEL_FAILURES = 3;

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

function exportBlockReason(
	summary: SyncSummary,
	documentCount: number,
	signal: AbortSignal | undefined
): string | null {
	if (signal?.aborted) return 'sync was aborted before every channel was fetched';
	if (summary.channelsFailed.length > 0) {
		return `${summary.channelsFailed.length} channel(s) failed; archive discovery is incomplete`;
	}
	if (documentCount === 0) return 'no blocks were fetched';
	return null;
}

export type DiscoveryOptions = Pick<
	SyncOptions,
	| 'accessToken'
	| 'fetchFn'
	| 'signal'
	| 'log'
	| 'onEvent'
	| 'channelDelayMs'
	| 'delayFn'
	| 'maxLeadingChannelFailures'
	| 'ignoreChannels'
>;

export interface DiscoveredArchive {
	ownerId: number;
	blocks: ArchiveBlock[];
	channels: ChannelManifestEntry[];
	summary: SyncSummary;
	/** Every eligible channel was fetched; only a complete discovery may remove cached work. */
	complete: boolean;
}

export async function discoverArchive(options: DiscoveryOptions): Promise<DiscoveredArchive> {
	const {
		accessToken,
		fetchFn,
		signal,
		log = noop,
		onEvent = noop,
		channelDelayMs = DEFAULT_CHANNEL_DELAY_MS,
		delayFn = delay,
		maxLeadingChannelFailures = DEFAULT_MAX_LEADING_CHANNEL_FAILURES,
		ignoreChannels = new Set<string>()
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
		colour: null,
		connections: null,
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
			const reason = exclusionReason(channel, ignoreChannels);
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
	return {
		ownerId: me.id,
		blocks,
		channels,
		summary,
		complete: summary.channelsFailed.length === 0 && !signal?.aborted
	};
}

export type EnrichmentOptions = Omit<SyncOptions, keyof DiscoveryOptions | 'output'> &
	Pick<SyncOptions, 'accessToken' | 'fetchFn' | 'signal' | 'log' | 'onEvent' | 'delayFn'>;

export async function enrichArchive(discovery: DiscoveredArchive, options: EnrichmentOptions) {
	const {
		accessToken,
		fetchFn,
		signal,
		log = noop,
		onEvent = noop,
		delayFn = delay,
		visionCache: existingVisionCache = new Map<string, VisionCacheEntry>(),
		vision,
		pushArena,
		colourCache: existingColourCache = new Map<string, ColourCacheEntry>(),
		colour,
		connectionCache: existingConnectionCache = new Map<string, ConnectionCacheEntry>(),
		connections
	} = options;
	const client = new ArenaClient({ accessToken, fetchFn });
	const { blocks, channels } = discovery;
	const summary: SyncSummary = { ...discovery.summary };
	// Preserve cached entries after incomplete discovery: a failed channel's blocks only look gone, and so do an aborted run's,
	// so their cached work stays.
	const fetchedIds = new Set(blocks.map((block) => block.id));
	const liveIds = (cache: ReadonlyMap<string, unknown>) =>
		!discovery.complete || signal?.aborted ? new Set([...fetchedIds, ...cache.keys()]) : fetchedIds;

	let colourCache: ColourCacheEntry[] | null = null;
	let colourWeights: ColourCache = existingColourCache;
	if (colour) {
		onEvent({ kind: 'phase', phase: 'measuring' });
		const { entries, summary: colourSummary } = await measureBlocks(blocks, {
			cache: existingColourCache,
			log,
			signal,
			onEntry: colour.onEntry,
			onOutcome: colour.onOutcome,
			measure: colour.measure,
			onProgress: (done, total) => onEvent({ kind: 'position', done, total })
		});
		summary.colour = colourSummary;
		colourCache = mergeColourCache(existingColourCache, entries, liveIds(existingColourCache));
		colourWeights = new Map(colourCache.map((entry) => [entry.block_id, entry]));
	}

	let connectionCache: ConnectionCacheEntry[] | null = null;
	let connectionTotals: ConnectionCache = existingConnectionCache;
	if (connections) {
		onEvent({ kind: 'phase', phase: 'counting' });
		const { entries, summary: connectionSummary } = await countConnections(blocks, {
			cache: existingConnectionCache,
			count:
				connections.count ??
				((blockId, countSignal) =>
					countBlockConnections(client, blockId, {
						signal: countSignal,
						delayFn,
						rateLimitSafetyMargin: CONNECTION_CONCURRENCY
					})),
			concurrency: CONNECTION_CONCURRENCY,
			log,
			signal,
			onEntry: connections.onEntry,
			onOutcome: connections.onOutcome,
			onProgress: (done, total) => onEvent({ kind: 'position', done, total })
		});
		summary.connections = connectionSummary;
		connectionCache = mergeConnectionCache(
			existingConnectionCache,
			entries,
			liveIds(existingConnectionCache)
		);
		connectionTotals = new Map(connectionCache.map((entry) => [entry.block_id, entry]));
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

	const written = new Map<string, ArenaBlockUpdate>();
	if (pushArena) {
		onEvent({ kind: 'phase', phase: 'writing-back' });
		const planned = planWriteBack(blocks, visionText, { ownerId: discovery.ownerId });
		const plans = planned.plans.filter(({ blockId }) => !options.writeBack?.skip?.has(blockId));
		log(`Are.na write-back: updating ${plans.length} block(s)`);
		summary.writeBack = await applyWriteBack(plans, planned.skipped, {
			updateBlock: (id, body) => client.updateBlock(id, body),
			log,
			signal,
			onWritten: async (plan) => {
				written.set(plan.blockId, plan.update);
				await options.writeBack?.onWritten?.(plan);
			}
		});
	}

	onEvent({ kind: 'phase', phase: 'building' });
	// Written titles and descriptions are what Are.na now holds, so this build uses them too.
	const updated = applyWrittenBack(blocks, written);
	const documents = buildDocuments(updated, visionText, colourWeights, connectionTotals);
	return {
		blocks: updated,
		documents,
		channels,
		visionCache,
		colourCache,
		connectionCache,
		summary
	};
}

export function applyWrittenBack(
	blocks: ArchiveBlock[],
	written: ReadonlyMap<string, Pick<ArenaBlockUpdate, 'title' | 'description'>>
): ArchiveBlock[] {
	return blocks.map((block) => {
		const update = written.get(block.id);
		return update
			? {
					...block,
					title: update.title ?? block.title,
					description: update.description ?? block.description
				}
			: block;
	});
}

export function buildDocuments(
	blocks: ArchiveBlock[],
	vision: VisionCache,
	colour: ColourCache,
	connections: ConnectionCache
): SearchDocument[] {
	return blocks.map((block) =>
		toSearchDocument(
			block,
			vision.get(block.id),
			colour.get(block.id)?.weights,
			connections.get(block.id)?.total
		)
	);
}

export async function syncArchive(options: SyncOptions): Promise<{
	blocks: ArchiveBlock[];
	documents: SearchDocument[];
	channels: ChannelManifestEntry[];
	visionCache: VisionCacheEntry[] | null;
	colourCache: ColourCacheEntry[] | null;
	connectionCache: ConnectionCacheEntry[] | null;
	summary: SyncSummary;
}> {
	if (options.output === 'export' && (options.vision || options.pushArena)) {
		throw new Error('Export cannot generate vision text or write to Are.na');
	}
	const discovery = await discoverArchive(options);
	const result = await enrichArchive(discovery, options);
	if (options.output === 'export') {
		const reason = exportBlockReason(result.summary, result.documents.length, options.signal);
		if (reason) throw new Error('Export refused: ' + reason);
	}
	options.onEvent?.({ kind: 'phase', phase: 'done' });
	return result;
}
