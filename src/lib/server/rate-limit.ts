type PublicSearchRoute = '/api/search' | '/api/embedding';

type RateLimiter = {
	limit(options: { key: string }): Promise<{ success: boolean }>;
};

type RateLimitReport =
	| { event: 'archive_search_rate_limited'; route: PublicSearchRoute; status: 429 }
	| { event: 'archive_search_rate_limit_error'; route: PublicSearchRoute };

const RETRY_AFTER_SECONDS = 60;

function isPublicSearchRoute(pathname: string): pathname is PublicSearchRoute {
	return pathname === '/api/search' || pathname === '/api/embedding';
}

function rateLimitKey(request: Request): string {
	const clientAddress = request.headers.get('cf-connecting-ip')?.trim() || 'unknown';
	return `archive-search:${clientAddress}`;
}

function jsonError(error: string, status: number, headers: Record<string, string> = {}) {
	return Response.json({ error }, { status, headers: { 'cache-control': 'no-store', ...headers } });
}

/**
 * Embeddings fail closed when the limiter is missing or broken, because each one costs Workers AI
 * inference; the retired search endpoint fails open.
 */
export async function enforcePublicSearchRateLimit(
	request: Request,
	pathname: string,
	limiter: RateLimiter | undefined,
	report: (report: RateLimitReport) => void = console.error
): Promise<Response | undefined> {
	if (!isPublicSearchRoute(pathname)) return undefined;
	const embedding = pathname === '/api/embedding' && request.method === 'POST';
	if (!embedding && request.method !== 'GET') return undefined;
	const unavailable = () =>
		embedding ? jsonError('Semantic search is unavailable', 503) : undefined;
	if (!limiter) return unavailable();

	try {
		const { success } = await limiter.limit({ key: rateLimitKey(request) });
		if (success) return undefined;
		report({ event: 'archive_search_rate_limited', route: pathname, status: 429 });
		return jsonError('Too many search requests. Please try again in a minute.', 429, {
			'retry-after': String(RETRY_AFTER_SECONDS)
		});
	} catch {
		report({ event: 'archive_search_rate_limit_error', route: pathname });
		return unavailable();
	}
}
