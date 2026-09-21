<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { navigating } from '$app/state';
	import ActiveFilters from '$lib/components/ActiveFilters.svelte';
	import ArchiveMessage from '$lib/components/ArchiveMessage.svelte';
	import ResultCard from '$lib/components/ResultCard.svelte';
	import SearchForm from '$lib/components/SearchForm.svelte';
	import { mediaRatio, resultsStatus } from '$lib/components/format';
	import {
		hasActiveFilters,
		readArchiveSearchState,
		type ArchiveSearchHref
	} from '$lib/domain/search';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const state = $derived(data.state);
	const results = $derived(data.kind === 'ok' ? data.results : []);
	const channels = $derived(data.channels);
	const searching = $derived(navigating.to?.route.id === '/');

	const announced = $derived(
		searching && navigating.to ? readArchiveSearchState(navigating.to.url.searchParams) : state
	);
	const status = $derived(
		resultsStatus({
			kind: data.kind,
			state: announced,
			resultCount: results.length,
			searching
		})
	);

	function navigate(href: ArchiveSearchHref) {
		void goto(resolve(href), { keepFocus: true, noScroll: true });
	}
</script>

<svelte:head>
	<title>{state.query ? `${state.query} — Archivist` : 'Archivist'}</title>
	<meta name="description" content="Search and browse an Are.na archive of original blocks." />
</svelte:head>

<main>
	<header class="rule">
		<h1>Search</h1>
	</header>

	<div class="stack" data-gap="sm">
		<SearchForm {state} {channels} {status} onnavigate={navigate} />
		<ActiveFilters {state} />
	</div>

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
				Nothing in the synced archive matches {state.query ? `“${state.query}”` : 'these filters'}.
				{#if hasActiveFilters(state)}
					Removing a filter above widens the search.
				{:else}
					Try a broader phrase, or switch ranking to related ideas.
				{/if}
			</p>
		</ArchiveMessage>
	{:else}
		<h2 class="visually-hidden">Results</h2>
		<ul class="results" aria-busy={searching} class:searching>
			{#each results as result, index (result.id)}
				<li style:--ratio={mediaRatio(result)}><ResultCard {result} eager={index < 4} /></li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	main {
		--row-height: 16rem;
		display: flex;
		flex-direction: column;
		gap: calc(var(--spacing) * 12);
		margin-block-end: calc(var(--spacing) * 16);
	}

	/* Justified rows: each item grows in proportion to its aspect ratio, so every image in a row
	   shares one height and the row fills the pane. The trailing pseudo-element soaks up the last
	   row's slack so a short final row keeps the target height instead of stretching. */
	.results {
		display: flex;
		flex-wrap: wrap;
		gap: calc(var(--spacing) * 6) calc(var(--spacing) * 5);
		margin: 0;
		padding: 0;
		list-style: none;
		transition: opacity var(--duration-standard) var(--ease-standard);
	}

	.results > li {
		flex: calc(var(--ratio) * 100) 1 calc(var(--ratio) * var(--row-height));
		min-inline-size: 0;
	}

	.results::after {
		content: '';
		flex-grow: 1000000;
	}

	.results.searching {
		opacity: 0.5;
	}

	@media (max-width: 44.999rem) {
		main {
			--row-height: 10rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.results {
			transition: none;
		}
	}
</style>
