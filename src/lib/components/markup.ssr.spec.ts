import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import ResultCard from './ResultCard.svelte';
import SearchForm from './SearchForm.svelte';
import {
	emptyArchiveSearchState,
	readArchiveSearchStateFromEntries,
	toArchiveSearchHref,
	type ArchiveSearchState,
	type SearchResult
} from '$lib/domain/search';

function hrefsIn(body: string): URL[] {
	return [...body.matchAll(/href="([^"]*)"/g)].map(
		(match) => new URL(match[1].replaceAll('&amp;', '&'), 'https://archivist.test')
	);
}

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

describe('SearchForm markup', () => {
	it('submits to the archive surface with a GET so the URL stays the source of truth', () => {
		const { body } = render(SearchForm, {
			props: { state: state(), channels: [], onnavigate: () => {} }
		});

		expect(body).toContain('method="GET"');
		expect(body).toContain('action="/"');
	});

	it('carries an active channel filter the manifest does not list as a hidden field so a submit cannot drop it', () => {
		const { body } = render(SearchForm, {
			props: {
				state: state({ channelSlugs: ['materials', 'type'] }),
				channels: [],
				onnavigate: () => {}
			}
		});

		const hidden = [...body.matchAll(/<input\b[^>]*type="hidden"[^>]*>/g)].map((match) => match[0]);
		expect(hidden).toHaveLength(2);
		for (const slug of ['materials', 'type']) {
			expect(hidden.some((field) => field.includes(`value="${slug}"`))).toBe(true);
		}
		expect(hidden.every((field) => field.includes('name="channel"'))).toBe(true);
	});

	it('lists every manifest channel as a checkbox, checking only the active ones', () => {
		const { body } = render(SearchForm, {
			props: {
				state: state({ channelSlugs: ['materials'] }),
				channels: [
					{ slug: 'materials', title: 'Materials' },
					{ slug: 'references', title: 'References' }
				],
				onnavigate: () => {}
			}
		});

		const checkboxes = [...body.matchAll(/<input\b[^>]*type="checkbox"[^>]*>/g)].map(
			(match) => match[0]
		);
		const channelCheckboxes = checkboxes.filter((field) => field.includes('name="channel"'));
		expect(channelCheckboxes).toHaveLength(2);
		const checked = channelCheckboxes.filter((field) => /\bchecked\b/.test(field));
		expect(checked).toHaveLength(1);
		expect(checked[0]).toContain('value="materials"');
		expect(body).toContain('References');
	});

	it('still preserves a channel filter the manifest does not list, alongside listed ones', () => {
		const { body } = render(SearchForm, {
			props: {
				state: state({ channelSlugs: ['materials', 'unlisted-channel'] }),
				channels: [{ slug: 'materials', title: 'Materials' }],
				onnavigate: () => {}
			}
		});

		const hidden = [...body.matchAll(/<input\b[^>]*type="hidden"[^>]*>/g)].map((match) => match[0]);
		expect(hidden).toHaveLength(1);
		expect(hidden[0]).toContain('value="unlisted-channel"');

		const checkboxes = [...body.matchAll(/<input\b[^>]*type="checkbox"[^>]*>/g)].map(
			(match) => match[0]
		);
		const checkedChannel = checkboxes.filter(
			(field) => field.includes('name="channel"') && /\bchecked\b/.test(field)
		);
		expect(checkedChannel).toHaveLength(1);
		expect(checkedChannel[0]).toContain('value="materials"');
	});

	it('renders no channel fieldset when the manifest is empty', () => {
		const { body } = render(SearchForm, {
			props: { state: state(), channels: [], onnavigate: () => {} }
		});

		expect(body).not.toContain('Channel');
	});

	it('rebuilds the same URL from what the form submits, filters included', () => {
		const submitted = state({
			query: 'felt',
			mode: 'lexical',
			channelSlugs: ['materials'],
			blockTypes: ['Image'],
			from: '2024-01-02',
			to: '2024-01-31'
		});

		const entries: [string, string][] = [
			['q', submitted.query],
			['mode', submitted.mode],
			['type', 'Image'],
			['from', submitted.from],
			['to', submitted.to],
			['channel', 'materials']
		];

		expect(toArchiveSearchHref(readArchiveSearchStateFromEntries(entries))).toBe(
			toArchiveSearchHref(submitted)
		);
	});

	it('drops a blank date and an inapplicable ranking from what the form submits', () => {
		const entries: [string, string][] = [
			['q', ''],
			['mode', 'semantic'],
			['from', ''],
			['to', '']
		];

		expect(toArchiveSearchHref(readArchiveSearchStateFromEntries(entries))).toBe('/');
	});

	it('names every control with the parameter the search request expects', () => {
		const { body } = render(SearchForm, {
			props: {
				state: state({
					query: 'felt',
					blockTypes: ['Image'],
					from: '2024-01-02',
					to: '2024-01-31'
				}),
				channels: [],
				onnavigate: () => {}
			}
		});

		for (const name of ['q', 'mode', 'type', 'from', 'to']) {
			expect(body).toContain(`name="${name}"`);
		}
		expect(body).toContain('value="felt"');
		expect(body).toContain('value="2024-01-02"');
		expect(body).toContain('value="2024-01-31"');
	});

	it('associates a label with every visible control', () => {
		const { body } = render(SearchForm, {
			props: { state: state(), channels: [], onnavigate: () => {} }
		});

		for (const id of ['archive-query', 'archive-mode', 'archive-from', 'archive-to']) {
			expect(body).toContain(`for="${id}"`);
			expect(body).toContain(`id="${id}"`);
		}
	});

	it('marks the checkbox for an active block type filter', () => {
		const { body } = render(SearchForm, {
			props: { state: state({ blockTypes: ['Image'] }), channels: [], onnavigate: () => {} }
		});

		const checkboxes = [...body.matchAll(/<input\b[^>]*type="checkbox"[^>]*>/g)].map(
			(match) => match[0]
		);
		const checked = checkboxes.filter((field) => /\bchecked\b/.test(field));
		expect(checked).toHaveLength(1);
		expect(checked[0]).toContain('value="Image"');
	});

	it('shows the ranking the URL asked for', () => {
		const { body } = render(SearchForm, {
			props: {
				state: state({ query: 'felt', mode: 'semantic' }),
				channels: [],
				onnavigate: () => {}
			}
		});

		expect(body).toMatch(/<option[^>]*value="semantic"[^>]*selected/);
		expect(body).not.toMatch(/<option[^>]*value="lexical"[^>]*selected/);
	});
});

