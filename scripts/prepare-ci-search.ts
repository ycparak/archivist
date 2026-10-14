import { access } from 'node:fs/promises';
import { toSearchDocument } from '$lib/domain/archive';
import { EMBEDDING } from '$lib/search/embedding';
import { buildSearchRelease } from '$lib/server/release/release-builder';
import { publishSearchRelease } from './search-files';

const output = new URL('../static/search/', import.meta.url);
try {
	await access(output);
	throw new Error(
		'CI search fixture requires static/search to be absent; preserve existing exports'
	);
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const channels = [{ slug: 'ci-fixture', title: 'CI fixture' }];
const document = toSearchDocument({
	id: '1',
	type: 'Text',
	title: 'CI build fixture',
	content: 'Synthetic content for the CI prerender check.',
	arenaUrl: 'https://www.are.na/block/1',
	channels
});
const { release, assets } = await buildSearchRelease([document], channels, async (texts) =>
	texts.map(() => Array.from({ length: EMBEDDING.dimensions }, (_, index) => Number(index === 0)))
);
await publishSearchRelease(output, release, assets);
console.log('Prepared synthetic search assets for CI only; never deploy this release.');
