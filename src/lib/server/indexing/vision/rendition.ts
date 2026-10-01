import { createHash } from 'node:crypto';

/**
 * Are.na serves images through a sharp-based resizer whose whole request is a base64-encoded JSON
 * payload in the URL path: `{"bucket":…,"key":…,"edits":{"resize":{"width":1800,…},…}}`. Rewriting
 * the resize width yields a smaller rendition of the same source, which is what the vision model
 * is handed — it fetches the URL itself, so sync never downloads image bytes.
 */
const ARENA_IMAGE_HOST = 'images.are.na';

/** Wide enough for legible typography and OCR, small enough to keep per-image tokens down. */
export const DEFAULT_RENDITION_WIDTH = 768;

interface ArenaImagePayload {
	bucket: string;
	key: string;
	edits?: { resize?: { width?: number; height?: number } };
}

function decodePayload(url: string): ArenaImagePayload | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (parsed.host !== ARENA_IMAGE_HOST) return null;

	const segment = parsed.pathname.split('/').filter(Boolean).at(-1);
	if (!segment) return null;

	try {
		const payload: unknown = JSON.parse(Buffer.from(segment, 'base64').toString('utf8'));
		if (
			typeof payload !== 'object' ||
			payload === null ||
			typeof (payload as ArenaImagePayload).key !== 'string'
		) {
			return null;
		}
		return payload as ArenaImagePayload;
	} catch {
		return null;
	}
}

/**
 * The stable identity of the underlying image. This is deliberately the payload's `key`, not the
 * URL: the URL encodes the resize edits, which this module owns and will change, and hashing it
 * would invalidate every cache entry the first time the rendition width is tuned.
 */
export function imageSourceKey(url: string): string {
	const payload = decodePayload(url);
	if (payload) return `${payload.bucket}/${payload.key}`;

	try {
		const parsed = new URL(url);
		return `${parsed.host}${parsed.pathname}`;
	} catch {
		return url;
	}
}

export function imageSourceHash(url: string): string {
	return `sha256:${createHash('sha256').update(imageSourceKey(url)).digest('hex')}`;
}

/**
 * A URL for the same image at `width`, or the original when it isn't an Are.na resizer URL —
 * CloudFront-hosted GIFs have no payload to rewrite and are passed through untouched.
 */
export function renditionUrl(url: string, width = DEFAULT_RENDITION_WIDTH): string {
	if (!Number.isInteger(width) || width <= 0) {
		throw new RangeError(`rendition width must be a positive integer, got ${width}`);
	}

	const payload = decodePayload(url);
	if (!payload) return url;

	const resize = { ...payload.edits?.resize, width, height: width, fit: 'inside' as const };
	const next = { ...payload, edits: { ...payload.edits, resize } };
	return `https://${ARENA_IMAGE_HOST}/${Buffer.from(JSON.stringify(next)).toString('base64')}`;
}