describe('ResultCard markup', () => {
	it('links the block to Are.na and leaves its image alt empty inside that named link', () => {
		const { body } = render(ResultCard, { props: { result: result() } });

		expect(body).toContain('href="https://www.are.na/block/1"');
		expect(body).toContain('Industrial felt');
		expect(body).toContain('alt=""');
	});

	it("uses Are.na's own alt text when the block image has it", () => {
		const { body } = render(ResultCard, {
			props: { result: result({ imageAlt: 'A felt swatch' }) }
		});

		expect(body).toContain('alt="A felt swatch"');
	});

	it('sets intrinsic width/height attributes and drops the fixed placeholder box when Are.na supplies dimensions', () => {
		const { body } = render(ResultCard, {
			props: { result: result({ imageWidth: 800, imageHeight: 600 }) }
		});

		expect(body).toContain('width="800"');
		expect(body).toContain('height="600"');
		expect(body).not.toContain('aspect-4/3');
	});

	it('falls back to the fixed placeholder box when Are.na supplies no dimensions', () => {
		const { body } = render(ResultCard, { props: { result: result() } });

		expect(body).toContain('aspect-4/3');
	});

	it('lazy-loads by default and eagerly for the first cards', () => {
		expect(render(ResultCard, { props: { result: result() } }).body).toContain('loading="lazy"');
		expect(render(ResultCard, { props: { result: result(), eager: true } }).body).toContain(
			'loading="eager"'
		);
	});

	it('renders a block without an image as text rather than an empty frame', () => {
		const { body } = render(ResultCard, {
			props: { result: result({ imageUrl: null, blockType: 'Text' }) }
		});

		expect(body).not.toContain('<img');
		expect(body).toContain('Industrial felt');
	});

	it('labels an untitled block by its type without inventing archive metadata', () => {
		const { body } = render(ResultCard, {
			props: { result: result({ title: null, blockType: 'Image' }) }
		});

		expect(body).toContain('Untitled image');
	});
});

