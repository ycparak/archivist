import { syncArchive } from '$lib/server/indexing/sync';

const accessToken = process.env.ARENA_ACCESS_TOKEN;
if (!accessToken) {
	console.error('ARENA_ACCESS_TOKEN is not set. Copy .env.example to .env and fill it in.');
	process.exit(1);
}

try {
	const { summary } = await syncArchive({ accessToken, log: console.log });

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
	console.log('');
	console.log(
		'Not yet persisted to Turbopuffer — schema creation and batch upsert are a separate TODO (see TODOS.md).'
	);
} catch (error) {
	console.error('Sync failed:', error instanceof Error ? error.message : error);
	process.exit(1);
}
