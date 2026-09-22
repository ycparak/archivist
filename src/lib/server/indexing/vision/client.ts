import { z } from 'zod';
import { clampOcr } from '$lib/domain/archive';
import { visionResultSchema, type VisionResult } from './cache';
import {
	buildContextText,
	MAX_DESCRIPTION_CHARS,
	MAX_TITLE_CHARS,
	PROMPT_VERSION,
	SYSTEM_PROMPT,
	VISION_JSON_SCHEMA,
	type BlockContext
} from './prompt';
import { renditionUrl } from './rendition';

export const DEFAULT_MODEL = 'xiaomi/mimo-v2.5';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * OpenRouter fans this model out across providers with different capabilities, and its cheapest
 * route supports neither `structured_outputs` nor `response_format`. Routing there would return
 * prose where this code expects JSON — intermittently, which is worse than failing. The explicit
 * order also keeps runs reproducible; `require_parameters` is what actually enforces the contract.
 */
export const DEFAULT_PROVIDER_ORDER = ['deepinfra', 'streamlake', 'venice'] as const;

/**
 * The common denominator across providers that fetch the image themselves. Are.na's GIFs cannot be
 * resized — every version it publishes is the same CloudFront original — and 43 of the 134 exceed
 * this, up to 24 MB. They are reported as skipped rather than sent and rejected.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** A backfill makes thousands of calls over hours; transient 429s and 5xxs are expected, not news. */
const DEFAULT_MAX_RETRIES = 4;
const RETRY_BASE_MS = 1_000;

/**
 * Generous against the observed 20-160s spread, but finite: without it one stalled socket hangs a
 * multi-hour backfill forever, with nothing in the log to say so.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 240_000;

/**
 * Timeouts get their own, much smaller budget. A request that stalls tends to stall every time —
 * the three blocks that failed the reference backfill did so on five attempts out of five — so
 * spending the full retry budget buys nothing and costs twenty minutes of a worker at the tail of
 * a run, where every other block has finished and the whole thing looks hung. Two attempts is the
 * cheapest way to tell a one-off stall apart from a block that will not complete at all.
 */
const DEFAULT_MAX_TIMEOUT_ATTEMPTS = 2;

/**
 * A hard ceiling on generation, which is the only thing that reliably stops a runaway decode. Two
 * blocks in the archive make this model loop forever on the OCR field — a dense magazine spread of
 * French body copy, and a poster that repeats the word "round" dozens of times in a spiral — and
 * without a cap the request simply never returns, on any provider. Sized against the real
 * distribution: the 99th-percentile response is 973 tokens, so this is over twice the largest
 * legitimate output and clips nothing that works today. When it bites, the reply comes back
 * truncated with `finish_reason: length`, which fails in seconds and says why, instead of holding a
 * worker for the full timeout.
 */
const DEFAULT_MAX_TOKENS = 2_048;

function isRetryable(status: number): boolean {
	return status === 408 || status === 429 || status >= 500;
}

export class VisionRequestError extends Error {
	readonly status: number | null;

	constructor(message: string, status: number | null, options?: ErrorOptions) {
		super(message, options);
		this.name = 'VisionRequestError';
		this.status = status;
	}
}

/** The model returned something the schema does not allow — never cached, always surfaced. */
export class VisionResponseError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'VisionResponseError';
	}
}

const completionSchema = z.object({
	choices: z
		.array(
			z.object({
				message: z.object({ content: z.string().nullable() }),
				finish_reason: z.string().nullable().optional()
			})
		)
		.min(1),
	provider: z.string().nullable().optional()
});

export interface VisionClientOptions {
	apiKey: string;
	fetchFn?: typeof fetch;
	model?: string;
	providerOrder?: readonly string[];
	renditionWidth?: number;
	maxImageBytes?: number;
	maxRetries?: number;
	requestTimeoutMs?: number;
	/** Total attempts spent on timeouts, budgeted separately from `maxRetries`. */
	maxTimeoutAttempts?: number;
	/** Ceiling on generated tokens; the only reliable stop for a runaway decode. */
	maxTokens?: number;
	/** Injectable so tests exercise the retry path without waiting on it. */
	sleepFn?: (ms: number) => Promise<void>;
}

