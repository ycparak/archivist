import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import ArchiveIndex from './ArchiveIndex.svelte';
import SearchField from './SearchField.svelte';
import Shelf from './Shelf.svelte';
import ShelfBlock from './ShelfBlock.svelte';
import { layoutShelves } from './shelf';
import {
	emptyArchiveSearchState,
	readArchiveSearchState,
	type ArchiveSearchState,
	type ChannelManifestEntry,
	type SearchResult
} from '$lib/domain/search';

function state(overrides: Partial<ArchiveSearchState> = {}): ArchiveSearchState {
	return { ...emptyArchiveSearchState, ...overrides };
}

function result(overrides: Partial<SearchResult> = {}): SearchResult {
	return {
		id: 'block:1',
		title: 'Industrial felt',
		description: null,
		blockType: 'Image',
		channelSlugs: ['materials'],
		connectedAt: '2024-01-02T00:00:00.000Z',
		sourceUrl: null,
		arenaUrl: 'https://www.are.na/block/1',
		imageUrl: 'https://images.are.na/felt.jpg',
		imageAlt: null,
		imageWidth: null,
		imageHeight: null,
		videoUrl: null,
		videoContentType: null,
		sourceTitle: null,
		...overrides
	};
}

const channels: ChannelManifestEntry[] = [
	{ slug: 'materials', title: 'Materials' },
	{ slug: 'references', title: 'References' }
];

type Link = { label: string; url: URL; current: boolean };

/** Every link in the markup, its visible label or aria-label, and whether it is marked current. */
function linksIn(body: string): Link[] {
	return [...body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => {
		const attributes = match[1];
		const href = /href="([^"]*)"/.exec(attributes)?.[1] ?? '';
		const ariaLabel = /aria-label="([^"]*)"/.exec(attributes)?.[1];
		const text = match[2].replace(/<[^>]*>/g, '').trim();
		return {
			label: (ariaLabel ?? text).replaceAll('&amp;', '&'),
			url: new URL(href.replaceAll('&amp;', '&'), 'https://archivist.test'),
			current: /aria-current="true"/.test(attributes)
		};
	});
}

function linkTo(body: string, label: string): Link {
	const link = linksIn(body).find((candidate) => candidate.label === label);
	if (!link) throw new Error(`No link labelled ${label}`);
	return link;
}

function stateAt(link: Link): ArchiveSearchState {
	return readArchiveSearchState(link.url.searchParams);
}

describe('SearchField markup', () => {
	it('submits to the archive surface with a GET so the URL stays the source of truth', () => {
		const { body } = render(SearchField, { props: { search: state(), onnavigate: () => {} } });

		expect(body).toContain('method="GET"');
		expect(body).toContain('action="/"');
		expect(body).toContain('role="search"');
	});

	it('names the field with the query parameter and labels it', () => {
		const { body } = render(SearchField, {
			props: { search: state({ query: 'felt' }), onnavigate: () => {} }
		});

		expect(body).toMatch(/<textarea[^>]*name="q"/);
		expect(body).toMatch(/<textarea[^>]*id="archive-query"/);
		expect(body).toContain('for="archive-query"');
		expect(body).toContain('felt');
	});

	it('carries every active filter as a hidden field so a submit without JavaScript keeps it', () => {
		const { body } = render(SearchField, {
			props: {
				search: state({
					channelSlugs: ['materials', 'unlisted'],
					blockTypes: ['Image'],
					colours: ['blue'],
					from: '2024-01-01',
					to: '2024-06-30'
				}),
				onnavigate: () => {}
			}
		});

		const hidden = [...body.matchAll(/<input\b[^>]*type="hidden"[^>]*>/g)].map((match) => {
			const field = match[0];
			return [/name="([^"]*)"/.exec(field)?.[1], /value="([^"]*)"/.exec(field)?.[1]];
		});
		expect(hidden).toEqual([
			['channel', 'materials'],
			['channel', 'unlisted'],
			['type', 'Image'],
			['colour', 'blue'],
			['from', '2024-01-01'],
			['to', '2024-06-30']
		]);
	});

	it('carries a chosen ranking but leaves out browse order, which is invalid beside a query', () => {
		const { body } = render(SearchField, {
			props: {
				search: state({ mode: 'lexical', sort: 'oldest-created' }),
				onnavigate: () => {}
			}
		});

		expect(body).toMatch(/<input[^>]*type="hidden"[^>]*name="mode"[^>]*value="lexical"/);
		expect(body).not.toMatch(/name="sort"/);
	});
});

