import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';
import { channelManifest } from '$lib/server/indexing/channel-manifest';
import { createSearchRepository } from '$lib/server/search/config';
import { executeArchiveSearch } from '$lib/server/search/execute';

export const load: PageServerLoad = async ({ url, platform, setHeaders }) => {
	const outcome = await executeArchiveSearch(url.searchParams, () =>
		createSearchRepository(platform?.env, env)
	);
	if (outcome.kind !== 'ok') setHeaders({ 'cache-control': 'no-store' });
	return { ...outcome, channels: channelManifest };
};
