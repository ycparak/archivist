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
import type { ChannelManifestEntry } from './channel-manifest';
import { toArchiveBlock } from './normalize';
import { describeBlocks, planVisionWork, type VisionStageSummary } from './vision';
import { mergeVisionCache, type VisionCache, type VisionCacheEntry } from './vision/cache';
import type { VisionClient } from './vision/client';
import {
	applyWriteBack,
	formatPlanLine,
	planWriteBack,
	summarizePlans,
	type WriteBackSummary
} from './vision/writeback';

export interface SyncOptions {
	accessToken: string;
	turbopuffer: TurbopufferConfig;
	fetchFn?: typeof fetch;
	signal?: AbortSignal;
	log?: (message: string) => void;
	channelDelayMs?: number;
	delayFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
	maxLeadingChannelFailures?: number;
	channelFilter?: ChannelFilter;
	/** Refuse to prune when it would delete more than this fraction of the namespace. */
	maxPruneFraction?: number;
	/** Bypass `maxPruneFraction`, e.g. after deliberately ignoring most channels. */
	allowLargePrune?: boolean;
	/**
	 * Generated text to index. Supplied on every run, not only when the stage is enabled — a sync
	 * without `vision` must still index what previous runs generated, or it would silently strip
	 * every description back out of the namespace.
	 */
	visionCache?: VisionCache;
	/** Omit to index the existing cache without generating anything new. */
	vision?: VisionSyncOptions;
	/** Omit to leave the maintainer's Are.na archive untouched. */
	pushArena?: PushArenaOptions;
}

export interface PushArenaOptions {
	/** Without this, the plan is printed and nothing is written. */
	apply?: boolean;
	limit?: number;
	delayMs?: number;
}

export interface VisionSyncOptions {
	client: VisionClient;
	limit?: number;
	revise?: boolean | ReadonlySet<string>;
	concurrency?: number;
	/** Read animated blocks as motion by transcoding them locally first. Needs ffmpeg on PATH. */
	video?: boolean;
	/** Report what would be generated and what it would cost, then write nothing. */
	dryRun?: boolean;
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
	summary: SyncSummary;
}> {
	const {
		accessToken,
		turbopuffer,
		fetchFn,
		signal,
		log = noop,
		channelDelayMs = DEFAULT_CHANNEL_DELAY_MS,
		delayFn = delay,
		maxLeadingChannelFailures = DEFAULT_MAX_LEADING_CHANNEL_FAILURES,
		channelFilter = EMPTY_CHANNEL_FILTER,
		maxPruneFraction = DEFAULT_MAX_PRUNE_FRACTION,
		allowLargePrune = false,
		visionCache: existingVisionCache = new Map<string, VisionCacheEntry>(),
		vision,
		pushArena
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
		vision: null,
		writeBack: null
	};

	const me = await client.me();
	log(`Resolved account: ${me.slug}`);

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

		const isLastChannel = index === channels.length - 1;
		if (signal?.aborted) break;
		if (!isLastChannel) await delayFn(channelDelayMs, signal);
	}

	summary.uniqueBlocks = blocksById.size;

	const blocks = [...blocksById.values()];

	// Runs on the deduplicated set, so a block in five channels is described once.
	let visionCache: VisionCacheEntry[] | null = null;
	let visionText: VisionCache = existingVisionCache;
	if (vision) {
		if (vision.dryRun) {
			const plan = planVisionWork(blocks, { ...vision, cache: existingVisionCache });
			summary.vision = {
				blocksWithImage: plan.withImage.length,
				cacheHits: plan.cached,
				generated: 0,
				generatedFromVideo: 0,
				skippedTooLarge: 0,
				skippedOverLimit: plan.overLimit,
				failed: []
			};
			log(
				`Vision (dry run): ${plan.withImage.length} block(s) with an image, ${plan.cached} cached, ${plan.pending.length} would be described`
			);
		} else {
			const { entries, summary: visionSummary } = await describeBlocks(blocks, {
				...vision,
				cache: existingVisionCache,
				log,
				signal
			});
			summary.vision = visionSummary;
			visionCache = mergeVisionCache(
				existingVisionCache,
				entries,
				new Set(blocks.map((block) => block.id))
			);
			visionText = new Map(visionCache.map((entry) => [entry.block_id, entry]));
		}
	}

	// Before indexing, because a failure here should not cost the upsert.
	if (pushArena) {
		const { plans, skipped } = planWriteBack(blocks, visionText, { ownerId: me.id });
		const selected = pushArena.limit === undefined ? plans : plans.slice(0, pushArena.limit);

		if (!pushArena.apply) {
			log(`Are.na write-back (dry run): ${selected.length} block(s) would change`);
			for (const plan of selected.slice(0, 20)) log(formatPlanLine(plan));
			if (selected.length > 20) log(`  ... and ${selected.length - 20} more`);
			summary.writeBack = summarizePlans(selected, skipped);
		} else {
			log(`Are.na write-back: updating ${selected.length} block(s)`);
			summary.writeBack = await applyWriteBack(plans, skipped, {
				updateBlock: (id, body) => client.updateBlock(id, body),
				limit: pushArena.limit,
				delayMs: pushArena.delayMs,
				log,
				signal
			});
		}
	}

	const documents = blocks.map((block) => toSearchDocument(block, visionText.get(block.id)));
	const { batches, rowsUpserted } = await upsertSearchDocuments(documents, turbopuffer, { log });
	summary.documentsUpserted = rowsUpserted;
	summary.upsertBatches = batches;
	log(`Upserted ${rowsUpserted} document(s) into Turbopuffer across ${batches} batch(es) total`);

	const pruneBlocker = pruneBlockReason(summary, documents.length, signal);
	if (pruneBlocker) {
		summary.pruneSkipped = pruneBlocker;
	} else {
		const keep = new Set(documents.map((document) => document.id));
		const stale = (await listDocumentIds(turbopuffer)).filter((id) => !keep.has(id));
		const existingCount = keep.size + stale.length;

		if (stale.length === 0) {
			log('No stale documents to prune');
		} else if (!allowLargePrune && stale.length > existingCount * maxPruneFraction) {
			summary.pruneSkipped = `would delete ${stale.length} of ${existingCount} document(s), over the ${maxPruneFraction * 100}% safety limit`;
		} else {
			const { rowsDeleted } = await deleteSearchDocuments(stale, turbopuffer, { log });
			summary.documentsDeleted = rowsDeleted;
			log(`Pruned ${rowsDeleted} stale document(s) from Turbopuffer`);
		}
	}
	if (summary.pruneSkipped) log(`Skipped pruning: ${summary.pruneSkipped}`);

	return { blocks, channels, visionCache, summary };
}