describe('ArchiveIndex markup', () => {
	function index(search: ArchiveSearchState, list = channels) {
		return render(ArchiveIndex, {
			props: { search, channels: list, blockCount: 2546, onnavigate: () => {} }
		}).body;
	}

	it('links every channel to the same search with that channel toggled', () => {
		const body = index(state({ query: 'felt', channelSlugs: ['materials'] }));

		const materials = linkTo(body, 'Materials');
		expect(materials.current).toBe(true);
		expect(stateAt(materials)).toMatchObject({ query: 'felt', channelSlugs: [] });

		const references = linkTo(body, 'References');
		expect(references.current).toBe(false);
		expect(stateAt(references).channelSlugs).toEqual(['materials', 'references']);
	});

	it('keeps a channel filter the manifest does not list in every link', () => {
		const body = index(state({ channelSlugs: ['unlisted'] }));

		expect(stateAt(linkTo(body, 'Image')).channelSlugs).toEqual(['unlisted']);
		expect(stateAt(linkTo(body, 'Materials')).channelSlugs).toEqual(['unlisted', 'materials']);
	});

	it('always offers a ranking, and offers browse order only without a query', () => {
		const browsing = index(state());
		expect(linkTo(browsing, 'Best match').current).toBe(true);
		expect(stateAt(linkTo(browsing, 'Exact words')).mode).toBe('lexical');
		expect(stateAt(linkTo(browsing, 'Newest created')).sort).toBe('newest-created');
		expect(linkTo(browsing, 'Most connected').current).toBe(true);

		const querying = index(state({ query: 'felt', mode: 'hybrid' }));
		expect(linkTo(querying, 'Best match').current).toBe(true);
		expect(stateAt(linkTo(querying, 'Related ideas'))).toMatchObject({
			query: 'felt',
			mode: 'semantic'
		});
		expect(linksIn(querying).some((link) => link.label === 'Newest created')).toBe(false);
		expect(querying).toMatch(/aria-disabled="true"[^>]*>Newest created/);
	});

	it('toggles block types and colours, and stops offering colours past the limit', () => {
		const body = index(state({ blockTypes: ['Image'], colours: ['red'] }));
		expect(linkTo(body, 'Image').current).toBe(true);
		expect(stateAt(linkTo(body, 'Web')).blockTypes).toEqual(['Image', 'Web']);
		expect(linksIn(body).map((link) => link.label)).toEqual(
			expect.arrayContaining(['Image', 'Video', 'GIF', 'Web', 'Text', 'Attachment', 'Embed'])
		);
		expect(linkTo(body, 'Red').current).toBe(true);
		expect(stateAt(linkTo(body, 'Black & white')).colours).toEqual(['red', 'mono']);

		const full = index(state({ colours: ['red', 'orange', 'yellow', 'green', 'blue'] }));
		expect(linksIn(full).some((link) => link.label === 'Brown')).toBe(false);
		expect(stateAt(linkTo(full, 'Red')).colours).toEqual(['orange', 'yellow', 'green', 'blue']);
	});

	it('names both ends of each date slider for a screen reader', () => {
		const body = index(state());

		expect(body).toMatch(/<input[^>]*type="range"[^>]*aria-label="Created from"/);
		expect(body).toMatch(/<input[^>]*type="range"[^>]*aria-label="Created until"/);

		expect(body).toMatch(/<input[^>]*type="range"[^>]*aria-label="Connected from"/);
		expect(body).toMatch(/<input[^>]*type="range"[^>]*aria-label="Connected until"/);
	});

	it('counts the channels and blocks in the archive in the footer', () => {
		const body = index(state());

		expect(body).toContain('2 channels');
		expect(body).toContain('2,546 blocks');
	});

	it('renders no channel list when the manifest is empty', () => {
		expect(index(state(), [])).not.toContain('>Channel<');
	});
});

