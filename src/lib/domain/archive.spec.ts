import { describe, expect, it } from 'vitest';
import { archiveBlockSchema, toSearchDocument } from './archive';

describe('toSearchDocument', () => {
	it('builds stable searchable text without inventing image content', () => {
		const document = toSearchDocument(
			archiveBlockSchema.parse({
				id: 42,
				type: 'Image',
				title: '  Brutalist  \n  window ',
				description: null,
				content: null,
				sourceTitle: 'Concrete studies',
				sourceUrl: 'https://example.com/source',
				arenaUrl: 'https://www.are.na/block/42',
				imageUrl: 'https://images.are.na/example.jpg',
				connectedAt: new Date('2026-01-02T03:04:05.000Z'),
				channels: [
					{ slug: 'architecture', title: 'Architecture' },
					{ slug: 'architecture', title: 'Architecture' }
				]
			})
		);

		expect(document).toMatchObject({
			id: 'block:42',
			search_text: 'Brutalist window\nConcrete studies\nArchitecture',
			channel_slugs: ['architecture'],
			connected_at: '2026-01-02T03:04:05.000Z'
		});
	});
});
