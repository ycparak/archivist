<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { navigating, page } from '$app/state';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import ArchiveIndex from '$lib/components/ArchiveIndex.svelte';
	import ArchiveMessage from '$lib/components/ArchiveMessage.svelte';
	import SearchField from '$lib/components/SearchField.svelte';
	import Shelf from '$lib/components/Shelf.svelte';
	import { hrefWith, toggled } from '$lib/components/filters';
	import { channelLabel, channelSymbol, resultsStatus } from '$lib/components/format';
	import { layoutShelves } from '$lib/components/shelf';
	import {
		ARCHIVE_PAGE_PARAM,
		hasActiveFilters,
		readArchiveSearchState,
		toArchiveSearchHref,
		type ArchiveSearchHref,
		type ChannelManifestEntry,
		type SearchResult
	} from '$lib/domain/search';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const searchState = $derived(data.state);
	type Loaded = { source: PageData; pages: SearchResult[][]; offset: number; hasMore: boolean };

	let loaded = $state.raw<Loaded>();
	let loadingMore = $state(false);
	let loadFailed = $state(false);
	let scroller = $state<HTMLElement>();
	let shelf = $state<HTMLElement>();

	const loadedHere = $derived(loaded?.source === data ? loaded : undefined);
	const firstPage = $derived(data.kind === 'ok' ? data.results : []);
	const pages = $derived([firstPage, ...(loadedHere?.pages ?? [])]);
	const resultCount = $derived(pages.reduce((count, results) => count + results.length, 0));
	const hasMore = $derived(loadedHere ? loadedHere.hasMore : data.kind === 'ok' && data.hasMore);
	const channels = $derived(
		data.channels.map(({ slug, title }) => ({
			slug,
			title: channelLabel(title),
			symbol: channelSymbol(title)
		}))
	);
	const channelsBySlug = $derived(new Map(channels.map((channel) => [channel.slug, channel])));
	const layout = $derived(layoutShelves(pages, channelsBySlug, searchState.channelSlugs));
	const requestKey = $derived(toArchiveSearchHref(searchState));
	const searching = $derived(navigating.to?.route.id === '/');

	const announced = $derived(
		searching && navigating.to
			? readArchiveSearchState(navigating.to.url.searchParams)
			: searchState
	);
	const status = $derived(
		resultsStatus({ kind: data.kind, state: announced, resultCount, searching })
	);

	async function loadMore() {
		if (loadingMore || searching || !hasMore) return;
		const source = data;
		const offset = loadedHere?.offset ?? firstPage.length;
		const params = new SvelteURLSearchParams(page.url.searchParams);
		params.set(ARCHIVE_PAGE_PARAM.offset, String(offset));
		loadingMore = true;
		loadFailed = false;
		try {
			const response = await fetch(`/api/search?${params}`);
			if (!response.ok) throw new Error(`Search returned ${response.status}`);
			const body: { results: SearchResult[]; hasMore: boolean } = await response.json();
			if (source !== data) return;
			const seen = new Set(pages.flat().map((result) => result.id));
			const fresh = body.results.filter((result) => !seen.has(result.id));
			loaded = {
				source,
				offset: offset + body.results.length,
				hasMore: body.hasMore && body.results.length > 0,
				pages: fresh.length ? [...(loadedHere?.pages ?? []), fresh] : (loadedHere?.pages ?? [])
			};
		} catch {
			if (source === data) loadFailed = true;
		} finally {
			loadingMore = false;
		}
	}

	function navigate(href: ArchiveSearchHref) {
		void goto(resolve(href), { keepFocus: true, noScroll: true });
	}

	function coverHref(channel: ChannelManifestEntry): ArchiveSearchHref {
		return hrefWith(searchState, {
			channelSlugs: toggled(searchState.channelSlugs, channel.slug)
		});
	}

	function remToPx(rem: number): number {
		return rem * Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
	}

	let scrolledFor: string | undefined;
	let parkedAt: number | undefined;

	function shelfStart(): number {
		return shelf ? shelf.offsetLeft - remToPx(2) : 0;
	}

	/** A new query slides the shelf in from the right; clearing it slides back to the filters. */
	$effect(() => {
		const query = searchState.query;
		if (!scroller || !shelf) return;
		const first = scrolledFor === undefined;
		if (!first && query === scrolledFor) return;
		scrolledFor = query;
		if (first && !query) return;
		const instant = first || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		parkedAt = query ? shelfStart() : undefined;
		scroller.scrollTo({ left: parkedAt ?? 0, behavior: instant ? 'instant' : 'smooth' });
	});

	/**
	 * The filters settle their channel columns only after fonts load, which moves the shelf. A
	 * reader still parked at the start of the shelf stays there; one who has scrolled is left alone.
	 */
	const keepParked: Attachment<HTMLElement> = (index) => {
		const observer = new ResizeObserver(() => {
			if (!scroller || parkedAt === undefined) return;
			if (Math.abs(scroller.scrollLeft - parkedAt) > 2) {
				parkedAt = undefined;
				return;
			}
			parkedAt = shelfStart();
			scroller.scrollTo({ left: parkedAt, behavior: 'instant' });
		});
		observer.observe(index);
		return () => observer.disconnect();
	};

	/** A mouse wheel only scrolls vertically, and this page only scrolls sideways. */
	const wheelSideways: Attachment<HTMLElement> = (element) => {
		const onWheel = (event: WheelEvent) => {
			if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
			if (element.scrollWidth <= element.clientWidth) return;
			event.preventDefault();
			element.scrollLeft += event.deltaY;
		};
		element.addEventListener('wheel', onWheel, { passive: false });
		return () => element.removeEventListener('wheel', onWheel);
	};