/** A still is handed over as a URL the provider fetches; a transcoded animation rides along inline. */
export type VisionMedia =
	{ kind: 'image'; url: string; bytes?: number | null } | { kind: 'video'; dataUrl: string };

export interface DescribeInput {
	media: VisionMedia;
	block: BlockContext;
	signal?: AbortSignal;
}

export type DescribeOutcome =
	| { kind: 'described'; result: VisionResult; provider: string | null }
	| { kind: 'skipped'; reason: string };

export interface VisionClient {
	readonly model: string;
	readonly promptVersion: number;
	describe(input: DescribeInput): Promise<DescribeOutcome>;
}

function extractContent(body: unknown): {
	content: string;
	provider: string | null;
	finishReason: string | null;
} {
	const parsed = completionSchema.safeParse(body);
	if (!parsed.success) {
		throw new VisionResponseError(`OpenRouter response did not match the expected shape`, {
			cause: parsed.error
		});
	}
	const choice = parsed.data.choices[0];
	const content = choice.message.content;
	if (!content?.trim()) throw new VisionResponseError('OpenRouter returned an empty completion');
	return {
		content,
		provider: parsed.data.provider ?? null,
		finishReason: choice.finish_reason ?? null
	};
}

/** Some providers wrap structured output in a markdown fence despite being asked not to. */
function stripCodeFence(content: string): string {
	const fenced = content.trim().match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
	return fenced ? fenced[1] : content;
}

/**
 * The model treats the length guidance as a suggestion — a first live call came back 640 characters
 * against a 500 limit. The cap exists to stop generated prose drowning out a block's own
 * description in `search_text`, so it is enforced here rather than hoped for, cutting at the last
 * sentence that fits so the text still ends cleanly.
 */
function clampDescription(description: string): string {
	if (description.length <= MAX_DESCRIPTION_CHARS) return description;

	const head = description.slice(0, MAX_DESCRIPTION_CHARS);
	const lastSentence = Math.max(
		head.lastIndexOf('. '),
		head.lastIndexOf('! '),
		head.lastIndexOf('? ')
	);
	if (lastSentence >= MAX_DESCRIPTION_CHARS / 2) return head.slice(0, lastSentence + 1);

	const lastSpace = head.lastIndexOf(' ');
	return `${head.slice(0, lastSpace > 0 ? lastSpace : head.length).trimEnd()}…`;
}

function parseResult(
	content: string,
	block: BlockContext,
	finishReason: string | null
): VisionResult {
	let raw: unknown;
	try {
		raw = JSON.parse(stripCodeFence(content));
	} catch (error) {
		// Without the output itself, "not valid JSON" says nothing about whether the response was
		// truncated, fenced, or prose — and the response is gone by the time anyone looks.
		const reason = finishReason === 'length' ? ' (truncated: finish_reason=length)' : '';
		throw new VisionResponseError(
			`model output was not valid JSON${reason}; ${content.length} chars starting ${JSON.stringify(content.slice(0, 120))}`,
			{ cause: error }
		);
	}

	const parsed = visionResultSchema.safeParse(raw);
	if (!parsed.success) {
		throw new VisionResponseError(`model output failed validation: ${parsed.error.message}`);
	}

	const result = {
		...parsed.data,
		description: clampDescription(parsed.data.description),
		ocr: clampOcr(parsed.data.ocr)
	};
	const supplied = block.title?.replace(/\s+/g, ' ').trim().toLowerCase();
	if (supplied && result.title.toLowerCase() === supplied) {
		throw new VisionResponseError('model echoed the supplied title instead of writing one');
	}
	if (result.title.length > MAX_TITLE_CHARS * 2) {
		throw new VisionResponseError(
			`model returned a ${result.title.length}-character title, far over the ${MAX_TITLE_CHARS} asked for`
		);
	}

	return result;
}