describe('ResultCard markup — video blocks', () => {
	const video = (overrides: Partial<SearchResult> = {}) =>
		result({
			blockType: 'Attachment',
			videoUrl: 'https://attachments.are.na/1/abc.mp4',
			videoContentType: 'video/mp4',
			...overrides
		});

	it('plays the attachment instead of showing its thumbnail', () => {
		const { body } = render(ResultCard, { props: { result: video() } });

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
		expect(render(ResultCard, { props: { result: video() } }).body).toContain('muted=""');
	});

	it('loops, plays inline, and asks for no more than metadata up front', () => {
		const { body } = render(ResultCard, { props: { result: video() } });

		expect(body).toContain('loop');
		expect(body).toContain('playsinline');
		expect(body).toContain('preload="metadata"');
	});

	/** The card is a link; a control strip inside it would fight every click. */
	it('shows no controls', () => {
		expect(render(ResultCard, { props: { result: video() } }).body).not.toContain('controls');
	});

	it('uses the thumbnail as the poster, so the card looks the same before the first frame', () => {
		const { body } = render(ResultCard, { props: { result: video() } });

		expect(body).toContain('poster="https://images.are.na/felt.jpg"');
	});

	it('names the video for a screen reader, since it has no alt text of its own', () => {
		expect(
			render(ResultCard, { props: { result: video({ imageAlt: 'A glass marble rolling' }) } }).body
		).toContain('aria-label="A glass marble rolling"');

		expect(
			render(ResultCard, { props: { result: video({ title: 'Glass in motion' }) } }).body
		).toContain('aria-label="Glass in motion"');
	});

	it('keeps the aspect box it would have used for the thumbnail', () => {
		const { body } = render(ResultCard, {
			props: { result: video({ imageWidth: 800, imageHeight: 600 }) }
		});

		expect(body).toContain('width="800"');
		expect(body).not.toContain('aspect-4/3');
	});

	it('leaves every other block on the image path', () => {
		const { body } = render(ResultCard, { props: { result: result() } });

		expect(body).not.toContain('<video');
		expect(body).toContain('<img');
	});

	it('still shows a thumbnail for an Embed, which has no playable file', () => {
		const { body } = render(ResultCard, {
			props: { result: result({ blockType: 'Embed' }) }
		});

		expect(body).not.toContain('<video');
		expect(body).toContain('<img');
	});

	it('shows only the block title and a link to Are.na, without channels or other metadata', () => {
		const { body } = render(ResultCard, {
			props: {
				result: result({ description: null, sourceTitle: 'A book', channelSlugs: ['materials'] })
			}
		});

		expect(body).not.toContain('materials');
		expect(body).not.toContain('A book');
		expect(hrefsIn(body)).toHaveLength(1);
	});

	it('sends the block link to Are.na without letting the router claim it', () => {
		const { body } = render(ResultCard, { props: { result: result() } });

		expect(body).toMatch(
			/<a[^>]*href="https:\/\/www\.are\.na\/block\/1"[^>]*rel="external noopener noreferrer"/
		);
	});
});
