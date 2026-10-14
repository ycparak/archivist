import type { Handle } from '@sveltejs/kit';
import { enforceEmbeddingRateLimit } from '$lib/server/rate-limit';

export const handle: Handle = async ({ event, resolve }) => {
	// The gallery is prerendered, and reading `platform.env` while prerendering throws.
	if (event.url.pathname === '/') return resolve(event);
	const response = await enforceEmbeddingRateLimit(
		event.request,
		event.url.pathname,
		event.platform?.env.ARCHIVE_SEARCH_RATE_LIMITER
	);
	return response ?? resolve(event);
};