</script>

<svelte:head>
	<title>{searchState.query ? `${searchState.query} — Archivist` : 'Archivist'}</title>
	<meta name="description" content="Search and browse an Are.na archive of original blocks." />
</svelte:head>

<div class="fixed inset-0 flex flex-col sm:block">
	<SearchField search={searchState} onnavigate={navigate} />

	<main
		class="@container-size relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden sm:h-full"
		data-shelf-scroller
		bind:this={scroller}
		{@attach wheelSideways}
	>
		<h1 class="sr-only">Archivist</h1>
		<div class="flex h-full w-max">
			<div class="h-full" {@attach keepParked}>
				<ArchiveIndex
					search={searchState}
					{channels}
					blockCount={data.blockCount}
					onnavigate={navigate}
				/>
			</div>
			<div class="ml-(--column-gap) h-full" bind:this={shelf}>
				<Shelf
					{layout}
					{requestKey}
					query={searchState.query}
					busy={searching}
					{hasMore}
					{loadingMore}
					{loadFailed}
					{coverHref}
					isActiveChannel={(channel) => searchState.channelSlugs.includes(channel.slug)}
					onloadmore={loadMore}
					message={data.kind !== 'ok' || !resultCount ? message : undefined}
				/>
			</div>
		</div>
	</main>

	<p class="sr-only" role="status" aria-live="polite">{status}</p>
</div>

{#snippet message()}
	{#if data.kind === 'unavailable'}
		<ArchiveMessage heading="Search is unavailable">
			<p>
				The archive index could not be reached. Try again shortly — if you are the maintainer, this
				reference identifies the failure in the logs:
				<code>{data.correlationId}</code>
			</p>
		</ArchiveMessage>
	{:else if data.kind === 'invalid'}
		<ArchiveMessage heading="That search could not be read">
			<p>
				Check the ranking and the connected dates, then search again. Exact words and related ideas
				both need a search term.
			</p>
		</ArchiveMessage>
	{:else}
		<ArchiveMessage heading="No blocks match">
			<p>
				Nothing in the synced archive matches {searchState.query
					? `“${searchState.query}”`
					: 'these filters'}.
				{#if hasActiveFilters(searchState)}
					Clearing a filter widens the search.
				{:else}
					Try a broader phrase, or switch the search type to related ideas.
				{/if}
			</p>
		</ArchiveMessage>
	{/if}
{/snippet}
