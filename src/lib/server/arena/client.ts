import {
	createArena,
	ArenaApiError as SdkArenaApiError,
	ArenaRateLimitError as SdkArenaRateLimitError,
	type Arena
} from '@aredotna/sdk';
import {
	arenaChannelContentsResponseSchema,
	arenaMeSchema,
	arenaOwnedChannelsResponseSchema,
	type ArenaChannelContentsResponse,
	type ArenaMe,
	type ArenaOwnedChannelsResponse
} from './schemas';

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
	/** Passed straight through to `@aredotna/sdk`'s `createArena` — no `/v3` suffix (it adds that itself). Defaults to `https://api.are.na`. */
	baseUrl?: string;
}

export interface FetchChannelContentsPageOptions {
	page?: number;
	per?: number;
	sort?: ArenaContentSort;
	signal?: AbortSignal;
}

export interface FetchOwnedChannelsPageOptions {
	page?: number;
	per?: number;
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

export type ArenaOwnedChannelsPage = ArenaOwnedChannelsResponse & {
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

const EMPTY_RATE_LIMIT_INFO: ArenaRateLimitInfo = {
	limit: null,
	remaining: null,
	reset: null,
	windowSeconds: null,
	tier: null
};

/**
 * The official SDK's own `Arena.rateLimit` doesn't capture `X-RateLimit-Remaining` (checked
 * against its source — it only parses Limit/Reset/Tier/Window), which is what our proactive
 * throttling in `computeProactiveWaitMs` needs. Wrapping the fetch we hand the SDK is the only
 * way to see the full header set without forking it: this only ever reads headers off the
 * response it's given and returns that response untouched.
 */
function wrapFetchForRateLimitTracking(fetchFn: typeof fetch): {
	fetchFn: typeof fetch;
	latest: () => ArenaRateLimitInfo;
} {
	let latest = EMPTY_RATE_LIMIT_INFO;
	const wrapped: typeof fetch = async (input, init) => {
		const response = await fetchFn(input, init);
		latest = parseRateLimitInfo(response.headers);
		return response;
	};
	return { fetchFn: wrapped, latest: () => latest };
}

/**
 * Maps the SDK's normalized error classes to this module's own, so a caller never needs to
 * import from `@aredotna/sdk` directly — the provider's error shape stays private to this
 * adapter, per `AGENTS.md`'s "provider shapes never leak past their adapter module" rule.
 *
 * Deliberately doesn't delegate to the SDK's own `retry.respectRateLimits` option: that path only
 * ever waits based on `X-RateLimit-Reset` with no floor and ignores `Retry-After` entirely (read
 * from its source), which is weaker than `resolveRateLimitRetryDelayMs` below. Network errors
 * (`ArenaNetworkError`) and anything else pass through unchanged — they aren't HTTP-status
 * failures this adapter has a more specific type for.
 *
 * `context` is a human-readable phrase describing the request (e.g. `fetching current user`),
 * shared across every operation this client exposes.
 */
function mapSdkError(error: unknown, context: string): unknown {
	if (error instanceof SdkArenaRateLimitError) {
		const retryAfterMs = error.response
			? resolveRateLimitRetryDelayMs(error.response.headers)
			: MIN_RATE_LIMIT_RETRY_MS;
		return new ArenaRateLimitError(`Rate limited ${context}`, retryAfterMs);
	}

	if (error instanceof SdkArenaApiError) {
		return new ArenaRequestError(
			`Are.na request failed with status ${error.status} ${context}`,
			error.status
		);
	}

	return error;
}

function assertValidPer(per: number): void {
	if (per < MIN_PER_PAGE || per > MAX_PER_PAGE) {
		throw new RangeError(`per must be between ${MIN_PER_PAGE} and ${MAX_PER_PAGE}, got ${per}`);
	}
}

export class ArenaClient {
	private readonly arena: Arena;
	private readonly latestRateLimit: () => ArenaRateLimitInfo;

	constructor(options: ArenaClientOptions) {
		const { fetchFn, latest } = wrapFetchForRateLimitTracking(options.fetchFn ?? fetch);
		this.arena = createArena({
			token: options.accessToken,
			fetch: fetchFn,
			baseUrl: options.baseUrl
		});
		this.latestRateLimit = latest;
	}

	/** Resolves the token's own account — the starting point for channel discovery. */
	async me(): Promise<ArenaMe> {
		try {
			const body = await this.arena.me();
			return arenaMeSchema.parse(body);
		} catch (error) {
			throw mapSdkError(error, 'fetching current user');
		}
	}

	/** Fetches and validates a single page of a channel's contents (blocks + nested channels). */
	async fetchChannelContentsPage(
		slug: string,
		{ page = 1, per = 50, sort, signal }: FetchChannelContentsPageOptions = {}
	): Promise<ArenaChannelContentsPage> {
		assertValidPer(per);

		try {
			const body = await this.arena.channels.contents(slug, { page, per, sort }, { signal });
			const parsed = arenaChannelContentsResponseSchema.parse(body);
			return { ...parsed, rateLimit: this.latestRateLimit() };
		} catch (error) {
			throw mapSdkError(error, `fetching channel "${slug}" contents (page ${page})`);
		}
	}

	/** Fetches and validates a single page of channels owned by the given user (discovery). */
	async fetchOwnedChannelsPage(
		userId: number,
		{ page = 1, per = 50, signal }: FetchOwnedChannelsPageOptions = {}
	): Promise<ArenaOwnedChannelsPage> {
		assertValidPer(per);

		try {
			const body = await this.arena.users.contents(
				userId,
				{ page, per, type: 'Channel' },
				{ signal }
			);
			const parsed = arenaOwnedChannelsResponseSchema.parse(body);
			return { ...parsed, rateLimit: this.latestRateLimit() };
		} catch (error) {
			throw mapSdkError(error, `fetching owned channels for user ${userId} (page ${page})`);
		}
	}
}

export interface PaginateOptions {
	per?: number;
	signal?: AbortSignal;
	/**
	 * Pause between successive page requests. Are.na's own guidance is 200-500ms between
	 * sequential calls; default errs gentle since this walks a whole resource in one pass.
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

export interface PaginateChannelContentsOptions extends PaginateOptions {
	sort?: ArenaContentSort;
}

const DEFAULT_REQUEST_DELAY_MS = 300;
const DEFAULT_MAX_RETRIES_PER_PAGE = 5;
const DEFAULT_RATE_LIMIT_SAFETY_MARGIN = 1;

/**
 * Sleeps for `ms`, but resolves immediately if `signal` is already (or becomes) aborted. Exported
 * so callers pacing requests *across* multiple paginated resources (e.g. one delay per channel
 * synced, not just between pages within one channel) can reuse the same abort-aware behavior.
 */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return Promise.resolve();
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener('abort', () => {
			clearTimeout(timer);
			resolve();
		});
	});
}

