import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';
import { channelManifest } from '$lib/server/indexing/channel-manifest';
import { createArchiveSizeCache } from '$lib/server/search/archive-size';
import { createSearchRepository } from '$lib/server/search/config';
import { executeArchiveSearch } from '$lib/server/search/execute';
import { SearchUnavailableError } from '$lib/server/search/repository';

const archiveSize = createArchiveSizeCache();

export const load: PageServerLoad = async ({ url, platform, setHeaders }) => {
	const [outcome, blockCount] = await Promise.all([
		executeArchiveSearch(url.searchParams, () => createSearchRepository(platform?.env, env)),
		// The count only decorates the footer; without it the page still works, so it is logged and left out.
		archiveSize(async () => createSearchRepository(platform?.env, env).countBlocks()).catch(
			(error: unknown) => {
				console.error({
					event: 'archive_size_unavailable',
					providerStatus: error instanceof SearchUnavailableError ? error.providerStatus : null
				});
				return null;
			}
		)
	]);
	if (outcome.kind !== 'ok') setHeaders({ 'cache-control': 'no-store' });
	return { ...outcome, channels: channelManifest, blockCount };
};
