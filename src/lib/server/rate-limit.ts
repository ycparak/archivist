type RateLimiter = {
	limit(options: { key: string }): Promise<{ success: boolean }>;
};

type RateLimitReport =
	| { event: 'archive_search_rate_limited'; route: typeof EMBEDDING_ROUTE; status: 429 }
	| { event: 'archive_search_rate_limit_error'; route: typeof EMBEDDING_ROUTE };

const EMBEDDING_ROUTE = '/api/embedding';
const RETRY_AFTER_SECONDS = 60;

function rateLimitKey(request: Request): string {
	const clientAddress = request.headers.get('cf-connecting-ip')?.trim() || 'unknown';
	return `archive-search:${clientAddress}`;
}

function jsonError(error: string, status: number, headers: Record<string, string> = {}) {
	return Response.json({ error }, { status, headers: { 'cache-control': 'no-store', ...headers } });
}

/** Each embedding costs Workers AI inference, so it fails closed when the limiter is missing or broken. */
export async function enforceEmbeddingRateLimit(
	request: Request,
	pathname: string,
	limiter: RateLimiter | undefined,
	report: (report: RateLimitReport) => void = console.error
): Promise<Response | undefined> {
	if (pathname !== EMBEDDING_ROUTE || request.method !== 'POST') return undefined;
	const unavailable = () => jsonError('Semantic search is unavailable', 503);
	if (!limiter) return unavailable();

	try {
		const { success } = await limiter.limit({ key: rateLimitKey(request) });
		if (success) return undefined;
		report({ event: 'archive_search_rate_limited', route: EMBEDDING_ROUTE, status: 429 });
		return jsonError('Too many search requests. Please try again in a minute.', 429, {
			'retry-after': String(RETRY_AFTER_SECONDS)
		});
	} catch {
		report({ event: 'archive_search_rate_limit_error', route: EMBEDDING_ROUTE });
		return unavailable();
	}
}
