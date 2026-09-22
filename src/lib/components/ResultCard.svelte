<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import type { SearchResult } from '$lib/domain/search';
	import { blockDisplayTitle } from './format';

	let { result, eager = false }: { result: SearchResult; eager?: boolean } = $props();

	const title = $derived(blockDisplayTitle(result.title, result.blockType));
	const hasIntrinsicSize = $derived(Boolean(result.imageWidth && result.imageHeight));

	/**
	 * Playback is driven from the observer rather than the `autoplay` attribute. With `autoplay`
	 * every card below the fold starts decoding the moment it mounts and is only paused afterwards,
	 * and the reduced-motion check has to win a race it does not reliably win.
	 */
	const playInView: Attachment<HTMLVideoElement> = (element) => {
		// Autoplay is a courtesy, not the content. A reader who asked for less motion keeps the
		// poster frame; the block still plays on Are.na, one click away.
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		// Belt and braces against the attribute not surviving hydration: an unmuted video is not
		// allowed to autoplay at all.
		element.muted = true;

		const observer = new IntersectionObserver(
			([entry]) => {
				// A rejected play() is the browser declining — low power mode, a background tab —
				// and there is nothing useful to do about it.
				if (entry.isIntersecting) void element.play().catch(() => {});
				else element.pause();
			},
			{ rootMargin: '100px' }
		);

		observer.observe(element);
		return () => observer.disconnect();
	};
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
			{#if result.videoUrl}
				<!-- The thumbnail is the poster, so the card looks identical before the first frame
				     paints and stays correct if the file never loads at all. No controls: the whole
				     card is a link to Are.na, and a control strip inside it would fight every click. -->
				<video
					class="block size-full object-cover"
					poster={result.imageUrl ?? undefined}
					width={result.imageWidth ?? undefined}
					height={result.imageHeight ?? undefined}
					preload="metadata"
					aria-label={result.imageAlt || title}
					muted
					loop
					playsinline
					{@attach playInView}
				>
					<source src={result.videoUrl} type={result.videoContentType ?? undefined} />
				</video>
			{:else if result.imageUrl}
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
