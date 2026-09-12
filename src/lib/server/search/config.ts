import type { SearchRepository } from './contracts';
import { TurbopufferSearchRepository } from './repository';
import type { TurbopufferConfig } from './turbopuffer-client';

const DEFAULT_NAMESPACE = 'arena-blocks-v1';

type SearchCredentials = {
	TURBOPUFFER_API_KEY?: string;
	TURBOPUFFER_REGION?: string;
	TURBOPUFFER_NAMESPACE?: string;
};

export type SearchEnvironment = SearchCredentials | Readonly<Record<string, string | undefined>>;

export function resolveSearchConfig(
	platformEnv: SearchEnvironment | undefined,
	fallbackEnv: SearchEnvironment
): TurbopufferConfig {
	const apiKey = platformEnv?.TURBOPUFFER_API_KEY || fallbackEnv.TURBOPUFFER_API_KEY;
	const region = platformEnv?.TURBOPUFFER_REGION || fallbackEnv.TURBOPUFFER_REGION;
	if (!apiKey || !region) throw new Error('Search service is not configured');
	const namespace = platformEnv?.TURBOPUFFER_NAMESPACE || fallbackEnv.TURBOPUFFER_NAMESPACE;
	return { apiKey, region, namespace: namespace || DEFAULT_NAMESPACE };
}

export function createSearchRepository(
	platformEnv: SearchEnvironment | undefined,
	fallbackEnv: SearchEnvironment
): SearchRepository {
	return new TurbopufferSearchRepository(resolveSearchConfig(platformEnv, fallbackEnv));
}
