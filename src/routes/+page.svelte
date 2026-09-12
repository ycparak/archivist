<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { navigating } from '$app/state';
	import ActiveFilters from '$lib/components/ActiveFilters.svelte';
	import ArchiveMessage from '$lib/components/ArchiveMessage.svelte';
	import ResultCard from '$lib/components/ResultCard.svelte';
	import SearchForm from '$lib/components/SearchForm.svelte';
	import { resultsStatus } from '$lib/components/format';
	import {
		hasActiveFilters,
		readArchiveSearchState,
		type ArchiveSearchHref
	} from '$lib/domain/search';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const state = $derived(data.state);
	const results = $derived(data.kind === 'ok' ? data.results : []);
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

<main class="container">
	<header class="masthead">
		<h1>Archivist</h1>
		<p class="reading-width lead">
			Search one maintainer’s Are.na archive by exact words or by idea. Every result is an original
			block and links back to Are.na.
		</p>
	</header>

	<SearchForm {state} onnavigate={navigate} />

	<ActiveFilters {state} />

	<p class="meta results-status" role="status" aria-live="polite">{status}</p>

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
				<li><ResultCard {result} {state} eager={index < 4} /></li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	.container {
		display: flex;
		flex-direction: column;
		gap: var(--space-12);
		padding-block: var(--space-24) var(--space-32);
	}

	.masthead {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}

	h1 {
		margin: 0;
		font-size: var(--text-size-2xl);
	}

	.lead {
		margin: 0;
		color: var(--color-text-secondary);
		font-size: var(--text-size-lg);
	}

	.results-status {
		margin: 0;
	}

	.results > :global(li) {
		min-inline-size: 0;
	}

	.results {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(16rem, 100%), 1fr));
		gap: var(--space-16) var(--space-12);
		margin: 0;
		padding: 0;
		list-style: none;
		transition: opacity var(--duration-standard) var(--ease-standard);
	}

	.results.searching {
		opacity: 0.5;
	}

	code {
		color: var(--color-text);
	}

	@media (prefers-reduced-motion: reduce) {
		.results {
			transition: none;
		}
	}
</style>
