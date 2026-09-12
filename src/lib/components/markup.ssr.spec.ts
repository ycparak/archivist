import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import ActiveFilters from './ActiveFilters.svelte';
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

		const hidden = [...body.matchAll(/<input\b[^>]*type="hidden"[^>]*>/g)].map((match) => match[0]);
		expect(hidden).toHaveLength(2);
		for (const slug of ['materials', 'type']) {
			expect(hidden.some((field) => field.includes(`value="${slug}"`))).toBe(true);
		}
		expect(hidden.every((field) => field.includes('name="channel"'))).toBe(true);
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

		const checkboxes = [...body.matchAll(/<input\b[^>]*type="checkbox"[^>]*>/g)].map(
			(match) => match[0]
		);
		const checked = checkboxes.filter((field) => /\bchecked\b/.test(field));
		expect(checked).toHaveLength(1);
		expect(checked[0]).toContain('value="Image"');
	});

	it('shows the ranking the URL asked for', () => {
		const { body } = render(SearchForm, {
			props: { state: state({ query: 'felt', mode: 'semantic' }), onnavigate: () => {} }
		});

		expect(body).toMatch(/<option[^>]*value="semantic"[^>]*selected/);
		expect(body).not.toMatch(/<option[^>]*value="lexical"[^>]*selected/);
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

		const channelHref = hrefsIn(body).find((url) => url.searchParams.has('channel'));
		expect(channelHref?.searchParams.getAll('channel')).toEqual(['materials']);
		expect(channelHref?.searchParams.get('q')).toBe('felt');
		expect(channelHref?.searchParams.get('mode')).toBe('lexical');
	});

	it('sends the block link to Are.na without letting the router claim it', () => {
		const { body } = render(ResultCard, { props: { result: result(), state: state() } });

		expect(body).toMatch(/<a[^>]*href="https:\/\/www\.are\.na\/block\/1"[^>]*rel="external"/);
	});
});

describe('ActiveFilters markup', () => {
	it('renders nothing when no filter is active', () => {
		const { body } = render(ActiveFilters, { props: { state: state({ query: 'felt' }) } });

		expect(body).not.toContain('<a');
		expect(body.replace(/<!--.*?-->/g, '').trim()).toBe('');
	});

	it('offers each active filter as a link that removes only that filter', () => {
		const { body } = render(ActiveFilters, {
			props: {
				state: state({
					query: 'felt',
					channelSlugs: ['materials'],
					blockTypes: ['Image'],
					from: '2024-01-02'
				})
			}
		});

		const removals = hrefsIn(body);
		expect(removals).toHaveLength(4);
		for (const url of removals) {
			expect(url.searchParams.get('q')).toBe('felt');
		}
		expect(removals.some((url) => !url.searchParams.has('channel'))).toBe(true);
		expect(removals.some((url) => !url.searchParams.has('type'))).toBe(true);
		expect(removals.some((url) => !url.searchParams.has('from'))).toBe(true);
	});

	it('labels a date filter as a readable range and keeps the remove affordance in text', () => {
		const { body } = render(ActiveFilters, {
			props: { state: state({ from: '2024-01-02', to: '2024-01-31' }) }
		});

		expect(body).toContain('2 Jan 2024');
		expect(body).toContain('31 Jan 2024');
		expect(body).toContain('(remove filter)');
	});
});
