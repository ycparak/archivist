<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		hasActiveFilters,
		toArchiveSearchHref,
		withoutBlockType,
		withoutChannel,
		withoutDateRange,
		withoutFilters,
		type ArchiveSearchState
	} from '$lib/domain/search';
	import { formatArchiveDate } from './format';

	let { state }: { state: ArchiveSearchState } = $props();

	const dateLabel = $derived.by(() => {
		const from = formatArchiveDate(state.from ? `${state.from}T00:00:00.000Z` : null);
		const to = formatArchiveDate(state.to ? `${state.to}T00:00:00.000Z` : null);
		if (from && to) return `${from} – ${to}`;
		if (from) return `From ${from}`;
		if (to) return `Until ${to}`;
		return null;
	});
</script>

{#if hasActiveFilters(state)}
	<div class="active-filters">
		<h2 class="visually-hidden">Active filters</h2>
		<ul>
			{#each state.channelSlugs as slug (slug)}
				<li>
					<a href={resolve(toArchiveSearchHref(withoutChannel(state, slug)))}>
						Channel: {slug}<span class="remove" aria-hidden="true">×</span>
						<span class="visually-hidden">(remove filter)</span>
					</a>
				</li>
			{/each}
			{#each state.blockTypes as blockType (blockType)}
				<li>
					<a href={resolve(toArchiveSearchHref(withoutBlockType(state, blockType)))}>
						Type: {blockType}<span class="remove" aria-hidden="true">×</span>
						<span class="visually-hidden">(remove filter)</span>
					</a>
				</li>
			{/each}
			{#if dateLabel}
				<li>
					<a href={resolve(toArchiveSearchHref(withoutDateRange(state)))}>
						{dateLabel}<span class="remove" aria-hidden="true">×</span>
						<span class="visually-hidden">(remove filter)</span>
					</a>
				</li>
			{/if}
		</ul>
		<a class="clear" href={resolve(toArchiveSearchHref(withoutFilters(state)))}>Clear all filters</a
		>
	</div>
{/if}

<style>
	.active-filters {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4) var(--space-8);
		align-items: center;
	}

	ul {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li a {
		display: inline-flex;
		gap: var(--space-3);
		align-items: center;
		padding: var(--space-2) var(--space-5);
		color: var(--color-text-secondary);
		background: var(--color-control);
		border-radius: var(--radius-pill);
		font-size: var(--text-size-meta);
		line-height: var(--leading-interface);
		text-decoration: none;
	}

	li a:hover {
		color: var(--color-text);
		background: var(--color-control-hover);
	}

	.remove {
		color: var(--color-text-tertiary);
	}

	.clear {
		color: var(--color-text-tertiary);
		font-size: var(--text-size-meta);
	}
</style>
