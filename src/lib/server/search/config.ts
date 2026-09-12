import type { SearchRepository } from './contracts';
import { DEFAULT_NAMESPACE } from './namespace';
import { TurbopufferSearchRepository } from './repository';
import type { TurbopufferConfig } from './turbopuffer-client';

type SearchCredentials = Partial<
	Pick<Env, 'TURBOPUFFER_API_KEY' | 'TURBOPUFFER_REGION' | 'TURBOPUFFER_NAMESPACE'>
>;

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
