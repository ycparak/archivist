import { z } from 'zod';
import { visionResultSchema, type VisionResult } from './cache';
import {
	buildContextText,
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
	choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
	provider: z.string().nullable().optional()
});

export interface VisionClientOptions {
	apiKey: string;
	fetchFn?: typeof fetch;
	model?: string;
	providerOrder?: readonly string[];
	renditionWidth?: number;
	maxImageBytes?: number;
}

export interface DescribeInput {
	imageUrl: string;
	imageBytes?: number | null;
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

function extractContent(body: unknown): { content: string; provider: string | null } {
	const parsed = completionSchema.safeParse(body);
	if (!parsed.success) {
		throw new VisionResponseError(`OpenRouter response did not match the expected shape`, {
			cause: parsed.error
		});
	}
	const content = parsed.data.choices[0].message.content;
	if (!content?.trim()) throw new VisionResponseError('OpenRouter returned an empty completion');
	return { content, provider: parsed.data.provider ?? null };
}

function parseResult(content: string, block: BlockContext): VisionResult {
	let raw: unknown;
	try {
		raw = JSON.parse(content);
	} catch (error) {
		throw new VisionResponseError('model output was not valid JSON', { cause: error });
	}

	const parsed = visionResultSchema.safeParse(raw);
	if (!parsed.success) {
		throw new VisionResponseError(`model output failed validation: ${parsed.error.message}`);
	}

	const result = parsed.data;
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
		maxImageBytes = MAX_IMAGE_BYTES
	} = options;

	if (!apiKey) throw new Error('createVisionClient requires an OpenRouter API key');

	return {
		model,
		promptVersion: PROMPT_VERSION,

		async describe({ imageUrl, imageBytes, block, signal }): Promise<DescribeOutcome> {
			const url = renditionUrl(imageUrl, renditionWidth);

			// Only meaningful when the rendition is the original: a resized URL is always small.
			if (url === imageUrl && imageBytes != null && imageBytes > maxImageBytes) {
				return {
					kind: 'skipped',
					reason: `image is ${(imageBytes / 1024 / 1024).toFixed(1)}MB and cannot be resized (limit ${(maxImageBytes / 1024 / 1024).toFixed(0)}MB)`
				};
			}

			const response = await fetchFn(OPENROUTER_URL, {
				method: 'POST',
				signal,
				headers: {
					Authorization: `Bearer ${apiKey}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					model,
					provider: { require_parameters: true, order: [...providerOrder] },
					reasoning: { enabled: false },
					response_format: { type: 'json_schema', json_schema: VISION_JSON_SCHEMA },
					messages: [
						{ role: 'system', content: SYSTEM_PROMPT },
						{
							role: 'user',
							content: [
								{ type: 'image_url', image_url: { url } },
								{ type: 'text', text: buildContextText(block) }
							]
						}
					]
				})
			});

			if (!response.ok) {
				throw new VisionRequestError(
					`OpenRouter request failed with status ${response.status}`,
					response.status
				);
			}

			const { content, provider } = extractContent(await response.json());
			return { kind: 'described', result: parseResult(content, block), provider };
		}
	};
}
