import { publishArchiveSearch } from './search-files';
import { writeFile } from 'node:fs/promises';
import { parseSlugList } from '$lib/server/indexing/channel-filter';
import { serializeColourCache, type ColourCacheEntry } from '$lib/server/indexing/colour/cache';
import {
	serializeConnectionCache,
	type ConnectionCacheEntry
} from '$lib/server/indexing/connections/cache';
import { createSyncReporter } from '$lib/server/indexing/progress/reporter';
import { formatSyncSummary } from '$lib/server/indexing/progress/summary';
import { syncArchive, type VisionSyncOptions } from '$lib/server/indexing/sync';
import { createVisionClient } from '$lib/server/indexing/vision/client';
import { serializeVisionCache, type VisionCacheEntry } from '$lib/server/indexing/vision/cache';
import { cacheFiles, loadArchiveCaches } from './maintenance-files';

/**
 * Vision (which spends credit) and Are.na write-back (which edits your blocks) are opt-in, so a
 * mistyped flag must fail instead of being ignored: a stage you asked for would silently not run.
 */
const KNOWN_FLAGS = new Set(['export', 'vision', 'push-arena', 'no-colour', 'no-connections']);

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

/**
 * `--export` publishes a release from the local caches alone: no vision, no Are.na write-back and
 * no fresh colour or connection measurement. The sync refuses an incomplete archive in this mode.
 */
const exportOnly = hasFlag('export');

function resolveVisionOptions(): Omit<VisionSyncOptions, 'onEntry'> | undefined {
	if (exportOnly || !hasFlag('vision')) return undefined;

	const apiKey = process.env.OPENROUTER_API_KEY;
	if (!apiKey) {
		console.error(
			'OPENROUTER_API_KEY must be set to run the vision stage. Copy .env.example to .env and fill it in, or leave out --vision.'
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

if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
	console.error(
		'CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set: every sync embeds its search release with Workers AI.'
	);
	process.exit(1);
}

const vision = resolveVisionOptions();
const pushArena = !exportOnly && hasFlag('push-arena');
const measureColour = !exportOnly && !hasFlag('no-colour');
const countConnections = !exportOnly && !hasFlag('no-connections');
const { visionCache, colourCache, connectionCache } = await loadArchiveCaches();
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
	await writeFile(cacheFiles.vision, serializeVisionCache(entries));
}

async function writeColourCache(entries: Iterable<ColourCacheEntry>) {
	await writeFile(cacheFiles.colour, serializeColourCache(entries));
}

async function writeConnectionCache(entries: Iterable<ConnectionCacheEntry>) {
	await writeFile(cacheFiles.connections, serializeConnectionCache(entries));
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
		output: exportOnly ? 'export' : undefined,
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
		ignoreChannels: parseSlugList(process.env.ARENA_IGNORE_CHANNELS)
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

	console.log(formatSyncSummary(summary).join('\n'));
} catch (error) {
	reporter.stop();
	console.error({ event: 'sync_failed', name: error instanceof Error ? error.name : 'unknown' });
	process.exit(1);
}
