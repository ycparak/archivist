import { publishArchiveSearch } from './search-files';
import { z } from 'zod';
import { syncArchive } from '$lib/server/indexing/sync';
import { parseSlugList } from '$lib/server/indexing/channel-filter';
import { loadArchiveCaches } from './maintenance-files';

async function main() {
	if (process.argv.length > 2)
		throw new Error(
			'export:search takes no arguments; it always exports public channels without vision or write-back'
		);
	const credentials = z
		.object({
			ARENA_ACCESS_TOKEN: z.string().min(1),
			CLOUDFLARE_ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/i),
			CLOUDFLARE_API_TOKEN: z.string().min(1)
		})
		.safeParse(process.env);
	if (!credentials.success)
		throw new Error(
			'Set ARENA_ACCESS_TOKEN, CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in .env before exporting'
		);
	const abort = new AbortController();
	for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => abort.abort());
	const { documents, channels } = await syncArchive({
		accessToken: credentials.data.ARENA_ACCESS_TOKEN,
		output: 'export',
		signal: abort.signal,
		...(await loadArchiveCaches()),
		ignoreChannels: parseSlugList(process.env.ARENA_IGNORE_CHANNELS),
		log: (message) => console.log(message)
	});
	await publishArchiveSearch(documents, channels, abort.signal);
}

await main().catch((error: unknown) => {
	console.error(
		`Public search export failed (${error instanceof Error ? error.name : 'unknown error'}). Existing release is unchanged; check network access and configuration.`
	);
	process.exitCode = 1;
});
