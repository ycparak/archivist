import { json } from '@sveltejs/kit';
import type { SearchRepository } from './contracts';
import { executeArchiveSearch, type SearchUnavailableReport } from './execute';

export type { SearchUnavailableReport };

export async function handleSearchRequest(
	url: URL,
	createRepository: () => SearchRepository,
	createCorrelationId?: () => string,
	reportUnavailable?: (report: SearchUnavailableReport) => void
): Promise<Response> {
	const outcome = await executeArchiveSearch(
		url.searchParams,
		createRepository,
		createCorrelationId,
		reportUnavailable
	);

	switch (outcome.kind) {
		case 'ok':
			return json({ results: outcome.results });
		case 'invalid':
			return json({ error: 'Invalid search request' }, { status: 400 });
		case 'unavailable':
			return json(
				{ error: 'Search unavailable', correlationId: outcome.correlationId },
				{ status: 503 }
			);
	}
}
