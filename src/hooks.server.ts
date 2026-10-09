import type { Handle } from '@sveltejs/kit';
import { browserSearchEnabled } from '$lib/search/backend';
import { enforcePublicSearchRateLimit } from '$lib/server/rate-limit';

export const handle: Handle = async ({ event, resolve }) => {
	if (browserSearchEnabled && event.url.pathname === '/') return resolve(event);
	const response = await enforcePublicSearchRateLimit(
		event.request,
		event.url.pathname,
		event.platform?.env.ARCHIVE_SEARCH_RATE_LIMITER
	);
	return response ?? resolve(event);
};
