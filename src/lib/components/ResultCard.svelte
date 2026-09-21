<script lang="ts">
	import type { SearchResult } from '$lib/domain/search';
	import { blockDisplayTitle } from './format';

	let { result, eager = false }: { result: SearchResult; eager?: boolean } = $props();

	const title = $derived(blockDisplayTitle(result.title, result.blockType));
	const hasIntrinsicSize = $derived(Boolean(result.imageWidth && result.imageHeight));
</script>

<article class="card">
	<a class="card-link" href={result.arenaUrl} rel="external" {title}>
		<span class="card-media" class:card-media--fixed={!hasIntrinsicSize}>
			{#if result.imageUrl}
				<img
					src={result.imageUrl}
					alt={result.imageAlt ?? ''}
					width={result.imageWidth ?? undefined}
					height={result.imageHeight ?? undefined}
					loading={eager ? 'eager' : 'lazy'}
					decoding="async"
					referrerpolicy="no-referrer"
				/>
			{:else if result.description}
				<span class="card-excerpt">{result.description}</span>
			{/if}
		</span>
		<span class="card-title" class:untitled={!result.title}>{title}</span>
	</a>
</article>

<style>
	.card {
		min-inline-size: 0;
	}

	.card-link {
		display: flex;
		flex-direction: column;
		gap: calc(var(--spacing) * 2.5);
		color: var(--color-text-tertiary);
		text-decoration: none;
	}

	.card-link:hover {
		color: var(--color-text);
	}

	.card-media {
		display: block;
		aspect-ratio: var(--ratio);
		overflow: hidden;
		background: var(--color-background-sunken);
	}

	.card-media img {
		display: block;
		inline-size: 100%;
		block-size: 100%;
		object-fit: cover;
	}

	/* Are.na didn't supply intrinsic dimensions: hold a placeholder box instead of letting the
	   image size the card unpredictably. */
	.card-media--fixed {
		aspect-ratio: 4 / 3;
	}

	.card-excerpt {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 10;
		line-clamp: 10;
		padding: calc(var(--spacing) * 3);
		overflow: hidden;
		color: var(--color-text-secondary);
		overflow-wrap: anywhere;
	}

	.card-title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.untitled {
		font-style: oblique 12deg;
	}
</style>