describe('Shelf markup', () => {
	function shelf(results: SearchResult[], query = '') {
		return render(Shelf, {
			props: {
				layout: layoutShelves([results], new Map(channels.map((c) => [c.slug, c])), []),
				requestKey: '/',
				query,
				coverHref: () => '/?channel=materials' as const,
				isActiveChannel: () => false,
				onloadmore: () => {}
			}
		}).body;
	}

	it('opens each channel with a cover that filters by it, captioned with its title and count', () => {
		const body = shelf([
			result(),
			result({ id: 'block:2', arenaUrl: 'https://www.are.na/block/2' })
		]);

		const cover = linkTo(body, 'Show only Materials');
		expect(cover.url.searchParams.getAll('channel')).toEqual(['materials']);
		expect(body).toContain('2 blocks');
	});

	it('captions a block with its connection date and highlights the query in its words', () => {
		const body = shelf([result({ title: 'Industrial felt offcuts' })], 'felt');

		expect(body).toContain('2 Jan 2024');
		expect(body).toMatch(/<mark[^>]*>felt<\/mark>/);
	});

	it('marks only the top row of captions for the search field to watch', () => {
		const body = shelf([
			result(),
			result({
				id: 'block:9',
				channelSlugs: ['references'],
				arenaUrl: 'https://www.are.na/block/9'
			})
		]);

		expect(body.match(/data-top-annotation/g)).toHaveLength(2);
	});
});

describe('ShelfBlock markup', () => {
	it('links the block to Are.na, named by its title, without letting the router claim it', () => {
		const { body } = render(ShelfBlock, { props: { result: result() } });

		expect(body).toMatch(
			/<a[^>]*href="https:\/\/www\.are\.na\/block\/1"[^>]*rel="external noopener noreferrer"/
		);
		expect(linkTo(body, 'Industrial felt').url.href).toBe('https://www.are.na/block/1');
	});

	it("uses Are.na's own alt text when the block image has it", () => {
		const { body } = render(ShelfBlock, {
			props: { result: result({ imageAlt: 'A felt swatch' }) }
		});

		expect(body).toContain('alt="A felt swatch"');
	});

	it('lazy-loads by default and eagerly for the first blocks', () => {
		expect(render(ShelfBlock, { props: { result: result() } }).body).toContain('loading="lazy"');
		expect(render(ShelfBlock, { props: { result: result(), eager: true } }).body).toContain(
			'loading="eager"'
		);
	});

	it('sets a page of text for a block without an image rather than an empty frame', () => {
		const { body } = render(ShelfBlock, {
			props: {
				result: result({ imageUrl: null, blockType: 'Text', description: 'Notes on felt' })
			}
		});

		expect(body).not.toContain('<img');
		expect(body).toContain('Notes on felt');
	});

	it('labels an untitled block by its type without inventing archive metadata', () => {
		const { body } = render(ShelfBlock, {
			props: { result: result({ title: null, blockType: 'Image' }) }
		});

		expect(body).toContain('aria-label="Untitled image"');
	});
});

describe('ShelfBlock markup — video blocks', () => {
	const video = (overrides: Partial<SearchResult> = {}) =>
		result({
			blockType: 'Attachment',
			videoUrl: 'https://attachments.are.na/1/abc.mp4',
			videoContentType: 'video/mp4',
			...overrides
		});

	it('plays the attachment instead of showing its thumbnail', () => {
		const { body } = render(ShelfBlock, { props: { result: video() } });

		expect(body).toContain('<video');
		expect(body).toContain('src="https://attachments.are.na/1/abc.mp4"');
		expect(body).toContain('type="video/mp4"');
		expect(body).not.toContain('<img');
	});

	/**
	 * The one failure that would only ever show up in production: an unmuted video is not allowed
	 * to autoplay, and if the attribute is missing from the server markup the first paint is
	 * already wrong before any script runs.
	 */
	it('carries muted in the server markup, or autoplay is refused outright', () => {
		expect(render(ShelfBlock, { props: { result: video() } }).body).toContain('muted=""');
	});

	it('loops, plays inline, asks for no more than metadata, and shows no controls', () => {
		const { body } = render(ShelfBlock, { props: { result: video() } });

		expect(body).toContain('loop');
		expect(body).toContain('playsinline');
		expect(body).toContain('preload="metadata"');
		expect(body).not.toContain('controls');
	});

	it('uses the thumbnail as the poster, so the page looks the same before the first frame', () => {
		expect(render(ShelfBlock, { props: { result: video() } }).body).toContain(
			'poster="https://images.are.na/felt.jpg"'
		);
	});

	it('still shows a thumbnail for an Embed, which has no playable file', () => {
		const { body } = render(ShelfBlock, { props: { result: result({ blockType: 'Embed' }) } });

		expect(body).not.toContain('<video');
		expect(body).toContain('<img');
	});
});
