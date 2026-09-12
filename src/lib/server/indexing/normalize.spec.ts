import { describe, expect, it } from 'vitest';
import { toArchiveBlock, type ChannelContext } from './normalize';

const channel: ChannelContext = { slug: 'architecture', title: 'Architecture' };
const connection = { connected_at: new Date('2023-01-15T10:30:00Z') };
const createdAt = new Date('2023-01-01T00:00:00Z');
const markdown = { markdown: '**hi**', html: '<p>hi</p>', plain: 'hi' };
const imageVersion = { src: 'https://example.com/v.jpg' };
const image = {
	src: 'https://example.com/original.jpg',
	alt_text: 'A concrete window frame',
	small: imageVersion,
	medium: imageVersion,
	large: { src: 'https://example.com/large.jpg', width: 800, height: 600 },
	square: imageVersion
};
const sharedFields = {
	id: 1,
	title: 'A title',
	description: markdown,
	source: { url: 'https://example.com/source', title: 'Source title' },
	created_at: createdAt,
	connection
};

describe('toArchiveBlock', () => {
	it('normalizes shared fields the same for every block type', () => {
		const block = toArchiveBlock({ ...sharedFields, type: 'Text', content: markdown }, channel);

		expect(block).toMatchObject({
			id: '1',
			title: 'A title',
			description: 'hi',
			sourceTitle: 'Source title',
			sourceUrl: 'https://example.com/source',
			arenaUrl: 'https://www.are.na/block/1',
			createdAt,
			connectedAt: connection.connected_at,
			channels: [channel]
		});
	});

	it('normalizes a Text block: plain content, no image', () => {
		const block = toArchiveBlock({ ...sharedFields, type: 'Text', content: markdown }, channel);
		expect(block.content).toBe('hi');
		expect(block.imageUrl).toBeNull();
		expect(block.imageAlt).toBeNull();
		expect(block.imageWidth).toBeNull();
		expect(block.imageHeight).toBeNull();
	});

	it('normalizes an Image block: no content, required image, alt text and large-version dimensions', () => {
		const block = toArchiveBlock({ ...sharedFields, type: 'Image', image }, channel);
		expect(block.content).toBeNull();
		expect(block.imageUrl).toBe('https://example.com/large.jpg');
		expect(block.imageAlt).toBe('A concrete window frame');
		expect(block.imageWidth).toBe(800);
		expect(block.imageHeight).toBe(600);
	});

	it('falls back to null image metadata when Are.na supplies no alt text or dimensions', () => {
		const bareImage = {
			src: 'https://example.com/original.jpg',
			small: imageVersion,
			medium: imageVersion,
			large: imageVersion,
			square: imageVersion
		};
		const block = toArchiveBlock({ ...sharedFields, type: 'Image', image: bareImage }, channel);
		expect(block.imageAlt).toBeNull();
		expect(block.imageWidth).toBeNull();
		expect(block.imageHeight).toBeNull();
	});

	it('normalizes a Link block with extracted content and a preview image', () => {
		const block = toArchiveBlock(
			{ ...sharedFields, type: 'Link', content: markdown, image },
			channel
		);
		expect(block.content).toBe('hi');
		expect(block.imageUrl).toBe('https://example.com/large.jpg');
		expect(block.imageAlt).toBe('A concrete window frame');
		expect(block.imageWidth).toBe(800);
	});

	it('normalizes a Link block with neither extracted content nor a preview image', () => {
		const block = toArchiveBlock({ ...sharedFields, type: 'Link' }, channel);
		expect(block.content).toBeNull();
		expect(block.imageUrl).toBeNull();
		expect(block.imageAlt).toBeNull();
		expect(block.imageWidth).toBeNull();
		expect(block.imageHeight).toBeNull();
	});

	it('normalizes an Attachment block: no content, optional preview image', () => {
		const attachment = { url: 'https://attachments.are.na/1/doc.pdf' };

		const withPreview = toArchiveBlock(
			{ ...sharedFields, type: 'Attachment', attachment, image },
			channel
		);
		expect(withPreview.content).toBeNull();
		expect(withPreview.imageUrl).toBe('https://example.com/large.jpg');
		expect(withPreview.imageAlt).toBe('A concrete window frame');
		expect(withPreview.imageHeight).toBe(600);

		const withoutPreview = toArchiveBlock(
			{ ...sharedFields, type: 'Attachment', attachment },
			channel
		);
		expect(withoutPreview.imageUrl).toBeNull();
		expect(withoutPreview.imageAlt).toBeNull();
	});

	it('normalizes an Embed block: no content, optional thumbnail image', () => {
		const embed = { url: 'https://youtube.com/watch?v=1' };
		const block = toArchiveBlock({ ...sharedFields, type: 'Embed', embed, image }, channel);
		expect(block.content).toBeNull();
		expect(block.imageUrl).toBe('https://example.com/large.jpg');
		expect(block.imageAlt).toBe('A concrete window frame');
		expect(block.imageWidth).toBe(800);
		expect(block.imageHeight).toBe(600);
	});

	it('falls back to the embed/attachment title field when the block itself has none', () => {
		const untitled = { ...sharedFields, title: null };

		const embedBlock = toArchiveBlock(
			{
				...untitled,
				type: 'Embed',
				embed: { url: 'https://youtube.com/watch?v=1', title: 'Embed title' }
			},
			channel
		);
		expect(embedBlock.title).toBe('Embed title');

		const attachmentBlock = toArchiveBlock(
			{
				...untitled,
				type: 'Attachment',
				attachment: { url: 'https://attachments.are.na/1/doc.pdf', filename: 'doc.pdf' }
			},
			channel
		);
		expect(attachmentBlock.title).toBe('doc.pdf');
	});

	it('is null, not the fallback field, when neither the block nor the type-specific field has a title', () => {
		const untitled = { ...sharedFields, title: null };

		const embedBlock = toArchiveBlock(
			{ ...untitled, type: 'Embed', embed: { url: 'https://youtube.com/watch?v=1' } },
			channel
		);
		expect(embedBlock.title).toBeNull();

		const attachmentBlock = toArchiveBlock(
			{
				...untitled,
				type: 'Attachment',
				attachment: { url: 'https://attachments.are.na/1/doc.pdf' }
			},
			channel
		);
		expect(attachmentBlock.title).toBeNull();
	});

	it('falls back to null for every optional field when Are.na supplies none of them', () => {
		const block = toArchiveBlock(
			{ id: 2, type: 'Text', created_at: createdAt, connection, content: markdown },
			channel
		);

		expect(block).toMatchObject({
			title: null,
			description: null,
			sourceTitle: null,
			sourceUrl: null
		});
	});
});
