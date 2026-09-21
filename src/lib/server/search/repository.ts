import Turbopuffer, {
	type Filter,
	type NamespaceMultiQueryParams,
	type NamespaceQueryParams,
	type QueryPerformance,
	type Row
} from '@turbopuffer/turbopuffer';
import { z } from 'zod';
import type { SearchTimings } from '$lib/domain/search';
import type {
	ArchiveSearchInput,
	SearchRepository,
	SearchResponse,
	SearchResult
} from './contracts';
import type { TurbopufferConfig } from './turbopuffer-client';

const QUERY_TIMEOUT_MS = 10_000;
const QUERY_MAX_RETRIES = 1;
const presentationAttributes = [
	'title',
	'description',
	'block_type',
	'channel_slugs',
	'connected_at',
	'source_url',
	'arena_url',
	'image_url',
	'image_alt',
	'image_width',
	'image_height',
	'source_title'
];

const dateTimeSchema = z.string().refine((value) => Number.isFinite(Date.parse(value)));

const turbopufferResultRowSchema = z.object({
	id: z.string(),
	title: z.string().nullable().optional(),
	description: z.string().nullable().optional(),
	block_type: z.string().min(1),
	channel_slugs: z.array(z.string()),
	connected_at: dateTimeSchema.nullable().optional(),
	source_url: z.url().nullable().optional(),
	arena_url: z.url(),
	image_url: z.url().nullable().optional(),
	image_alt: z.string().nullable().optional(),
	image_width: z.number().int().positive().nullable().optional(),
	image_height: z.number().int().positive().nullable().optional(),
	source_title: z.string().nullable().optional()
});

export class SearchUnavailableError extends Error {
	readonly providerStatus: number | null;

	constructor(cause: unknown) {
		super('Search provider is unavailable', { cause });
		this.name = 'SearchUnavailableError';
		this.providerStatus =
			typeof cause === 'object' &&
			cause !== null &&
			'status' in cause &&
			typeof cause.status === 'number'
				? cause.status
				: null;
	}
}

export function buildSearchFilters(input: ArchiveSearchInput): Filter | undefined {
	const filters: Filter[] = [];
	if (input.blockTypes.length) filters.push(['block_type', 'In', input.blockTypes]);
	if (input.channelSlugs.length) filters.push(['channel_slugs', 'ContainsAny', input.channelSlugs]);
	if (input.from) filters.push(['connected_at', 'Gte', input.from.toISOString()]);
	if (input.to) filters.push(['connected_at', 'Lte', input.to.toISOString()]);
	return filters.length ? ['And', filters] : undefined;
}

function sharedQuery(input: ArchiveSearchInput) {
	const filters = buildSearchFilters(input);
	return {
		include_attributes: presentationAttributes,
		limit: input.offset + input.limit + 1,
		...(filters ? { filters } : {})
	};
}

function singleQuery(input: ArchiveSearchInput): NamespaceQueryParams {
	const shared = sharedQuery(input);
	switch (input.mode) {
		case 'browse':
			return {
				...shared,
				rank_by: [
					['connection_count', 'desc'],
					['connected_at', 'desc']
				]
			};
		case 'lexical':
			return { ...shared, rank_by: ['search_text', 'BM25', input.query] };
		case 'semantic':
			return { ...shared, rank_by: ['search_text', 'ANN', ['Embed', input.query]] };
		case 'hybrid':
			throw new Error('Hybrid search requires multiQuery');
	}
}

function hybridQuery(input: ArchiveSearchInput): NamespaceMultiQueryParams {
	const shared = sharedQuery(input);
	return {
		queries: [
			{ ...shared, rank_by: ['search_text', 'BM25', input.query] },
			{ ...shared, rank_by: ['search_text', 'ANN', ['Embed', input.query]] }
		],
		rerank_by: ['RRF']
	};
}

function toSearchResult(row: Row): SearchResult {
	const parsed = turbopufferResultRowSchema.safeParse(row);
	if (!parsed.success) throw new SearchUnavailableError(parsed.error);
	return {
		id: parsed.data.id,
		title: parsed.data.title ?? null,
		description: parsed.data.description ?? null,
		blockType: parsed.data.block_type,
		channelSlugs: parsed.data.channel_slugs,
		connectedAt: parsed.data.connected_at ?? null,
		sourceUrl: parsed.data.source_url ?? null,
		arenaUrl: parsed.data.arena_url,
		imageUrl: parsed.data.image_url ?? null,
		imageAlt: parsed.data.image_alt ?? null,
		imageWidth: parsed.data.image_width ?? null,
		imageHeight: parsed.data.image_height ?? null,
		sourceTitle: parsed.data.source_title ?? null
	};
}

function toTimings(
	startedAt: number,
	provider: Partial<QueryPerformance> | undefined,
	reranked: boolean
): SearchTimings {
	const queryMs = provider?.query_execution_ms ?? 0;
	const serverMs = provider?.server_total_ms ?? queryMs;
	return {
		totalMs: performance.now() - startedAt,
		queryMs,
		rerankMs: reranked ? Math.max(0, serverMs - queryMs) : 0
	};
}

export class TurbopufferSearchRepository implements SearchRepository {
	private readonly namespace;

	constructor(config: TurbopufferConfig) {
		const client = new Turbopuffer({
			apiKey: config.apiKey,
			region: config.region,
			fetch: config.fetchFn
		});
		this.namespace = client.namespace(config.namespace);
	}

	async search(input: ArchiveSearchInput): Promise<SearchResponse> {
		const startedAt = performance.now();
		try {
			if (input.mode === 'hybrid') {
				const response = await this.namespace.multiQuery(hybridQuery(input), {
					timeout: QUERY_TIMEOUT_MS,
					maxRetries: QUERY_MAX_RETRIES
				});
				return {
					results: response.results.flatMap((result) => result.rows ?? []).map(toSearchResult),
					timings: toTimings(startedAt, response.performance, true)
				};
			}

			const response = await this.namespace.query(singleQuery(input), {
				timeout: QUERY_TIMEOUT_MS,
				maxRetries: QUERY_MAX_RETRIES
			});
			return {
				results: (response.rows ?? []).map(toSearchResult),
				timings: toTimings(startedAt, response.performance, false)
			};
		} catch (error) {
			if (error instanceof SearchUnavailableError) throw error;
			throw new SearchUnavailableError(error);
		}
	}
}
