import { describe, expect, it } from 'vitest';
import {
	DEFAULT_RENDITION_WIDTH,
	imageSourceHash,
	imageSourceKey,
	renditionUrl
} from './rendition';

/** A real archive URL, captured from `block:49584987`. */
const ARENA_PAYLOAD = {
	bucket: 'arena_images',
	key: '49584987/original_2d9ddb6bcb56040702d60239b006789e.png',
	edits: {
		resize: { width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true },
		webp: { quality: 75 },
		jpeg: { quality: 75 },
		rotate: null
	}
};
const ARENA_URL = `https://images.are.na/${Buffer.from(JSON.stringify(ARENA_PAYLOAD)).toString('base64')}`;

/** Animated GIFs live on CloudFront with no resizer payload. */
const CLOUDFRONT_URL = 'https://d2w9rnfcy7mm78.cloudfront.net/36923691/original_47c37af874751d.gif';

function decode(url: string) {
	return JSON.parse(
		Buffer.from(new URL(url).pathname.split('/').filter(Boolean).at(-1)!, 'base64').toString()
	);
}

describe('renditionUrl', () => {
	it('rewrites the resize edit to the requested width', () => {
		const decoded = decode(renditionUrl(ARENA_URL, 768));
		expect(decoded.edits.resize).toMatchObject({ width: 768, height: 768, fit: 'inside' });
	});

	it('preserves the source and every unrelated edit', () => {
		const decoded = decode(renditionUrl(ARENA_URL, 512));
		expect(decoded.bucket).toBe(ARENA_PAYLOAD.bucket);
		expect(decoded.key).toBe(ARENA_PAYLOAD.key);
		expect(decoded.edits.jpeg).toEqual({ quality: 75 });
		expect(decoded.edits.withoutEnlargement).toBeUndefined();
		expect(decoded.edits.resize.withoutEnlargement).toBe(true);
	});

	it('defaults to a width that keeps typography legible', () => {
		expect(decode(renditionUrl(ARENA_URL)).edits.resize.width).toBe(DEFAULT_RENDITION_WIDTH);
	});

	it('passes through a URL it cannot rewrite rather than corrupting it', () => {
		expect(renditionUrl(CLOUDFRONT_URL)).toBe(CLOUDFRONT_URL);
		expect(renditionUrl('not a url')).toBe('not a url');
		expect(renditionUrl('https://images.are.na/not-base64!!')).toBe(
			'https://images.are.na/not-base64!!'
		);
	});

	it('rejects a nonsensical width instead of emitting a broken URL', () => {
		expect(() => renditionUrl(ARENA_URL, 0)).toThrow(RangeError);
		expect(() => renditionUrl(ARENA_URL, -768)).toThrow(RangeError);
		expect(() => renditionUrl(ARENA_URL, 76.8)).toThrow(RangeError);
	});
});

describe('imageSourceKey', () => {
	it('identifies the underlying source, not the rendition', () => {
		const key = imageSourceKey(ARENA_URL);
		expect(key).toBe(`${ARENA_PAYLOAD.bucket}/${ARENA_PAYLOAD.key}`);
		expect(imageSourceKey(renditionUrl(ARENA_URL, 512))).toBe(key);
		expect(imageSourceKey(renditionUrl(ARENA_URL, 1024))).toBe(key);
	});

	it('falls back to host and path for a non-resizer URL', () => {
		expect(imageSourceKey(CLOUDFRONT_URL)).toBe(
			'd2w9rnfcy7mm78.cloudfront.net/36923691/original_47c37af874751d.gif'
		);
	});

	it('ignores a query string, which carries no source identity', () => {
		expect(imageSourceKey(`${CLOUDFRONT_URL}?v=2`)).toBe(imageSourceKey(CLOUDFRONT_URL));
	});
});

describe('imageSourceHash', () => {
	it('is stable across rendition widths, so tuning the width costs nothing', () => {
		expect(imageSourceHash(renditionUrl(ARENA_URL, 768))).toBe(
			imageSourceHash(renditionUrl(ARENA_URL, 256))
		);
	});

	it('changes when the underlying image changes', () => {
		const replaced = { ...ARENA_PAYLOAD, key: '49584987/original_ffffffff.png' };
		const url = `https://images.are.na/${Buffer.from(JSON.stringify(replaced)).toString('base64')}`;
		expect(imageSourceHash(url)).not.toBe(imageSourceHash(ARENA_URL));
	});
});
