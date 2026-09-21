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

const MIN_PER_PAGE = 1;
const MAX_PER_PAGE = 100;

export type ArenaContentSort =
	| 'position_asc'
	| 'position_desc'
	| 'created_at_asc'
	| 'created_at_desc'
	| 'updated_at_asc'
	| 'updated_at_desc';

export interface ArenaBlockUpdate {
	title?: string;
	description?: string;
	metadata?: Record<string, string | number | boolean | null>;
}

export interface ArenaClientOptions {
	accessToken: string;
	fetchFn?: typeof fetch;
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

export interface ArenaRateLimitInfo {
	limit: number | null;
	remaining: number | null;
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

	async me(): Promise<ArenaMe> {
		try {
			const body = await this.arena.me();
			return arenaMeSchema.parse(body);
		} catch (error) {
			throw mapSdkError(error, 'fetching current user');
		}
	}

	/**
	 * Are.na rejects an update to a block the token's owner did not author, so callers must filter
	 * by ownership first. Metadata uses merge semantics: keys sent are set, keys omitted are left.
	 */
	async updateBlock(id: number, body: ArenaBlockUpdate): Promise<void> {
		try {
			await this.arena.blocks.update(id, body);
		} catch (error) {
			throw mapSdkError(error, `updating block ${id}`);
		}
	}

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
	requestDelayMs?: number;
	maxRetriesPerPage?: number;
	delayFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
	rateLimitSafetyMargin?: number;
}

export interface PaginateChannelContentsOptions extends PaginateOptions {
	sort?: ArenaContentSort;
}

const DEFAULT_REQUEST_DELAY_MS = 300;
const DEFAULT_MAX_RETRIES_PER_PAGE = 5;
const DEFAULT_RATE_LIMIT_SAFETY_MARGIN = 1;

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
