import { publishArchiveSearch } from './publish-search';
import { readFile, writeFile } from 'node:fs/promises';
import {
	buildChannelManifest,
	serializeChannelManifest
} from '$lib/server/indexing/channel-manifest';
import { parseSlugList } from '$lib/server/indexing/channel-filter';
import {
	parseColourCache,
	serializeColourCache,
	type ColourCacheEntry
} from '$lib/server/indexing/colour/cache';
import {
	parseConnectionCache,
	serializeConnectionCache,
	type ConnectionCacheEntry
} from '$lib/server/indexing/connections/cache';
import { createSyncReporter } from '$lib/server/indexing/progress/reporter';
import { syncArchive, type VisionSyncOptions } from '$lib/server/indexing/sync';
import { createVisionClient } from '$lib/server/indexing/vision/client';
import {
	parseVisionCache,
	serializeVisionCache,
	type VisionCacheEntry
} from '$lib/server/indexing/vision/cache';

const VISION_CACHE_URL = new URL('../src/lib/server/indexing/vision-cache.jsonl', import.meta.url);
const COLOUR_CACHE_URL = new URL('../src/lib/server/indexing/colour-cache.jsonl', import.meta.url);
const CONNECTIONS_CACHE_URL = new URL(
	'../src/lib/server/indexing/connections-cache.jsonl',
	import.meta.url
);

/**
 * Vision and Are.na write-back are on by default, so a mistyped opt-out (`--no-vison`) must not be
 * ignored: it would run the stage, and write to the maintainer's archive, anyway.
 */
const KNOWN_FLAGS = new Set(['no-vision', 'no-push-arena', 'no-colour', 'no-connections']);

const unknownFlags = process.argv
	.slice(2)
	.filter((arg) => !(arg.startsWith('--') && KNOWN_FLAGS.has(arg.slice(2))));
if (unknownFlags.length > 0) {
	console.error(
		`Unknown argument(s): ${unknownFlags.join(' ')}. Known flags: ${[...KNOWN_FLAGS].map((flag) => `--${flag}`).join(', ')}.`
	);
	process.exit(1);
}

function hasFlag(name: string): boolean {
	return process.argv.includes(`--${name}`);
}

async function readCache<T>(
	url: URL,
	parse: (contents: string) => Map<string, T>
): Promise<Map<string, T>> {
	try {
		return parse(await readFile(url, 'utf8'));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
		throw error;
	}
}

function resolveVisionOptions(): Omit<VisionSyncOptions, 'onEntry'> | undefined {
	if (hasFlag('no-vision')) return undefined;

	const apiKey = process.env.OPENROUTER_API_KEY;
	if (!apiKey) {
		console.error(
			'OPENROUTER_API_KEY must be set to run the vision stage. Copy .env.example to .env and fill it in, or pass --no-vision.'
		);
		process.exit(1);
	}

	return { client: createVisionClient({ apiKey }) };
}

const accessToken = process.env.ARENA_ACCESS_TOKEN;
if (!accessToken) {
	console.error('ARENA_ACCESS_TOKEN is not set. Copy .env.example to .env and fill it in.');
	process.exit(1);
}

const vision = resolveVisionOptions();
const pushArena = !hasFlag('no-push-arena');
const measureColour = !hasFlag('no-colour');
const countConnections = !hasFlag('no-connections');
const visionCache = await readCache(VISION_CACHE_URL, parseVisionCache);
const colourCache = await readCache(COLOUR_CACHE_URL, parseColourCache);
const connectionCache = await readCache(CONNECTIONS_CACHE_URL, parseConnectionCache);
const reporter = createSyncReporter();
const abort = new AbortController();

// A killed run must not leave the terminal with its cursor still hidden.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		reporter.stop();
		process.exit(130);
	});
}

/**
 * A full backfill runs for hours. Checkpointing every 25 entries means a crash, a rate-limit wall
 * or a Ctrl-C costs at most 25 entries instead of the whole run — and the next run resumes from the
 * file, because a cached block is never redone.
 */
const CHECKPOINT_EVERY = 25;

/**
 * Writes are queued, so a slow checkpoint can never land after, and overwrite, the final write.
 */
