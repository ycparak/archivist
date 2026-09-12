import { toSearchDocument, type ArchiveBlock } from '$lib/domain/archive';
import {
	ArenaClient,
	ArenaRequestError,
	delay,
	paginateChannelContents,
	paginateOwnedChannels
} from '$lib/server/arena/client';
import {
	upsertSearchDocuments,
	type TurbopufferConfig
} from '$lib/server/search/turbopuffer-client';
import type { ChannelManifestEntry } from './channel-manifest';
import { toArchiveBlock } from './normalize';

export interface SyncOptions {
	accessToken: string;
	turbopuffer: TurbopufferConfig;
	fetchFn?: typeof fetch;
	signal?: AbortSignal;
	log?: (message: string) => void;
	channelDelayMs?: number;
	delayFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
	maxLeadingChannelFailures?: number;
}

export interface ChannelSyncFailure {
	slug: string;
	error: string;
}

export interface SyncSummary {
	channelsDiscovered: number;
	channelsSynced: number;
	channelsFailed: ChannelSyncFailure[];
	blocksFetched: number;
	itemsSkipped: number;
	blocksNormalized: number;
	uniqueBlocks: number;
	documentsUpserted: number;
	upsertBatches: number;
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

export async function syncArchive(options: SyncOptions): Promise<{
	blocks: ArchiveBlock[];
	channels: ChannelManifestEntry[];
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
		maxLeadingChannelFailures = DEFAULT_MAX_LEADING_CHANNEL_FAILURES
	} = options;
	const client = new ArenaClient({ accessToken, fetchFn });

	const summary: SyncSummary = {
		channelsDiscovered: 0,
		channelsSynced: 0,
		channelsFailed: [],
		blocksFetched: 0,
		itemsSkipped: 0,
		blocksNormalized: 0,
		uniqueBlocks: 0,
		documentsUpserted: 0,
		upsertBatches: 0
	};

	const me = await client.me();
	log(`Resolved account: ${me.slug}`);

	const channels: ChannelManifestEntry[] = [];
	for await (const page of paginateOwnedChannels(client, me.id, { signal })) {
		channels.push(...page.data.map(({ slug, title }) => ({ slug, title })));
	}
	summary.channelsDiscovered = channels.length;
	log(`Discovered ${channels.length} owned channel(s)`);

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
	const documents = blocks.map(toSearchDocument);
	const { batches, rowsUpserted } = await upsertSearchDocuments(documents, turbopuffer, { log });
	summary.documentsUpserted = rowsUpserted;
	summary.upsertBatches = batches;
	log(`Upserted ${rowsUpserted} document(s) into Turbopuffer across ${batches} batch(es) total`);

	return { blocks, channels, summary };
}
