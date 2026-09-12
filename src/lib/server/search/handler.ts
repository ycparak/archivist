import { json } from '@sveltejs/kit';
import type { SearchRepository } from './contracts';
import { parseArchiveSearchRequest, SearchRequestValidationError } from './request';
import { SearchUnavailableError } from './repository';

export type SearchUnavailableReport = {
	correlationId: string;
	providerStatus: number | null;
};

export function handleSearchRequest(
	url: URL,
	createRepository: () => SearchRepository,
	createCorrelationId: () => string = () => crypto.randomUUID(),
	reportUnavailable: (report: SearchUnavailableReport) => void = () => {}
): Promise<Response> {
	return (async () => {
		try {
			const input = parseArchiveSearchRequest(url.searchParams);
			const results = await createRepository().search(input);
			return json({ results });
		} catch (error) {
			if (error instanceof SearchRequestValidationError) {
				return json({ error: 'Invalid search request' }, { status: 400 });
			}
			const correlationId = createCorrelationId();
			reportUnavailable({
				correlationId,
				providerStatus: error instanceof SearchUnavailableError ? error.providerStatus : null
			});
			return json({ error: 'Search unavailable', correlationId }, { status: 503 });
		}
	})();
}
