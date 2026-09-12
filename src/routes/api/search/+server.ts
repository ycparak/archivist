import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { handleSearchRequest, type SearchUnavailableReport } from '$lib/server/search/handler';
import { TurbopufferSearchRepository } from '$lib/server/search/repository';

const DEFAULT_NAMESPACE = 'arena-blocks-v1';

function searchRepositoryFromEnv(platformEnv?: Env) {
	const apiKey = platformEnv?.TURBOPUFFER_API_KEY ?? env.TURBOPUFFER_API_KEY;
	const region = platformEnv?.TURBOPUFFER_REGION ?? env.TURBOPUFFER_REGION;
	if (!apiKey || !region) throw new Error('Search service is not configured');
	const namespace = platformEnv?.TURBOPUFFER_NAMESPACE ?? env.TURBOPUFFER_NAMESPACE;
	return new TurbopufferSearchRepository({
		apiKey,
		region,
		namespace: namespace || DEFAULT_NAMESPACE
	});
}

function reportSearchUnavailable(report: SearchUnavailableReport): void {
	console.error('Search unavailable', report);
}

export const GET: RequestHandler = ({ url, platform }) =>
	handleSearchRequest(
		url,
		() => searchRepositoryFromEnv(platform?.env),
		undefined,
		reportSearchUnavailable
	);
