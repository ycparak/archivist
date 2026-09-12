import type { ArchiveBlock } from '$lib/domain/archive';
import {
	ArenaClient,
	ArenaRequestError,
	delay,
	paginateChannelContents,
	paginateOwnedChannels
} from '$lib/server/arena/client';
import { toArchiveBlock } from './normalize';

export interface SyncOptions {
	accessToken: string;
	/** Injectable for tests; defaults to the global `fetch`. */
	fetchFn?: typeof fetch;
	signal?: AbortSignal;
	/** Progress line callback; defaults to a no-op. `bun run sync` passes `console.log`. */
	log?: (message: string) => void;
	/**
	 * Pause between channels, on top of `paginateChannelContents`' own inter-*page* pacing. Most
	 * of an account's owned channels are a single page, so without a separate per-channel pause,
	 * syncing ~100 channels would fire their first (and often only) request back-to-back with no
	 * pacing between them at all.
	 */
	channelDelayMs?: number;
	/** Injectable for tests so this pacing doesn't need to sleep for real. */
	delayFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
	/**
	 * If this many channels in a row fail *before any channel has synced successfully*, abort the
	 * whole sync instead of grinding through the rest — that pattern means something systemic
	 * (an expired/invalid token, a revoked scope), not a few individually broken channels. Once at
	 * least one channel has synced, isolated failures are tolerated for the rest of the run.
	 */
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
	/** Raw content items fetched across every channel, blocks only (nested channels excluded). */
	blocksFetched: number;
	/** Nested-channel items encountered while walking a channel's contents — not blocks, not errors. */
	itemsSkipped: number;
	blocksNormalized: number;
	/** After deduplicating by block id and unioning channel membership. */
	uniqueBlocks: number;
}

const noop = () => {};
const DEFAULT_CHANNEL_DELAY_MS = 300;
const DEFAULT_MAX_LEADING_CHANNEL_FAILURES = 3;

function maxDate(a: Date | undefined, b: Date | undefined): Date | undefined {
	if (!a) return b;
	if (!b) return a;
	return a > b ? a : b;
}

/**
 * `connectedAt` is a per-channel connection timestamp (`item.connection.connected_at`), not
 * stable block metadata like title/description — it genuinely differs across a block's
 * occurrences in different channels. Keeping the most recent one matches browse mode's
 * newest-first ordering; every other field (title, content, ...) comes from the block resource
 * itself, so the first occurrence's values are as good as any and are left as-is.
 */
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

/**
 * Discovers every channel the token's account owns, walks each one's contents, normalizes every
 * block, and deduplicates by block id while unioning channel membership — the first three steps
 * of `docs/architecture.md`'s Sync lifecycle. Does not persist anything: Turbopuffer schema
 * creation and batch upsert are a separate TODO, so this returns the deduplicated blocks for a
 * caller to do that with next.
 *
 * A channel that fails with an Are.na transport error (e.g. one of the account's ~100+ channels
 * returning a 403/404, or exhausting its rate-limit retries) is recorded in `summary.channelsFailed`
 * and skipped — it does not abort the rest of the sync, unless `maxLeadingChannelFailures`
 * consecutive channels fail before any have succeeded (see that option's doc). Anything that
 * *isn't* a transport failure — a schema validation error, a bug in `toArchiveBlock` — propagates
 * and fails the whole sync loudly instead of being isolated per channel; only a failure this
 * module can attribute to "this one channel had a problem" belongs in the per-channel bucket. See
 * `SPECs/worksheet-sync-command.md` for the fuller reasoning.
 */
export async function syncArchive(
	options: SyncOptions
): Promise<{ blocks: ArchiveBlock[]; summary: SyncSummary }> {
	const {
		accessToken,
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
		uniqueBlocks: 0
	};

	const me = await client.me();
	log(`Resolved account: ${me.slug}`);

	const channels: { slug: string; title: string }[] = [];
	for await (const page of paginateOwnedChannels(client, me.id, { signal })) {
		channels.push(...page.data);
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

	return { blocks: [...blocksById.values()], summary };
}
