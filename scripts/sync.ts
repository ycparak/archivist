import { syncArchive } from '$lib/server/indexing/sync';
import { DEFAULT_NAMESPACE } from '$lib/server/search/config';

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

try {
	const { summary } = await syncArchive({
		accessToken,
		turbopuffer: { apiKey, region, namespace },
		log: console.log
	});

	console.log('');
	console.log('Sync summary:');
	console.log(`  Channels discovered: ${summary.channelsDiscovered}`);
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
} catch (error) {
	console.error('Sync failed:', error instanceof Error ? error.message : error);
	process.exit(1);
}
