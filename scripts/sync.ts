import { readFile, writeFile } from 'node:fs/promises';
import {
	buildChannelManifest,
	serializeChannelManifest
} from '$lib/server/indexing/channel-manifest';
import { parseSlugList } from '$lib/server/indexing/channel-filter';
import { createSyncReporter } from '$lib/server/indexing/progress/reporter';
import { syncArchive, type VisionSyncOptions } from '$lib/server/indexing/sync';
import { createVisionClient } from '$lib/server/indexing/vision/client';
import {
	parseVisionCache,
	serializeVisionCache,
	type VisionCacheEntry
} from '$lib/server/indexing/vision/cache';
import { DEFAULT_NAMESPACE } from '$lib/server/search/namespace';

const VISION_CACHE_URL = new URL('../src/lib/server/indexing/vision-cache.jsonl', import.meta.url);

function hasFlag(name: string): boolean {
	return process.argv.includes(`--${name}`);
}

async function readVisionCache(): Promise<Map<string, VisionCacheEntry>> {
	try {
		return parseVisionCache(await readFile(VISION_CACHE_URL, 'utf8'));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
		throw error;
	}
}

function resolveVisionOptions(): Omit<VisionSyncOptions, 'onEntry'> | undefined {
	const dryRun = hasFlag('vision-dry-run');
	if (!hasFlag('vision') && !dryRun) return undefined;

	const apiKey = process.env.OPENROUTER_API_KEY;
	if (!apiKey) {
		console.error(
			'OPENROUTER_API_KEY must be set to run the vision stage. Copy .env.example to .env and fill it in.'
		);
		process.exit(1);
	}

	return {
		client: createVisionClient({ apiKey }),
		// Animations are read as motion by default; the opt-out is for machines without ffmpeg.
		video: !hasFlag('no-vision-video'),
		dryRun
	};
}

const accessToken = process.env.ARENA_ACCESS_TOKEN;
if (!accessToken) {
	console.error('ARENA_ACCESS_TOKEN is not set. Copy .env.example to .env and fill it in.');
	process.exit(1);
}

const apiKey = process.env.TURBOPUFFER_API_KEY;
const region = process.env.TURBOPUFFER_REGION;
if (!apiKey || !region) {
	console.error(
		'TURBOPUFFER_API_KEY and TURBOPUFFER_REGION must both be set. Copy .env.example to .env and fill them in.'
	);
	process.exit(1);
}
const namespace = process.env.TURBOPUFFER_NAMESPACE || DEFAULT_NAMESPACE;

const vision = resolveVisionOptions();
const pushArena = hasFlag('push-arena-apply');
const visionCache = await readVisionCache();
const reporter = createSyncReporter();

// A killed run must not leave the terminal with its cursor still hidden.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		reporter.stop();
		process.exit(130);
	});
}

/**
 * A full backfill runs for hours. Checkpointing every 25 entries means a crash, a rate-limit wall
 * or a Ctrl-C costs at most 25 descriptions instead of the whole run — and the next run resumes
 * from the file, because a cached block is never re-sent.
 */
const CHECKPOINT_EVERY = 25;
const live = new Map(visionCache);
let sinceCheckpoint = 0;

async function writeVisionCache(entries: Iterable<VisionCacheEntry>) {
	await writeFile(VISION_CACHE_URL, serializeVisionCache(entries));
}

const onEntry = (entry: VisionCacheEntry) => {
	live.set(entry.block_id, entry);
	if (++sinceCheckpoint < CHECKPOINT_EVERY) return;
	sinceCheckpoint = 0;
	void writeVisionCache(live.values()).catch((error) => {
		reporter.log(
			`  checkpoint write failed: ${error instanceof Error ? error.message : String(error)}`
		);
	});
};

try {
	const {
		channels,
		visionCache: mergedVisionCache,
		summary
	} = await syncArchive({
		accessToken,
		turbopuffer: { apiKey, region, namespace },
		log: (message) => reporter.log(message),
		onEvent: (event) => reporter.emit(event),
		visionCache,
		vision: vision && { ...vision, onEntry },
		pushArena,
		channelFilter: {
			ignore: parseSlugList(process.env.ARENA_IGNORE_CHANNELS),
			allowPrivate: parseSlugList(process.env.ARENA_ALLOW_PRIVATE_CHANNELS)
		}
	});

	// Before anything is printed: the summary is the part people copy, and it must not be written
	// into a region that is still being redrawn underneath it.
	reporter.stop();

	if (mergedVisionCache) {
		await writeVisionCache(mergedVisionCache);
		console.log(`Wrote vision cache: ${mergedVisionCache.length} entr(ies)`);
	}

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
	console.log(
		`  Upserted:            ${summary.documentsUpserted} document(s) into "${namespace}" across ${summary.upsertBatches} batch(es)`
	);
	if (summary.vision) {
		const v = summary.vision;
		console.log(`  Blocks with image:   ${v.blocksWithImage}`);
		console.log(`  Vision cache hits:   ${v.cacheHits} (no model call, no cost)`);
		if (vision?.dryRun) {
			const would = v.blocksWithImage - v.cacheHits;
			console.log(`  Vision would run:    ${would} block(s) — dry run, nothing spent`);
		} else {
			console.log(`  Vision generated:    ${v.generated}`);
		}
		if (v.generatedFromVideo) console.log(`  Vision from video:   ${v.generatedFromVideo}`);
		if (v.skippedTooLarge)
			console.log(`  Vision skipped:      ${v.skippedTooLarge} (media too large)`);
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
	if (summary.pruneSkipped) {
		console.log(`  Pruned:              skipped (${summary.pruneSkipped})`);
		console.log('  Stale documents remain searchable.');
	} else {
		console.log(`  Pruned:              ${summary.documentsDeleted} stale document(s)`);
	}
} catch (error) {
	reporter.stop();
	console.error('Sync failed:', error instanceof Error ? error.message : error);
	process.exit(1);
}