export function createVisionClient(options: VisionClientOptions): VisionClient {
	const {
		apiKey,
		fetchFn = fetch,
		model = DEFAULT_MODEL,
		providerOrder = DEFAULT_PROVIDER_ORDER,
		renditionWidth,
		maxImageBytes = MAX_IMAGE_BYTES,
		maxRetries = DEFAULT_MAX_RETRIES,
		requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
		maxTimeoutAttempts = DEFAULT_MAX_TIMEOUT_ATTEMPTS,
		maxTokens = DEFAULT_MAX_TOKENS,
		sleepFn = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
	} = options;

	if (!apiKey) throw new Error('createVisionClient requires an OpenRouter API key');

	return {
		model,
		promptVersion: PROMPT_VERSION,

		async describe({ media, block, signal }): Promise<DescribeOutcome> {
			let mediaPart: Record<string, unknown>;

			if (media.kind === 'video') {
				mediaPart = { type: 'video_url', video_url: { url: media.dataUrl } };
			} else {
				const url = renditionUrl(media.url, renditionWidth);

				// Only meaningful when the rendition is the original: a resized URL is always small.
				if (url === media.url && media.bytes != null && media.bytes > maxImageBytes) {
					return {
						kind: 'skipped',
						reason: `image is ${(media.bytes / 1024 / 1024).toFixed(1)}MB and cannot be resized (limit ${(maxImageBytes / 1024 / 1024).toFixed(0)}MB)`
					};
				}
				mediaPart = { type: 'image_url', image_url: { url } };
			}

			const body = JSON.stringify({
				model,
				provider: { require_parameters: true, order: [...providerOrder] },
				reasoning: { enabled: false },
				max_tokens: maxTokens,
				response_format: { type: 'json_schema', json_schema: VISION_JSON_SCHEMA },
				messages: [
					{ role: 'system', content: SYSTEM_PROMPT },
					{
						role: 'user',
						content: [mediaPart, { type: 'text', text: buildContextText(block) }]
					}
				]
			});

			let timeoutAttempts = 0;

			for (let attempt = 0; ; attempt += 1) {
				const timeout = AbortSignal.timeout(requestTimeoutMs);
				const lastAttempt = attempt >= maxRetries;
				let retryDelayMs = RETRY_BASE_MS * 2 ** attempt;

				try {
					const response = await fetchFn(OPENROUTER_URL, {
						method: 'POST',
						signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
						headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
						body
					});

					if (response.ok) {
						// The body read is inside the timeout as well: a stall after the headers arrive
						// is the shape this actually fails in, and it used to escape unretried.
						const { content, provider, finishReason } = extractContent(await response.json());
						return {
							kind: 'described',
							result: parseResult(content, block, finishReason),
							provider
						};
					}

					if (!isRetryable(response.status) || lastAttempt) {
						// The body carries the actual cause — an unreachable image, an unroutable
						// provider — and a bare status code sends you diagnosing the wrong thing.
						const detail = (await response.text().catch(() => '')).slice(0, 300).trim();
						throw new VisionRequestError(
							`OpenRouter request failed with status ${response.status}${detail ? `: ${detail}` : ''}`,
							response.status
						);
					}

					const retryAfter = Number(response.headers.get('retry-after'));
					if (Number.isFinite(retryAfter) && retryAfter > 0) retryDelayMs = retryAfter * 1000;
				} catch (error) {
					// A caller-driven abort is the run shutting down and is never retried.
					if (signal?.aborted) throw error;

					if (timeout.aborted) {
						timeoutAttempts += 1;
						if (lastAttempt || timeoutAttempts >= maxTimeoutAttempts) {
							throw new VisionRequestError(
								`OpenRouter request timed out after ${requestTimeoutMs}ms, ${timeoutAttempts} attempt(s)`,
								null,
								{ cause: error }
							);
						}
					} else if (!(error instanceof VisionResponseError) || lastAttempt) {
						throw error;
					}
					// Otherwise: a timeout or malformed output with attempts left — both worth retrying,
					// since the next attempt usually routes to a different provider.
				}

				await sleepFn(retryDelayMs);
			}
		}
	};
}
