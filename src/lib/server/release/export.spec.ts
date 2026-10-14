import { describe, expect, it, vi } from 'vitest';
import { ARCHIVE_COLOURS } from '$lib/domain/search';
import { toSearchDocument } from '$lib/domain/archive';
import { EMBEDDING } from '$lib/search/embedding';
import { decodeVectors, checkedAsset } from '$lib/search/assets';
import { embeddingChunks, EMBEDDING_CHUNK_BYTES, toPublicDocument } from './export';
import { buildSearchRelease } from './release-builder';

const doc = () =>
	toSearchDocument(
		{
			id: '1',
			type: 'Text',
			title: 'Original',
			content: 'blue fox',
			arenaUrl: 'https://www.are.na/block/1',
			channels: [{ slug: 'public', title: 'Public' }]
		},
		{ title: 'Generated', description: 'A blue fox', ocr: 'OCR', medium: 'image', tags: ['blue'] },
		Object.fromEntries(ARCHIVE_COLOURS.map((colour) => [colour, 0])) as Record<
			(typeof ARCHIVE_COLOURS)[number],
			number
		>
	);
const vector = () =>
	Array.from({ length: EMBEDDING.dimensions }, (_, index) => Number(index === 0));

describe('public export', () => {
	it('maps presentation and filter fields without exposing provider/vision bookkeeping', () => {
		const mapped = toPublicDocument(doc());
		expect(mapped.result.title).toBe('Original');
		expect(mapped.kind).toBe('Text');
		expect(JSON.stringify(mapped)).not.toContain('Generated');
		expect(mapped).not.toHaveProperty('vision_tags');
		expect(mapped.result.channelSlugs).toEqual(['public']);
	});
	it('bounds all Unicode and long-word chunks while retaining trailing descriptions and OCR', () => {
		const text = 'a'.repeat(1000) + ' 🦊 漢字 '.repeat(100) + 'trailing OCR';
		const chunks = embeddingChunks(text);
		expect(
			chunks.every((chunk) => new TextEncoder().encode(chunk).length <= EMBEDDING_CHUNK_BYTES)
		).toBe(true);
		expect(chunks.join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
		expect(chunks.at(-1)).toContain('trailing OCR');
	});
	it('builds checked assets, aligned normalized vectors and deterministic releases, reusing the cache', async () => {
		const embed = vi.fn(async (texts: string[]) => texts.map(vector));
		const cache = new Map<string, number[]>();
		const channels = [{ slug: 'public', title: 'Public' }];
		const built = await buildSearchRelease([doc()], channels, embed, cache);
		const repeated = await buildSearchRelease([doc()], channels, embed, cache);
		expect(embed).toHaveBeenCalledTimes(1);
		expect(repeated.release).toEqual(built.release);
		const asset = built.release.vectors[0];
		const bytes = built.assets.get(asset.file)!;
		const fetchFn = vi.fn(async () => new Response(new Uint8Array(bytes)));
		expect(decodeVectors(await checkedAsset(built.release, asset, fetchFn))).toEqual(
			new Float32Array(vector())
		);
	});
	it('rejects incomplete membership and embedding responses instead of publishing', async () => {
		await expect(buildSearchRelease([doc()], [], async () => [])).rejects.toThrow('empty');
		await expect(
			buildSearchRelease([doc()], [{ slug: 'public', title: 'Public' }], async () => [])
		).rejects.toThrow('count mismatch');
	});
	it('rejects corrupted asset bytes', async () => {
		const built = await buildSearchRelease(
			[doc()],
			[{ slug: 'public', title: 'Public' }],
			async (texts) => texts.map(vector)
		);
		const asset = built.release.vectors[0];
		await expect(
			checkedAsset(built.release, asset, async () => new Response(new Uint8Array(asset.bytes)))
		).rejects.toThrow('integrity');
	});
});
