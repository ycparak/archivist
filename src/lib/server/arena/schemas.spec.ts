import { describe, expect, it } from 'vitest';
import { ARCHIVE_BLOCK_TYPES } from '$lib/domain/archive';
import {
	arenaChannelContentsResponseSchema,
	arenaContentItemSchema,
	arenaMeSchema,
	arenaOwnedChannelSchema,
	arenaOwnedChannelsResponseSchema
} from './schemas';

const markdown = { markdown: '**hi**', html: '<p>hi</p>', plain: 'hi' };
const connection = { connected_at: '2023-01-15T10:30:00Z' };
const imageVersion = { src: 'https://example.com/v.jpg' };
const image = {
	src: 'https://example.com/original.jpg',
	alt_text: null,
	small: imageVersion,
	medium: imageVersion,
	large: imageVersion,
	square: imageVersion
};

describe('arenaContentItemSchema', () => {
	it('parses a text block', () => {
		const item = arenaContentItemSchema.parse({
			id: 1,
			type: 'Text',
			title: 'Note',
			description: null,
			created_at: '2023-01-15T10:30:00Z',
			connection,
			content: markdown
		});
		expect(item).toMatchObject({ type: 'Text', content: markdown });
	});

	it('parses an image block', () => {
		const item = arenaContentItemSchema.parse({
			id: 2,
			type: 'Image',
			title: null,
			description: null,
			created_at: '2023-01-15T10:30:00Z',
			connection,
			image
		});
		expect(item).toMatchObject({ type: 'Image', image });
	});

	it('parses a link block with a source and no preview image', () => {
		const item = arenaContentItemSchema.parse({
			id: 3,
			type: 'Link',
			title: 'An article',
			description: markdown,
			source: { url: 'https://example.com/article', title: 'Original Title' },
			created_at: '2023-01-15T10:30:00Z',
			connection
		});
		expect(item).toMatchObject({ type: 'Link', source: { url: 'https://example.com/article' } });
	});

	it('parses an attachment block, keeping the download url', () => {
		const item = arenaContentItemSchema.parse({
			id: 4,
			type: 'Attachment',
			title: 'document.pdf',
			description: null,
			created_at: '2023-01-15T10:30:00Z',
			connection,
			attachment: { url: 'https://attachments.are.na/12345/document.pdf', file_extension: 'pdf' }
		});
		expect(item).toMatchObject({
			type: 'Attachment',
			attachment: { url: 'https://attachments.are.na/12345/document.pdf' }
		});
	});

	it('rejects an attachment block missing its required attachment payload', () => {
		expect(() =>
			arenaContentItemSchema.parse({
				id: 4,
				type: 'Attachment',
				title: 'document.pdf',
				description: null,
				created_at: '2023-01-15T10:30:00Z',
				connection
			})
		).toThrow();
	});

	it('parses an embed block, keeping the embed html/url', () => {
		const item = arenaContentItemSchema.parse({
			id: 5,
			type: 'Embed',
			title: 'A video',
			description: null,
			created_at: '2023-01-15T10:30:00Z',
			connection,
			embed: { url: 'https://www.youtube.com/watch?v=abc123', html: "<iframe src='...'></iframe>" }
		});
		expect(item).toMatchObject({
			type: 'Embed',
			embed: { url: 'https://www.youtube.com/watch?v=abc123' }
		});
	});

	it('rejects an embed block missing its required embed payload', () => {
		expect(() =>
			arenaContentItemSchema.parse({
				id: 5,
				type: 'Embed',
				title: 'A video',
				description: null,
				created_at: '2023-01-15T10:30:00Z',
				connection
			})
		).toThrow();
	});

	it('parses a nested channel, distinct from a block', () => {
		const item = arenaContentItemSchema.parse({
			id: 6,
			type: 'Channel',
			slug: 'nested-channel',
			title: 'Nested channel',
			connection
		});
		expect(item).toMatchObject({ type: 'Channel', slug: 'nested-channel' });
	});

	it('rejects an unrecognized discriminator instead of silently coercing it', () => {
		expect(() =>
			arenaContentItemSchema.parse({
				id: 7,
				type: 'User',
				connection
			})
		).toThrow();
	});

	it('accepts a block whose optional nullable fields are omitted, not just null', () => {
		const item = arenaContentItemSchema.parse({
			id: 8,
			type: 'Text',
			created_at: '2023-01-15T10:30:00Z',
			connection,
			content: markdown
		});
		expect(item).toMatchObject({ type: 'Text' });
		expect(item.title).toBeUndefined();
	});
});

describe('arenaChannelContentsResponseSchema', () => {
	it('parses a page mixing blocks and a nested channel without dropping either', () => {
		const response = arenaChannelContentsResponseSchema.parse({
			data: [
				{
					id: 1,
					type: 'Text',
					title: null,
					description: null,
					created_at: '2023-01-15T10:30:00Z',
					connection,
					content: markdown
				},
				{
					id: 2,
					type: 'Channel',
					slug: 'nested-channel',
					title: 'Nested channel',
					connection
				}
			],
			meta: {
				current_page: 1,
				next_page: 2,
				per_page: 50,
				total_pages: 3,
				total_count: 120,
				has_more_pages: true
			}
		});

		expect(response.data).toHaveLength(2);
		expect(response.data.map((item) => item.type)).toEqual(['Text', 'Channel']);
		expect(response.meta.has_more_pages).toBe(true);
	});
});

describe('arenaMeSchema', () => {
	it('parses just the fields discovery needs from /v3/me', () => {
		expect(
			arenaMeSchema.parse({ id: 558206, slug: 'yusuf-parak', email: 'ignored@example.com' })
		).toEqual({
			id: 558206,
			slug: 'yusuf-parak'
		});
	});
});

describe('arenaOwnedChannelSchema', () => {
	it('parses a channel from user-contents discovery without requiring a connection field', () => {
		const channel = arenaOwnedChannelSchema.parse({
			id: 5650061,
			type: 'Channel',
			slug: 'discover-earth',
			title: '❋ Discover Earth',
			owner: { id: 1 },
			counts: { blocks: 3 }
		});
		expect(channel).toEqual({
			id: 5650061,
			type: 'Channel',
			slug: 'discover-earth',
			title: '❋ Discover Earth'
		});
	});
});

describe('arenaOwnedChannelsResponseSchema', () => {
	it('parses a page of discovered channels', () => {
		const response = arenaOwnedChannelsResponseSchema.parse({
			data: [{ id: 1, type: 'Channel', slug: 'a', title: 'A' }],
			meta: {
				current_page: 1,
				next_page: null,
				per_page: 50,
				total_pages: 1,
				total_count: 1,
				has_more_pages: false
			}
		});
		expect(response.data).toHaveLength(1);
	});
});

describe('archive block vocabulary', () => {
	it('matches the block types the UI offers as filters', () => {
		const schemaBlockTypes = arenaContentItemSchema.options
			.map((option) => option.shape.type.value)
			.filter((blockType) => blockType !== 'Channel');

		expect([...schemaBlockTypes].sort()).toEqual([...ARCHIVE_BLOCK_TYPES].sort());
	});
});
