<script lang="ts">
	import type { SearchResult } from '$lib/domain/search';
	import { blockDisplayTitle } from './format';

	let { result, eager = false }: { result: SearchResult; eager?: boolean } = $props();

	const title = $derived(blockDisplayTitle(result.title, result.blockType));
	const hasIntrinsicSize = $derived(Boolean(result.imageWidth && result.imageHeight));
</script>

<article class="min-w-0">
	<a
		class="flex flex-col gap-2.5 text-text-tertiary no-underline hover:text-text"
		href={result.arenaUrl}
		target="_blank"
		rel="external noopener noreferrer"
		{title}
	>
		<span
			class={[
				'block overflow-hidden bg-background-sunken',
				hasIntrinsicSize ? 'aspect-(--ratio)' : 'aspect-4/3'
			]}
		>
			{#if result.imageUrl}
				<img
					class="block size-full object-cover"
					src={result.imageUrl}
					alt={result.imageAlt ?? ''}
					width={result.imageWidth ?? undefined}
					height={result.imageHeight ?? undefined}
					loading={eager ? 'eager' : 'lazy'}
					decoding="async"
					referrerpolicy="no-referrer"
				/>
			{:else if result.description}
				<span class="line-clamp-10 overflow-hidden p-3 wrap-anywhere text-text-secondary"
					>{result.description}</span
				>
			{/if}
		</span>
		<span class={['truncate', !result.title && '[font-style:oblique_12deg]']}>{title}</span>
	</a>
</article>
