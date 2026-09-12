import { arenaChannelContentsResponseSchema, type ArenaChannelContentsResponse } from './schemas';

const ARENA_API_BASE_URL = 'https://api.are.na/v3';

/** Are.na enforces `per` in [1, 100]; validated up front so a bad caller value fails loudly. */
const MIN_PER_PAGE = 1;
const MAX_PER_PAGE = 100;

export type ArenaContentSort =
	| 'position_asc'
	| 'position_desc'
	| 'created_at_asc'
	| 'created_at_desc'
	| 'updated_at_asc'
	| 'updated_at_desc';

export interface ArenaClientOptions {
	accessToken: string;
	/** Injectable for tests; defaults to the global `fetch`. */
	fetchFn?: typeof fetch;
	baseUrl?: string;
}

export interface FetchChannelContentsPageOptions {
	page?: number;
	per?: number;
	sort?: ArenaContentSort;
	signal?: AbortSignal;
}

/**
 * Read budget for the bucket that served the response. Per the OpenAPI spec's `info.description`
 * (more current than the rendered docs page, which omits `X-RateLimit-Remaining`), these headers
 * are present on every response, not just 429s — a field is `null` only if a header was missing
 * or unparseable.
 */
export interface ArenaRateLimitInfo {
	limit: number | null;
	remaining: number | null;
	/** Unix seconds when the bucket resets. */
	reset: number | null;
	windowSeconds: number | null;
	tier: string | null;
}

export type ArenaChannelContentsPage = ArenaChannelContentsResponse & {
	rateLimit: ArenaRateLimitInfo;
};

export class ArenaRequestError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = 'ArenaRequestError';
		this.status = status;
	}
}

export class ArenaRateLimitError extends ArenaRequestError {
	/** How long to wait before retrying, derived from response headers. */
	readonly retryAfterMs: number;

	constructor(message: string, retryAfterMs: number) {
		super(message, 429);
		this.name = 'ArenaRateLimitError';
		this.retryAfterMs = retryAfterMs;
	}
}

const MIN_RATE_LIMIT_RETRY_MS = 1_000;

