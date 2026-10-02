<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import {
		ARCHIVE_SEARCH_PARAM,
		toArchiveSearchHref,
		type ArchiveSearchHref,
		type ArchiveSearchState
	} from '$lib/domain/search';

	let {
		search,
		onnavigate
	}: { search: ArchiveSearchState; onnavigate: (href: ArchiveSearchHref) => void } = $props();

	const QUERY_DEBOUNCE_MS = 150;

	let draft = $state<string | undefined>();
	let textarea = $state<HTMLTextAreaElement>();
	let overlapping = $state(false);
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	let requestedHref: ArchiveSearchHref | undefined;

	const value = $derived(draft ?? search.query);

	$effect(() => {
		void search;
		requestedHref = undefined;
		// A keystroke still waiting on the debounce is newer than the URL that just arrived.
		if (!debounceTimer) draft = undefined;
	});

	/** What a submit without JavaScript must carry. Sort is left out: it is invalid beside a query,
	 *  and this submit cannot know whether it will have one. */
	const hidden = $derived.by(() => {
		const fields: [string, string][] = [];
		if (search.mode === 'lexical' || search.mode === 'semantic') {
			fields.push([ARCHIVE_SEARCH_PARAM.mode, search.mode]);
		}
		for (const slug of search.channelSlugs) fields.push([ARCHIVE_SEARCH_PARAM.channel, slug]);
		for (const type of search.blockTypes) fields.push([ARCHIVE_SEARCH_PARAM.type, type]);
		for (const colour of search.colours) fields.push([ARCHIVE_SEARCH_PARAM.colour, colour]);
		if (search.from) fields.push([ARCHIVE_SEARCH_PARAM.from, search.from]);
		if (search.to) fields.push([ARCHIVE_SEARCH_PARAM.to, search.to]);
		if (search.createdFrom) fields.push([ARCHIVE_SEARCH_PARAM.createdFrom, search.createdFrom]);
		if (search.createdTo) fields.push([ARCHIVE_SEARCH_PARAM.createdTo, search.createdTo]);
		return fields;
	});

	function cancelPending() {
		clearTimeout(debounceTimer);
		debounceTimer = undefined;
	}

	function submitQuery(query: string) {
		cancelPending();
		const mode = search.mode === 'browse' ? 'hybrid' : search.mode;
		const href = toArchiveSearchHref({ ...search, query, mode });
		if (href === (requestedHref ?? toArchiveSearchHref(search))) return;
		requestedHref = href;
		onnavigate(href);
	}

	function handleInput(event: Event & { currentTarget: HTMLTextAreaElement }) {
		draft = event.currentTarget.value;
		cancelPending();
		const query = draft;
		debounceTimer = setTimeout(() => submitQuery(query), QUERY_DEBOUNCE_MS);
	}

	function handleKeydown(event: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) {
		if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
		event.preventDefault();
		event.currentTarget.form?.requestSubmit();
	}

	function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		submitQuery(value);
	}

	function clear() {
		draft = '';
		submitQuery('');
		textarea?.focus();
	}

	/**
	 * Shows a hairline on the field's edge while a caption from the top row slides underneath it,
	 * the way a page edge shows when another is tucked behind it.
	 */
	const watchOverlap: Attachment<HTMLFormElement> = (form) => {
		const scope = form.parentElement;
		if (!scope) return;
		let intersection: IntersectionObserver | undefined;
		let frame = 0;
		let visible: Element[] = [];

		const observe = () => {
			intersection?.disconnect();
			visible = [];
			overlapping = false;
			const rect = form.getBoundingClientRect();
			intersection = new IntersectionObserver(
				(entries) => {
					for (const entry of entries) {
						visible = visible.filter((caption) => caption !== entry.target);
						if (entry.isIntersecting) visible.push(entry.target);
					}
					overlapping = visible.length > 0;
				},
				{
					// A one-pixel strip along the field's right edge: only a caption straddling it counts.
					rootMargin: `${-rect.top}px ${rect.right - window.innerWidth}px ${rect.bottom - window.innerHeight}px ${1 - rect.right}px`
				}
			);
			for (const caption of scope.querySelectorAll('[data-top-annotation]')) {
				intersection.observe(caption);
			}
		};

		const schedule = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(observe);
		};

		const mutations = new MutationObserver(schedule);
		mutations.observe(scope, { childList: true, subtree: true });
		const resize = new ResizeObserver(schedule);
		resize.observe(form);
		window.addEventListener('resize', schedule);
		observe();
		return () => {
			cancelAnimationFrame(frame);
			intersection?.disconnect();
			mutations.disconnect();
			resize.disconnect();
			window.removeEventListener('resize', schedule);
		};
	};

	$effect(() => cancelPending);
</script>

<form
	class="group relative z-20 h-12 w-full shrink-0 bg-background px-(--page-gutter) after:pointer-events-none after:absolute after:top-(--annotation-padding) after:right-0 after:bottom-(--annotation-padding) after:w-px after:bg-foreground-secondary-detail after:opacity-0 after:transition-opacity after:duration-(--duration-fast) data-[overlapping=true]:after:opacity-100 sm:absolute sm:top-0 sm:left-0 sm:h-(--annotation-area-height) sm:w-[calc(100%/var(--column-count))] sm:max-w-full"
	method="GET"
	action="/"
	role="search"
	data-overlapping={overlapping}
	onsubmit={handleSubmit}
	{@attach watchOverlap}
>
	<label for="archive-query" class="sr-only">Search the archive</label>
	<textarea
		bind:this={textarea}
		id="archive-query"
		name={ARCHIVE_SEARCH_PARAM.query}
		rows="1"
		class="search-line block field-sizing-content max-h-lh min-h-lh w-[calc(100%-0.5rem)] resize-none overflow-hidden bg-transparent font-serif text-2xl text-foreground-strong outline-none sm:max-h-none"
		placeholder="Search..."
		autocomplete="off"
		spellcheck="false"
		{value}
		oninput={handleInput}
		onkeydown={handleKeydown}></textarea>
	{#each hidden as [name, fieldValue], index (index)}
		<input type="hidden" {name} value={fieldValue} />
	{/each}
	{#if value}
		<button
			type="button"
			aria-label="Clear search"
			class="search-line absolute right-0 grid h-lh place-items-center px-1 font-serif text-2xl text-foreground-elevated opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground-strong focus-visible:opacity-100 pointer-coarse:opacity-100"
			onclick={clear}
		>
			<svg
				width="32"
				height="32"
				viewBox="0 0 20 20"
				fill="none"
				stroke="currentColor"
				stroke-width="0.625"
				stroke-linecap="square"
				aria-hidden="true"
			>
				<path d="M6 14L14 6" />
				<path d="M6 6L14 14" />
			</svg>
		</button>
	{/if}
</form>

<style>
	/* Newsreader's metrics are overridden so its capitals sit centred in the line box; this lowers
	   the field until the cap height lands on the annotation padding, where top-row captions start,
	   and puts the clear button on the same line. */
	.search-line {
		margin-block-start: calc(var(--annotation-padding) - (1lh - 1cap) / 2);
	}

	button.search-line {
		top: 0;
	}
</style>
