import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { createSearchRepository } from '$lib/server/search/config';
import { handleSearchRequest } from '$lib/server/search/handler';

export const GET: RequestHandler = ({ url, platform }) =>
	handleSearchRequest(url, () => createSearchRepository(platform?.env, env));
