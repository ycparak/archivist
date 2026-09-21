<script lang="ts">
	import FilterMenu from './FilterMenu.svelte';
	import {
		ARCHIVE_BLOCK_TYPES,
		ARCHIVE_SEARCH_PARAM,
		readArchiveSearchStateFromEntries,
		toArchiveSearchHref,
		type ArchiveSearchHref,
		type ArchiveSearchState,
		type ChannelManifestEntry
	} from '$lib/domain/search';

	let {
		state,
		channels,
		status = '',
		timings = '',
		onnavigate
	}: {
		state: ArchiveSearchState;
		channels: ChannelManifestEntry[];
		status?: string;
		timings?: string;
		onnavigate: (href: ArchiveSearchHref) => void;
	} = $props();

	const rankingModes = [
		{ value: '', label: 'Best match' },
		{ value: 'lexical', label: 'Exact words' },
		{ value: 'semantic', label: 'Related ideas' }
	];

	const selectedMode = $derived(
		state.mode === 'lexical' || state.mode === 'semantic' ? state.mode : ''
	);

	const orphanedChannelSlugs = $derived.by(() => {
		const manifestSlugs = new Set(channels.map((channel) => channel.slug));
		return state.channelSlugs.filter((slug) => !manifestSlugs.has(slug));
	});

	const QUERY_DEBOUNCE_MS = 150;

	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	let requestedHref: ArchiveSearchHref | undefined;

	$effect(() => {
		void state;
		requestedHref = undefined;
	});

	function cancelPending() {
		clearTimeout(debounceTimer);
		debounceTimer = undefined;
	}

	function search(form: HTMLFormElement) {
		cancelPending();
		const entries = [...new FormData(form)].filter(
			(entry): entry is [string, string] => typeof entry[1] === 'string'
		);
		const href = toArchiveSearchHref(readArchiveSearchStateFromEntries(entries));
		if (href === (requestedHref ?? toArchiveSearchHref(state))) return;
		requestedHref = href;
		onnavigate(href);
	}

	function handleSubmit(event: SubmitEvent & { currentTarget: HTMLFormElement }) {
		event.preventDefault();
		search(event.currentTarget);
	}

	function handleInput(event: Event & { currentTarget: HTMLFormElement }) {
		if (!(event.target instanceof HTMLInputElement) || event.target.type !== 'search') return;
		cancelPending();
		const form = event.currentTarget;
		debounceTimer = setTimeout(() => search(form), QUERY_DEBOUNCE_MS);
	}

	function handleKeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }) {
		if (event.key !== 'Enter' || event.isComposing || !event.currentTarget.form) return;
		event.preventDefault();
		search(event.currentTarget.form);
	}

	function handleChange(event: Event & { currentTarget: HTMLFormElement }) {
		if (event.target instanceof HTMLInputElement && event.target.type === 'search') return;
		search(event.currentTarget);
	}

	$effect(() => cancelPending);
</script>

<form
	class="flex flex-col gap-2"
	method="GET"
	action="/"
	role="search"
	onsubmit={handleSubmit}
	oninput={handleInput}
	onchange={handleChange}
>
	<label class="visually-hidden" for="archive-query">Search the archive</label>
	<input
		id="archive-query"
		class="h-(--control-lg) min-h-0 appearance-none px-3 [&::-webkit-search-cancel-button]:appearance-none"
		name={ARCHIVE_SEARCH_PARAM.query}
		type="search"
		value={state.query}
		placeholder="Search materials, ideas, images…"
		autocomplete="off"
		onkeydown={handleKeydown}
	/>

	<div class="flex flex-wrap items-center gap-x-2 gap-y-2">
		<div class="flex h-(--control-sm) min-w-0 items-center gap-x-3">
			<label class="visually-hidden" for="archive-mode">Ranking</label>
			<select
				class="h-(--control-sm) appearance-none chevron pl-3 text-text-tertiary"
				id="archive-mode"
				name={ARCHIVE_SEARCH_PARAM.mode}
				value={selectedMode}
			>
				{#each rankingModes as option (option.value)}
					<option value={option.value}>{option.label}</option>
				{/each}
			</select>
		</div>

		{#if channels.length}
			<FilterMenu label="Channel" count={state.channelSlugs.length}>
				{#each channels as channel (channel.slug)}
					<label class="flex items-center gap-1.5 text-text-secondary">
						<input
							type="checkbox"
							name={ARCHIVE_SEARCH_PARAM.channel}
							value={channel.slug}
							checked={state.channelSlugs.includes(channel.slug)}
						/>
						<span class="trim-text">{channel.title}</span>
					</label>
				{/each}
			</FilterMenu>
		{/if}

		<FilterMenu label="Block type" count={state.blockTypes.length}>
			{#each ARCHIVE_BLOCK_TYPES as blockType (blockType)}
				<label class="flex items-center gap-1.5 text-text-secondary">
					<input
						type="checkbox"
						name={ARCHIVE_SEARCH_PARAM.type}
						value={blockType}
						checked={state.blockTypes.includes(blockType)}
					/>
					<span class="trim-text">{blockType}</span>
				</label>
			{/each}
		</FilterMenu>

		<div class="ml-8 flex h-(--control-sm) min-w-0 items-center gap-x-2">
			<label class="text-text-secondary trim-text" for="archive-from">From</label>
			<input
				class="h-(--control-sm) px-3 text-text-tertiary"
				id="archive-from"
				name={ARCHIVE_SEARCH_PARAM.from}
				type="date"
				value={state.from}
				max={state.to || undefined}
			/>
		</div>

		<div class="flex h-(--control-sm) min-w-0 items-center gap-x-2">
			<label class="text-text-secondary trim-text" for="archive-to">To</label>
			<input
				class="h-(--control-sm) px-3 text-text-tertiary"
				id="archive-to"
				name={ARCHIVE_SEARCH_PARAM.to}
				type="date"
				value={state.to}
				min={state.from || undefined}
			/>
		</div>

		<p class="m-0 ml-auto meta" aria-hidden="true">{timings || status}</p>
		<p class="visually-hidden" role="status" aria-live="polite">{status}</p>
	</div>

	{#each orphanedChannelSlugs as slug (slug)}
		<input type="hidden" name={ARCHIVE_SEARCH_PARAM.channel} value={slug} />
	{/each}
</form>
