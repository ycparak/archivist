import { browserSearchEnabled } from '$lib/search/backend';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { createSearchRepository } from '$lib/server/search/config';
import { handleSearchRequest } from '$lib/server/search/handler';

export const GET: RequestHandler = ({ url, platform }) =>
	browserSearchEnabled
		? Response.json(
				{ error: 'Search now runs in the browser using the versioned archive assets' },
				{ status: 410, headers: { 'cache-control': 'no-store' } }
			)
		: handleSearchRequest(url, () => createSearchRepository(platform?.env, env));