function cacheWriter<T extends { block_id: string }>(
	initial: Map<string, T>,
	write: (entries: Iterable<T>) => Promise<void>
) {
	const live = new Map(initial);
	let sinceCheckpoint = 0;
	let queue = Promise.resolve();
	const enqueue = (entries: T[]) => {
		const next = queue.then(() => write(entries));
		queue = next.catch(() => {});
		return next;
	};
	return {
		onEntry(entry: T) {
			live.set(entry.block_id, entry);
			if (++sinceCheckpoint < CHECKPOINT_EVERY) return;
			sinceCheckpoint = 0;
			enqueue([...live.values()]).catch((error) => {
				reporter.log(
					`  checkpoint write failed: ${error instanceof Error ? error.message : String(error)}`
				);
			});
		},
		final: (entries: T[]) => enqueue(entries)
	};
}

async function writeVisionCache(entries: Iterable<VisionCacheEntry>) {
	await writeFile(VISION_CACHE_URL, serializeVisionCache(entries));
}

async function writeColourCache(entries: Iterable<ColourCacheEntry>) {
	await writeFile(COLOUR_CACHE_URL, serializeColourCache(entries));
}

async function writeConnectionCache(entries: Iterable<ConnectionCacheEntry>) {
	await writeFile(CONNECTIONS_CACHE_URL, serializeConnectionCache(entries));
}

const visionWriter = cacheWriter(visionCache, writeVisionCache);
const colourWriter = cacheWriter(colourCache, writeColourCache);
const connectionWriter = cacheWriter(connectionCache, writeConnectionCache);

