<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { navigating, page } from '$app/state';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import ArchiveMessage from '$lib/components/ArchiveMessage.svelte';
	import ResultCard from '$lib/components/ResultCard.svelte';
	import SearchForm from '$lib/components/SearchForm.svelte';
	import { formatSearchTimings, mediaRatio, resultsStatus } from '$lib/components/format';
	import {
		ARCHIVE_PAGE_PARAM,
		hasActiveFilters,
		readArchiveSearchState,
		type ArchiveSearchHref,
		type SearchResult
	} from '$lib/domain/search';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const searchState = $derived(data.state);
	type Loaded = { source: PageData; results: SearchResult[]; offset: number; hasMore: boolean };

	let loaded = $state.raw<Loaded>();
	let loadingMore = $state(false);
	let loadFailed = $state(false);

	const loadedHere = $derived(loaded?.source === data ? loaded : undefined);
	const firstPage = $derived(data.kind === 'ok' ? data.results : []);
	const results = $derived([...firstPage, ...(loadedHere?.results ?? [])]);
	const hasMore = $derived(loadedHere ? loadedHere.hasMore : data.kind === 'ok' && data.hasMore);
	const channels = $derived(data.channels);
	const searching = $derived(navigating.to?.route.id === '/');

	const announced = $derived(
		searching && navigating.to
			? readArchiveSearchState(navigating.to.url.searchParams)
			: searchState
	);
	const status = $derived(
		resultsStatus({
			kind: data.kind,
			state: announced,
			resultCount: results.length,
			searching
		})
	);

	const timings = $derived(
		data.kind === 'ok' && !searching ? formatSearchTimings(data.timings) : ''
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
			const seen = new Set(results.map((result) => result.id));
			loaded = {
				source,
				offset: offset + body.results.length,
				hasMore: body.hasMore && body.results.length > 0,
				results: [
					...(loadedHere?.results ?? []),
					...body.results.filter((result) => !seen.has(result.id))
				]
			};
		} catch {
			if (source === data) loadFailed = true;
		} finally {
			loadingMore = false;
		}
	}

	function watchEnd(node: HTMLElement) {
		void results.length;
		void loadFailed;
		if (!hasMore || loadFailed) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) void loadMore();
			},
			{ rootMargin: '800px 0px' }
		);
		observer.observe(node);
		return () => observer.disconnect();
	}

	function navigate(href: ArchiveSearchHref) {
		void goto(resolve(href), { keepFocus: true, noScroll: true });
	}
</script>

<svelte:head>
	<title>{searchState.query ? `${searchState.query} — Archivist` : 'Archivist'}</title>
	<meta name="description" content="Search and browse an Are.na archive of original blocks." />
</svelte:head>

<main class="mb-16 flex flex-col gap-12 [--row-height:10rem] md:[--row-height:16rem]">
	<header class="rule">
		<h1>Search</h1>
	</header>

	<SearchForm state={searchState} {channels} {status} {timings} onnavigate={navigate} />

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
				Check the ranking mode and the connected-date range, then search again. Exact-words and
				related-ideas ranking both need a search term.
			</p>
		</ArchiveMessage>
	{:else if !results.length}
		<ArchiveMessage heading="No blocks match">
			<p>
				Nothing in the synced archive matches {searchState.query
					? `“${searchState.query}”`
					: 'these filters'}.
				{#if hasActiveFilters(searchState)}
					Clearing a filter above widens the search.
				{:else}
					Try a broader phrase, or switch ranking to related ideas.
				{/if}
			</p>
		</ArchiveMessage>
	{:else}
		<h2 class="visually-hidden">Results</h2>
		<ul
			class={[
				'ease-standard) m-0 flex list-none flex-wrap gap-x-5 gap-y-6 p-0 transition-opacity duration-(--duration-standard) after:grow-1000000 motion-reduce:transition-none',
				searching && 'opacity-50'
			]}
			aria-busy={searching}
		>
			{#each results as result, index (result.id)}
				<li
					class="min-w-0 flex-[calc(var(--ratio)*100)_1_calc(var(--ratio)*var(--row-height))]"
					style:--ratio={mediaRatio(result)}
				>
					<ResultCard {result} eager={index < 4} />
				</li>
			{/each}
		</ul>
		{#if hasMore}
			<div class="min-h-(--control-sm)" {@attach watchEnd}>
				{#if loadFailed}
					<button
						type="button"
						class="bg-transparent text-text-secondary underline"
						onclick={loadMore}>Couldn’t load more. Try again</button
					>
				{:else if loadingMore}
					<p class="m-0 meta">Loading more…</p>
				{/if}
			</div>
		{/if}
	{/if}
</main>
