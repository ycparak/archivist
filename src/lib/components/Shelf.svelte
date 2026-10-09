<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import type { ArchiveSearchHref, ChannelManifestEntry } from '$lib/domain/search';
	import CaptionText from './CaptionText.svelte';
	import ShelfBlock from './ShelfBlock.svelte';
	import ShelfCover from './ShelfCover.svelte';
	import { blockCount, captionText, connectedYears, formatConnectedDate } from './caption';
	import { reveal } from './reveal';
	import { SHELF, type ShelfLayout } from './shelf';

	let {
		layout,
		requestKey,
		query,
		busy = false,
		hasMore = false,
		loadingMore = false,
		loadFailed = false,
		coverHref,
		isActiveChannel,
		onloadmore,
		message
	}: {
		layout: ShelfLayout;
		requestKey: string;
		query: string;
		busy?: boolean;
		hasMore?: boolean;
		loadingMore?: boolean;
		loadFailed?: boolean;
		coverHref: (channel: ChannelManifestEntry) => ArchiveSearchHref;
		isActiveChannel: (channel: ChannelManifestEntry) => boolean;
		onloadmore: () => void;
		message?: Snippet;
	} = $props();

	const h = 'var(--shelf-h)';
	const watchEnd: Attachment<HTMLElement> = (node) => {
		void layout.rows;
		if (!hasMore || loadFailed) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) onloadmore();
			},
			{ root: node.closest('[data-shelf-scroller]'), rootMargin: '0px 1200px 0px 0px' }
		);
		observer.observe(node);
		return () => observer.disconnect();
	};
</script>

<section
	class="shelf grid h-full min-w-[calc(100cqi-var(--page-gutter))] flex-none grid-rows-[var(--annotation-area-height)_minmax(0,1fr)_var(--annotation-area-height)]"
	aria-labelledby="shelf-heading"
>
	<h2 id="shelf-heading" class="sr-only">Results</h2>
	<div class="relative row-start-2 bg-band" aria-busy={busy}>
		{#if message}
			<div
				class="absolute max-w-64"
				style:left="calc(var(--shelf-padding) + var(--row-inset))"
				style:top="var(--shelf-padding)"
			>
				{@render message()}
			</div>
		{/if}

		<div
			class={[
				'flex w-max flex-col items-start transition-opacity duration-(--duration-fast)',
				busy && 'opacity-50'
			]}
			style:padding="calc({SHELF.padding} * {h})"
			style:gap="calc({SHELF.rowGap} * {h})"
		>
			{#each layout.rows as row, rowIndex (rowIndex)}
				<ul
					class="m-0 flex list-none p-0"
					style:height="calc({SHELF.rowHeight} * {h})"
					style:margin-left="var(--row-inset)"
					style:gap="calc({SHELF.groupGap} * {h})"
				>
					{#each row as group, groupIndex (`${requestKey}:${group.id}`)}
						<li
							class="shelf-group flex h-full flex-none"
							data-reveal
							style:--row={rowIndex}
							style:gap="calc({SHELF.itemGap} * {h})"
							{@attach reveal}
						>
							{#each group.items as item, itemIndex (item.id)}
								<div
									class="relative h-full flex-none"
									style:width={item.ratio !== null
										? `calc(${SHELF.pageHeight * item.ratio} * ${h})`
										: undefined}
								>
									<div
										class={[
											'shelf-caption absolute left-0 h-[calc(var(--annotation-area-height)-2*var(--annotation-padding))] w-full text-foreground',
											rowIndex === 0
												? 'bottom-[calc(100%+var(--shelf-padding)+var(--annotation-padding))]'
												: 'top-[calc(100%+var(--shelf-padding)+var(--annotation-padding))]'
										]}
										data-top-annotation={rowIndex === 0 ? '' : undefined}
									>
										{#if item.kind === 'cover' && group.channel}
											<div
												class={[
													'flex h-full flex-col border-l border-foreground-secondary-detail pl-2',
													rowIndex === 1 && 'justify-end'
												]}
											>
												<p class="clamp-7">
													<span class="text-foreground-strong">{group.channel.title}</span><br
													/>{blockCount(group.blocks.length)}<br />{connectedYears(group.blocks)}
												</p>
											</div>
										{:else if item.kind === 'block'}
											<div
												class={[
													'flex h-full max-w-56 flex-col',
													rowIndex === 1 && 'flex-col-reverse'
												]}
											>
												<div class="flex flex-col gap-(--gap-paragraph)">
													<p class="text-foreground-strong">
														{formatConnectedDate(item.result.connectedAt)}
													</p>
													<CaptionText text={captionText(item.result, query)} {query} />
												</div>
											</div>
										{/if}
									</div>

									<div
										class={[item.ratio !== null && '@container-size w-full']}
										style:height="calc({SHELF.pageHeight} * {h})"
									>
										{#if item.kind === 'cover' && group.channel}
											<ShelfCover
												channel={group.channel}
												count={group.blocks.length}
												href={coverHref(group.channel)}
												active={isActiveChannel(group.channel)}
											/>
										{:else if item.kind === 'block'}
											<ShelfBlock result={item.result} eager={groupIndex < 1 && itemIndex < 6} />
										{/if}
									</div>
								</div>
							{/each}
						</li>
					{/each}
				</ul>
			{/each}
		</div>

		{#if hasMore}
			<div class="absolute top-0 right-0 h-full w-px" {@attach watchEnd}></div>
			<div class="absolute right-(--shelf-padding) bottom-(--shelf-padding) text-foreground">
				{#if loadFailed}
					<button type="button" class="control-button" onclick={onloadmore}
						>Couldn’t load more. Try again</button
					>
				{:else if loadingMore}
					<p>Loading more…</p>
				{/if}
			</div>
		{/if}
	</div>
</section>

<style>
	.shelf {
		--shelf-h: calc(100cqh - 2 * var(--annotation-area-height));
		--shelf-padding: calc(var(--shelf-h) * 0.05);
		--row-inset: calc((100cqi / var(--column-count) - 4rem) / 2);
	}

	.shelf-group {
		transition:
			opacity var(--duration-reveal) var(--ease-out-expo),
			translate var(--duration-reveal) var(--ease-out-expo);
		transition-delay: calc(var(--row) * var(--delay-row));
	}

	.shelf-caption {
		transition: opacity var(--duration-caption) linear;
		transition-delay: calc(var(--delay-caption) + var(--row) * var(--delay-row));
	}

	:global([data-js]) .shelf-group:not([data-revealed]) {
		opacity: 0;
		translate: var(--shelf-padding) 0;
	}

	:global([data-js]) .shelf-group:not([data-revealed]) .shelf-caption {
		opacity: 0;
	}
</style>