interface PageLike {
	meta: { has_more_pages: boolean; next_page: number | null };
	rateLimit: ArenaRateLimitInfo;
}

/**
 * Shared pagination engine behind both `paginateChannelContents` and `paginateOwnedChannels`:
 * fetches page 1..N via `fetchPage`, honoring 429 backoff, slowing proactively as the rate-limit
 * budget runs low, pacing requests, and stopping cleanly on `has_more_pages: false` or abort.
 * Intended for the maintainer's manual, occasional sync — not a request made on a visitor's behalf.
 */
async function* paginate<T extends PageLike>(
	fetchPage: (page: number, per: number, signal?: AbortSignal) => Promise<T>,
	{
		per = 50,
		signal,
		requestDelayMs = DEFAULT_REQUEST_DELAY_MS,
		maxRetriesPerPage = DEFAULT_MAX_RETRIES_PER_PAGE,
		delayFn = delay,
		rateLimitSafetyMargin = DEFAULT_RATE_LIMIT_SAFETY_MARGIN
	}: PaginateOptions = {}
): AsyncGenerator<T> {
	let page = 1;

	while (true) {
		const response = await fetchPageWithRetry(
			fetchPage,
			page,
			per,
			signal,
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

async function fetchPageWithRetry<T extends PageLike>(
	fetchPage: (page: number, per: number, signal?: AbortSignal) => Promise<T>,
	page: number,
	per: number,
	signal: AbortSignal | undefined,
	maxRetries: number,
	delayFn: (ms: number, signal?: AbortSignal) => Promise<void>
): Promise<T> {
	let attempt = 0;

	while (true) {
		try {
			return await fetchPage(page, per, signal);
		} catch (error) {
			if (error instanceof ArenaRateLimitError && attempt < maxRetries) {
				attempt += 1;
				await delayFn(error.retryAfterMs, signal);
				continue;
			}
			throw error;
		}
	}
}

/** Walks every page of a channel's contents, oldest-to-configured-sort-order. */
export function paginateChannelContents(
	client: ArenaClient,
	slug: string,
	{ sort, ...options }: PaginateChannelContentsOptions = {}
): AsyncGenerator<ArenaChannelContentsPage> {
	return paginate(
		(page, per, signal) => client.fetchChannelContentsPage(slug, { page, per, sort, signal }),
		options
	);
}

/** Walks every page of channels owned by the given user (channel discovery). */
export function paginateOwnedChannels(
	client: ArenaClient,
	userId: number,
	options: PaginateOptions = {}
): AsyncGenerator<ArenaOwnedChannelsPage> {
	return paginate(
		(page, per, signal) => client.fetchOwnedChannelsPage(userId, { page, per, signal }),
		options
	);
}
