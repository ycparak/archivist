import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';
import { createSearchRepository } from '$lib/server/search/config';
import { executeArchiveSearch } from '$lib/server/search/execute';

export const load: PageServerLoad = ({ url, platform }) =>
	executeArchiveSearch(url.searchParams, () => createSearchRepository(platform?.env, env));
