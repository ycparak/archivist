import {
	readArchiveSearchState,
	type ArchiveSearchState,
	type SearchResult
} from '$lib/domain/search';
import type { SearchRepository } from './contracts';
import { parseArchiveSearchRequest, SearchRequestValidationError } from './request';
import { SearchUnavailableError } from './repository';

export type SearchUnavailableReport = {
	correlationId: string;
	providerStatus: number | null;
};

export type ArchiveSearchOutcome =
	| { kind: 'ok'; state: ArchiveSearchState; results: SearchResult[] }
	| { kind: 'invalid'; state: ArchiveSearchState }
	| { kind: 'unavailable'; state: ArchiveSearchState; correlationId: string };

export function reportSearchUnavailable(report: SearchUnavailableReport): void {
	console.error('Search unavailable', report);
}

function deduplicateById(results: SearchResult[]): SearchResult[] {
	return [...new Map(results.map((result) => [result.id, result])).values()];
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
		const results = await createRepository().search(input);
		return { kind: 'ok', state, results: deduplicateById(results) };
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