function readHeaderNumber(headers: Headers, name: string): number | null {
	const value = headers.get(name);
	if (value === null) return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

export function parseRateLimitInfo(headers: Headers): ArenaRateLimitInfo {
	return {
		limit: readHeaderNumber(headers, 'X-RateLimit-Limit'),
		remaining: readHeaderNumber(headers, 'X-RateLimit-Remaining'),
		reset: readHeaderNumber(headers, 'X-RateLimit-Reset'),
		windowSeconds: readHeaderNumber(headers, 'X-RateLimit-Window'),
		tier: headers.get('X-RateLimit-Tier')
	};
}

/**
 * Are.na's only per-request backpressure signal for an already-exceeded bucket is `Retry-After`
 * (on 429); `X-RateLimit-Reset` (a unix timestamp, always present) is the fallback. Floor both so
 * a clock skew or a `0` value doesn't turn into a retry storm.
 */
export function resolveRateLimitRetryDelayMs(
	headers: Headers,
	now: () => number = Date.now
): number {
	const retryAfterHeader = headers.get('Retry-After');
	if (retryAfterHeader !== null) {
		const seconds = Number(retryAfterHeader);
		if (Number.isFinite(seconds)) {
			return Math.max(seconds * 1000, MIN_RATE_LIMIT_RETRY_MS);
		}
	}

	const resetEpochSeconds = readHeaderNumber(headers, 'X-RateLimit-Reset');
	if (resetEpochSeconds !== null) {
		return Math.max(resetEpochSeconds * 1000 - now(), MIN_RATE_LIMIT_RETRY_MS);
	}

	return MIN_RATE_LIMIT_RETRY_MS;
}

/**
 * Proactive counterpart to `resolveRateLimitRetryDelayMs`: computed from a successful response's
 * remaining budget so pagination can slow down *before* the bucket is exhausted, instead of only
 * ever reacting to an actual 429.
 */
export function computeProactiveWaitMs(
	rateLimit: ArenaRateLimitInfo,
	safetyMargin: number,
	now: () => number = Date.now
): number {
	if (rateLimit.remaining === null || rateLimit.remaining > safetyMargin) return 0;
	if (rateLimit.reset === null) return 0;
	return Math.max(rateLimit.reset * 1000 - now(), 0);
}

export class ArenaClient {
	private readonly accessToken: string;
	private readonly fetchFn: typeof fetch;
	private readonly baseUrl: string;

	constructor(options: ArenaClientOptions) {
		this.accessToken = options.accessToken;
		this.fetchFn = options.fetchFn ?? fetch;
		this.baseUrl = options.baseUrl ?? ARENA_API_BASE_URL;
	}

	/** Fetches and validates a single page of a channel's contents (blocks + nested channels). */
	async fetchChannelContentsPage(
		slug: string,
		{ page = 1, per = 50, sort, signal }: FetchChannelContentsPageOptions = {}
	): Promise<ArenaChannelContentsPage> {
		if (per < MIN_PER_PAGE || per > MAX_PER_PAGE) {
			throw new RangeError(`per must be between ${MIN_PER_PAGE} and ${MAX_PER_PAGE}, got ${per}`);
		}

		const url = new URL(`${this.baseUrl}/channels/${encodeURIComponent(slug)}/contents`);
		url.searchParams.set('page', String(page));
		url.searchParams.set('per', String(per));
		if (sort) url.searchParams.set('sort', sort);

		const response = await this.fetchFn(url, {
			headers: { Authorization: `Bearer ${this.accessToken}` },
			signal
		});

		if (response.status === 429) {
			throw new ArenaRateLimitError(
				`Rate limited fetching channel "${slug}" contents (page ${page})`,
				resolveRateLimitRetryDelayMs(response.headers)
			);
		}

		if (!response.ok) {
			throw new ArenaRequestError(
				`Are.na request failed with status ${response.status} fetching channel "${slug}" contents (page ${page})`,
				response.status
			);
		}

		const rateLimit = parseRateLimitInfo(response.headers);
		const body = await response.json();
		const page_ = arenaChannelContentsResponseSchema.parse(body);
		return { ...page_, rateLimit };
	}
}

export interface PaginateChannelContentsOptions extends FetchChannelContentsPageOptions {
	/**
	 * Pause between successive page requests. Are.na's own guidance is 200-500ms between
	 * sequential calls; default errs gentle since this walks an entire channel in one pass.
	 */
	requestDelayMs?: number;
	maxRetriesPerPage?: number;
	/** Injectable for tests so pagination/backoff logic doesn't need to sleep for real. */
	delayFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
	/**
	 * When the reported remaining budget drops to/under this, wait for the bucket to reset
	 * before the next request instead of only reacting once Are.na actually returns a 429.
	 */
	rateLimitSafetyMargin?: number;
}

const DEFAULT_REQUEST_DELAY_MS = 300;
const DEFAULT_MAX_RETRIES_PER_PAGE = 5;
const DEFAULT_RATE_LIMIT_SAFETY_MARGIN = 1;

/** Sleeps for `ms`, but resolves immediately if `signal` is already (or becomes) aborted. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return Promise.resolve();
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener('abort', () => {
			clearTimeout(timer);
			resolve();
		});
	});
}

/**
 * Walks every page of a channel's contents, oldest-to-configured-sort-order, honoring 429
 * backoff, slowing proactively as the rate-limit budget runs low, and pacing requests. Intended
 * for the maintainer's manual, occasional sync — not for a request made on behalf of a visitor.
 */
export async function* paginateChannelContents(
	client: ArenaClient,
	slug: string,
	{
		per = 50,
		sort,
		signal,
		requestDelayMs = DEFAULT_REQUEST_DELAY_MS,
		maxRetriesPerPage = DEFAULT_MAX_RETRIES_PER_PAGE,
		delayFn = delay,
		rateLimitSafetyMargin = DEFAULT_RATE_LIMIT_SAFETY_MARGIN
	}: PaginateChannelContentsOptions = {}
): AsyncGenerator<ArenaChannelContentsPage> {
	let page = 1;

	while (true) {
		const response = await fetchPageWithRetry(
			client,
			slug,
			{ page, per, sort, signal },
			maxRetriesPerPage,
			delayFn
		);
		yield response;

		if (!response.meta.has_more_pages || signal?.aborted) return;
		page = response.meta.next_page ?? page + 1;

		const proactiveWaitMs = computeProactiveWaitMs(response.rateLimit, rateLimitSafetyMargin);
		await delayFn(Math.max(requestDelayMs, proactiveWaitMs), signal);

		if (signal?.aborted) return;
	}
}

async function fetchPageWithRetry(
	client: ArenaClient,
	slug: string,
	options: FetchChannelContentsPageOptions,
	maxRetries: number,
	delayFn: (ms: number, signal?: AbortSignal) => Promise<void>
): Promise<ArenaChannelContentsPage> {
	let attempt = 0;

	while (true) {
		try {
			return await client.fetchChannelContentsPage(slug, options);
		} catch (error) {
			if (error instanceof ArenaRateLimitError && attempt < maxRetries) {
				attempt += 1;
				await delayFn(error.retryAfterMs, options.signal);
				continue;
			}
			throw error;
		}
	}
}
