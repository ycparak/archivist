export type PublicSearchRoute = '/' | '/api/search' | '/api/embedding';

type RateLimiter = {
	limit(options: { key: string }): Promise<{ success: boolean }>;
};

type RateLimitReport =
	| { event: 'archive_search_rate_limited'; route: PublicSearchRoute; status: 429 }
	| { event: 'archive_search_rate_limit_error'; route: PublicSearchRoute };

const RETRY_AFTER_SECONDS = 60;

function isPublicSearchRoute(pathname: string): pathname is PublicSearchRoute {
	return pathname === '/' || pathname === '/api/search' || pathname === '/api/embedding';
}

function rateLimitKey(request: Request): string {
	const clientAddress = request.headers.get('cf-connecting-ip')?.trim() || 'unknown';
	return `archive-search:${clientAddress}`;
}

function rateLimitResponse(route: PublicSearchRoute): Response {
	const headers = {
		'cache-control': 'no-store',
		'retry-after': String(RETRY_AFTER_SECONDS)
	};

	if (route !== '/') {
		return Response.json(
			{ error: 'Too many search requests. Please try again in a minute.' },
			{ status: 429, headers }
		);
	}

	return new Response(
		'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Try again soon</title></head><body><main><h1>Try again soon</h1><p>Too many search requests. Please try again in a minute.</p></main></body></html>',
		{ status: 429, headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } }
	);
}

export function reportRateLimitEvent(report: RateLimitReport): void {
	console.error(report);
}

export async function enforcePublicSearchRateLimit(
	request: Request,
	pathname: string,
	limiter: RateLimiter | undefined,
	report: (report: RateLimitReport) => void = reportRateLimitEvent
): Promise<Response | undefined> {
	if (!isPublicSearchRoute(pathname)) return undefined;
	const embedding = pathname === '/api/embedding' && request.method === 'POST';
	if (!embedding && request.method !== 'GET') return undefined;
	if (!limiter)
		return embedding
			? Response.json(
					{ error: 'Semantic search is unavailable' },
					{ status: 503, headers: { 'cache-control': 'no-store' } }
				)
			: undefined;

	try {
		const { success } = await limiter.limit({ key: rateLimitKey(request) });
		if (success) return undefined;
		report({ event: 'archive_search_rate_limited', route: pathname, status: 429 });
		return rateLimitResponse(pathname);
	} catch {
		report({ event: 'archive_search_rate_limit_error', route: pathname });
		return embedding
			? Response.json(
					{ error: 'Semantic search is unavailable' },
					{ status: 503, headers: { 'cache-control': 'no-store' } }
				)
			: undefined;
	}
}