try {
	const {
		channels,
		documents,
		visionCache: mergedVisionCache,
		colourCache: mergedColourCache,
		connectionCache: mergedConnectionCache,
		summary
	} = await syncArchive({
		accessToken,
		signal: abort.signal,
		log: (message) => reporter.log(message),
		onEvent: (event) => reporter.emit(event),
		visionCache,
		vision: vision && { ...vision, onEntry: visionWriter.onEntry },
		pushArena,
		colourCache,
		colour: measureColour ? { onEntry: colourWriter.onEntry } : undefined,
		connectionCache,
		connections: countConnections ? { onEntry: connectionWriter.onEntry } : undefined,
		channelFilter: {
			ignore: parseSlugList(process.env.ARENA_IGNORE_CHANNELS),
			allowPrivate: new Set()
		}
	});

	// Before anything is printed: the summary is the part people copy, and it must not be written
	// into a region that is still being redrawn underneath it.
	reporter.stop();

	if (mergedVisionCache) {
		await visionWriter.final(mergedVisionCache);
		console.log(`Wrote vision cache: ${mergedVisionCache.length} entr(ies)`);
	}
	if (mergedColourCache) {
		await colourWriter.final(mergedColourCache);
		console.log(`Wrote colour cache: ${mergedColourCache.length} entr(ies)`);
	}

	if (mergedConnectionCache) {
		await connectionWriter.final(mergedConnectionCache);
		console.log(`Wrote connections cache: ${mergedConnectionCache.length} entr(ies)`);
	}

	if (summary.channelsFailed.length || abort.signal.aborted || !documents.length)
		throw new Error('Cannot publish an incomplete archive');
	await publishArchiveSearch(documents, channels, abort.signal);
	const manifest = buildChannelManifest(channels);
	const manifestPath = new URL('../src/lib/server/indexing/channel-manifest.json', import.meta.url);
	await writeFile(manifestPath, serializeChannelManifest(manifest));
	console.log(`Wrote channel manifest: ${manifest.length} channel(s)`);

	console.log('');
	console.log('Sync summary:');
	console.log(`  Channels discovered: ${summary.channelsDiscovered}`);
	console.log(`  Channels ignored:    ${summary.channelsIgnored}`);
	console.log(`  Private skipped:     ${summary.channelsPrivateSkipped}`);
	console.log(`  Channels synced:     ${summary.channelsSynced}`);
	if (summary.channelsFailed.length > 0) {
		console.log(`  Channels failed:     ${summary.channelsFailed.length}`);
		for (const failure of summary.channelsFailed) {
			console.log(`    - ${failure.slug}: ${failure.error}`);
		}
	}
	console.log(`  Blocks fetched:      ${summary.blocksFetched}`);
	console.log(`  Items skipped:       ${summary.itemsSkipped} (nested channels, not blocks)`);
	console.log(`  Unique blocks:       ${summary.uniqueBlocks} (after dedup across channels)`);
	if (summary.colour) {
		const c = summary.colour;
		console.log(`  Colour cache hits:   ${c.cacheHits} (no download)`);
		console.log(`  Colour measured:     ${c.measured}`);
		if (c.skippedTooLarge) console.log(`  Colour skipped:      ${c.skippedTooLarge} (too large)`);
		if (c.skippedUnreachable)
			console.log(
				`  Colour skipped:      ${c.skippedUnreachable} (source could not be downloaded)`
			);
		if (c.skippedUnsupported)
			console.log(`  Colour skipped:      ${c.skippedUnsupported} (format not readable)`);
		if (c.failed.length) {
			console.log(`  Colour failed:       ${c.failed.length}`);
			for (const failure of c.failed.slice(0, 10)) {
				console.log(`    - ${failure.blockId}: ${failure.error}`);
			}
			if (c.failed.length > 10) console.log(`    ... and ${c.failed.length - 10} more`);
		}
	}
	if (summary.connections) {
		const n = summary.connections;
		console.log(`  Connections cached:  ${n.cacheHits} (no request)`);
		console.log(`  Connections counted: ${n.counted}`);
		if (n.failed.length) {
			console.log(`  Connections failed:  ${n.failed.length}`);
			for (const failure of n.failed.slice(0, 10)) {
				console.log(`    - ${failure.blockId}: ${failure.error}`);
			}
			if (n.failed.length > 10) console.log(`    ... and ${n.failed.length - 10} more`);
		}
	}
	if (summary.vision) {
		const v = summary.vision;
		console.log(`  Blocks with image:   ${v.blocksWithImage}`);
		console.log(`  Vision cache hits:   ${v.cacheHits} (no model call, no cost)`);
		console.log(`  Vision generated:    ${v.generated}`);
		if (v.generatedFromVideo) console.log(`  Vision from video:   ${v.generatedFromVideo}`);
		if (v.skippedTooLarge)
			console.log(`  Vision skipped:      ${v.skippedTooLarge} (media too large)`);
		if (v.skippedUnreachable)
			console.log(
				`  Vision skipped:      ${v.skippedUnreachable} (source could not be downloaded)`
			);
		if (v.skippedUnsupported)
			console.log(`  Vision skipped:      ${v.skippedUnsupported} (format not describable)`);
		if (v.failed.length) {
			console.log(`  Vision failed:       ${v.failed.length}`);
			for (const failure of v.failed.slice(0, 10)) {
				console.log(`    - ${failure.blockId}: ${failure.error}`);
			}
			if (v.failed.length > 10) console.log(`    ... and ${v.failed.length - 10} more`);
		}
	}
	if (summary.writeBack) {
		const w = summary.writeBack;
		console.log(`  Are.na written:      ${w.blocksUpdated} of ${w.blocksPlanned} planned block(s)`);
		console.log(`    titles replaced:   ${w.titlesReplaced}`);
		console.log(`    titles added:      ${w.titlesAdded}`);
		console.log(`    descriptions:      ${w.descriptionsAdded}`);
		console.log(
			`    skipped:           ${w.skipped.notOwned} not yours, ${w.skipped.noVisionResult} no description, ${w.skipped.nothingToChange} already fine`
		);
		if (w.failed.length) {
			console.log(`    FAILED:            ${w.failed.length}`);
			for (const failure of w.failed.slice(0, 10)) {
				console.log(`      - ${failure.blockId}: ${failure.error}`);
			}
			if (w.failed.length > 10) console.log(`      ... and ${w.failed.length - 10} more`);
		}
	}
} catch (error) {
	reporter.stop();
	console.error({ event: 'sync_failed', name: error instanceof Error ? error.name : 'unknown' });
	process.exit(1);
}
