import {
	ARCHIVE_MAX_OFFSET,
	readArchiveSearchState,
	type ArchiveSearchState,
	type SearchResult,
	type SearchTimings
} from '$lib/domain/search';
import type { SearchRepository } from './contracts';
import { parseArchiveSearchRequest, SearchRequestValidationError } from './request';
import { SearchUnavailableError } from './repository';

export type SearchUnavailableReport = {
	correlationId: string;
	providerStatus: number | null;
};

export type ArchiveSearchOutcome =
	| {
			kind: 'ok';
			state: ArchiveSearchState;
			results: SearchResult[];
			hasMore: boolean;
			timings: SearchTimings;
	  }
	| { kind: 'invalid'; state: ArchiveSearchState }
	| { kind: 'unavailable'; state: ArchiveSearchState; correlationId: string };

export function reportSearchUnavailable(report: SearchUnavailableReport): void {
	console.error({ event: 'archive_search_unavailable', ...report });
}

function deduplicateById(results: SearchResult[]): SearchResult[] {
	const byId = new Map<string, SearchResult>();
	for (const result of results) {
		if (!byId.has(result.id)) byId.set(result.id, result);
	}
	return [...byId.values()];
}

export async function executeArchiveSearch(
	searchParams: URLSearchParams,
	createRepository: () => SearchRepository,
	createCorrelationId: () => string = () => crypto.randomUUID(),
	reportUnavailable: (report: SearchUnavailableReport) => void = reportSearchUnavailable
): Promise<ArchiveSearchOutcome> {
	const state = readArchiveSearchState(searchParams);

	try {
		const input = parseArchiveSearchRequest(searchParams);
		const { results, timings } = await createRepository().search(input);
		const ranked = deduplicateById(results);
		const end = input.offset + input.limit;
		return {
			kind: 'ok',
			state,
			results: ranked.slice(input.offset, end),
			hasMore: ranked.length > end && end <= ARCHIVE_MAX_OFFSET,
			timings
		};
	} catch (error) {
		if (error instanceof SearchRequestValidationError) return { kind: 'invalid', state };
		const correlationId = createCorrelationId();
		reportUnavailable({
			correlationId,
			providerStatus: error instanceof SearchUnavailableError ? error.providerStatus : null
		});
		return { kind: 'unavailable', state, correlationId };
	}
}
