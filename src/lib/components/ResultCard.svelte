<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ArchiveSearchState, SearchResult } from '$lib/domain/search';
	import { toArchiveSearchHref, withChannel } from '$lib/domain/search';
	import { blockDisplayTitle, formatArchiveDate } from './format';

	let {
		result,
		state,
		eager = false
	}: { result: SearchResult; state: ArchiveSearchState; eager?: boolean } = $props();

	const title = $derived(blockDisplayTitle(result.title, result.blockType));
	const connectedOn = $derived(formatArchiveDate(result.connectedAt));
</script>

<article class="card">
	<a class="card-link" href={result.arenaUrl} rel="external">
		{#if result.imageUrl}
			<span class="card-media">
				<img
					src={result.imageUrl}
					alt=""
					loading={eager ? 'eager' : 'lazy'}
					decoding="async"
					referrerpolicy="no-referrer"
				/>
			</span>
		{/if}
		<h3 class="card-title" class:untitled={!result.title}>{title}</h3>
	</a>

	{#if result.description}
		<p class="card-description">{result.description}</p>
	{/if}

	<p class="meta card-meta">
		<span>{result.blockType}</span>
		{#if result.sourceTitle}
			<span aria-hidden="true">·</span>
			<span>{result.sourceTitle}</span>
		{/if}
		{#if connectedOn}
			<span aria-hidden="true">·</span>
			<time datetime={result.connectedAt}>{connectedOn}</time>
		{/if}
	</p>

	{#if result.channelSlugs.length}
		<ul class="card-channels">
			{#each result.channelSlugs as slug (slug)}
				<li>
					<a class="channel-link" href={resolve(toArchiveSearchHref(withChannel(state, slug)))}>
						{slug}
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</article>

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-inline-size: 0;
	}

	.card-link {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		text-decoration: none;
	}

	.card-media {
		display: block;
		overflow: hidden;
		aspect-ratio: 4 / 3;
		background: var(--color-background-subtle);
		border-radius: var(--radius-md);
	}

	.card-media img {
		inline-size: 100%;
		block-size: 100%;
		object-fit: cover;
	}

	.card-title {
		margin: 0;
		overflow-wrap: anywhere;
		font-size: var(--text-size-md);
		line-height: var(--leading-interface);
		text-decoration: underline;
		text-decoration-color: var(--color-border-emphasis);
	}

	.card-link:hover .card-title {
		text-decoration-color: currentcolor;
	}

	.untitled {
		color: var(--color-text-tertiary);
	}

	.card-description {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		margin: 0;
		overflow: hidden;
		color: var(--color-text-secondary);
		font-size: var(--text-size-sm);
	}

	.card-meta {
		display: flex;
		overflow-wrap: anywhere;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0;
	}

	.card-channels {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.channel-link {
		overflow-wrap: anywhere;
		color: var(--color-text-tertiary);
		font-family: var(--font-mono);
		font-size: var(--text-size-meta);
		text-decoration: none;
	}

	.channel-link::before {
		content: '#';
		color: var(--color-border-emphasis);
	}
</style>
