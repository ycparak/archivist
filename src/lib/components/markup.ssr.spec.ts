import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import ResultCard from './ResultCard.svelte';
import SearchForm from './SearchForm.svelte';
import {
	emptyArchiveSearchState,
	type ArchiveSearchState,
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
		sourceTitle: null,
		...overrides
	};
}

describe('SearchForm markup', () => {
	it('submits to the archive surface with a GET so the URL stays the source of truth', () => {
		const { body } = render(SearchForm, {
			props: { state: state(), onnavigate: () => {} }
		});

		expect(body).toContain('method="GET"');
		expect(body).toContain('action="/"');
	});

	it('carries active channel filters as hidden fields so a submit cannot drop them', () => {
		const { body } = render(SearchForm, {
			props: { state: state({ channelSlugs: ['materials', 'type'] }), onnavigate: () => {} }
		});

		expect(body).toContain('<input type="hidden" name="channel" value="materials"');
		expect(body).toContain('<input type="hidden" name="channel" value="type"');
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
			props: { state: state(), onnavigate: () => {} }
		});

		for (const id of ['archive-query', 'archive-mode', 'archive-from', 'archive-to']) {
			expect(body).toContain(`for="${id}"`);
			expect(body).toContain(`id="${id}"`);
		}
	});

	it('marks the checkbox for an active block type filter', () => {
		const { body } = render(SearchForm, {
			props: { state: state({ blockTypes: ['Image'] }), onnavigate: () => {} }
		});

		expect(body).toMatch(/value="Image"[^>]*checked/);
		expect(body).not.toMatch(/value="Text"[^>]*checked/);
	});
});

describe('ResultCard markup', () => {
	it('links the block to Are.na and leaves its image alt empty inside that named link', () => {
		const { body } = render(ResultCard, { props: { result: result(), state: state() } });

		expect(body).toContain('href="https://www.are.na/block/1"');
		expect(body).toContain('Industrial felt');
		expect(body).toContain('alt=""');
	});

	it('lazy-loads by default and eagerly for the first cards', () => {
		expect(render(ResultCard, { props: { result: result(), state: state() } }).body).toContain(
			'loading="lazy"'
		);
		expect(
			render(ResultCard, { props: { result: result(), state: state(), eager: true } }).body
		).toContain('loading="eager"');
	});

	it('renders a block without an image as text rather than an empty frame', () => {
		const { body } = render(ResultCard, {
			props: { result: result({ imageUrl: null, blockType: 'Text' }), state: state() }
		});

		expect(body).not.toContain('<img');
		expect(body).toContain('Industrial felt');
	});

	it('labels an untitled block by its type without inventing archive metadata', () => {
		const { body } = render(ResultCard, {
			props: { result: result({ title: null, blockType: 'Image' }), state: state() }
		});

		expect(body).toContain('Untitled image');
	});

	it('turns each channel into a link that adds that channel filter', () => {
		const { body } = render(ResultCard, {
			props: { result: result(), state: state({ query: 'felt', mode: 'lexical' }) }
		});

		expect(body).toContain('href="/?q=felt&amp;mode=lexical&amp;channel=materials"');
	});
});
