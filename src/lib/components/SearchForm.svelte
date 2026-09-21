<script lang="ts">
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
		onnavigate
	}: {
		state: ArchiveSearchState;
		channels: ChannelManifestEntry[];
		status?: string;
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

	// Preserve a channel filter the manifest doesn't (yet, or no longer) list — e.g. a shared URL
	// from before the last sync — instead of silently dropping it on the next submit.
	const orphanedChannelSlugs = $derived.by(() => {
		const manifestSlugs = new Set(channels.map((channel) => channel.slug));
		return state.channelSlugs.filter((slug) => !manifestSlugs.has(slug));
	});

	// Long enough to skip keystrokes mid-word, short enough to feel live.
	const QUERY_DEBOUNCE_MS = 150;

	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	// The href most recently sent to `onnavigate`, so Enter doesn't repeat a search already in flight.
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

	// Typing is debounced; discrete controls (checkboxes, select, dates) fire `change` and search at
	// once. The query input's own `change` (blur/Enter) is skipped because `input` already covers it.
	function handleInput(event: Event & { currentTarget: HTMLFormElement }) {
		if (!(event.target instanceof HTMLInputElement) || event.target.type !== 'search') return;
		cancelPending();
		const form = event.currentTarget;
		debounceTimer = setTimeout(() => search(form), QUERY_DEBOUNCE_MS);
	}

	// The date inputs mean the form has several text-like fields, so browsers won't submit on Enter
	// without a submit button; handle it explicitly.
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
	class="search-form"
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
		class="query"
		name={ARCHIVE_SEARCH_PARAM.query}
		type="search"
		value={state.query}
		placeholder="Search materials, ideas, images…"
		autocomplete="off"
		onkeydown={handleKeydown}
	/>

	<div class="controls">
		<div class="field">
			<label for="archive-mode">Ranking</label>
			<select id="archive-mode" name={ARCHIVE_SEARCH_PARAM.mode} value={selectedMode}>
				{#each rankingModes as option (option.value)}
					<option value={option.value}>{option.label}</option>
				{/each}
			</select>
		</div>

		{#if channels.length}
			<details class="field channel-control" open={state.channelSlugs.length > 0 || undefined}>
				<summary>
					Channel{#if state.channelSlugs.length}<span class="count"
							>{state.channelSlugs.length}</span
						>{/if}
				</summary>
				<div class="channels">
					{#each channels as channel (channel.slug)}
						<label class="checkbox">
							<input
								type="checkbox"
								name={ARCHIVE_SEARCH_PARAM.channel}
								value={channel.slug}
								checked={state.channelSlugs.includes(channel.slug)}
							/>
							{channel.title}
						</label>
					{/each}
				</div>
			</details>
		{/if}

		<div class="field" role="group" aria-labelledby="archive-type-label">
			<span id="archive-type-label" class="label">Block type</span>
			{#each ARCHIVE_BLOCK_TYPES as blockType (blockType)}
				<label class="checkbox">
					<input
						type="checkbox"
						name={ARCHIVE_SEARCH_PARAM.type}
						value={blockType}
						checked={state.blockTypes.includes(blockType)}
					/>
					{blockType}
				</label>
			{/each}
		</div>

		<div class="field">
			<label for="archive-from">Connected from</label>
			<input
				id="archive-from"
				name={ARCHIVE_SEARCH_PARAM.from}
				type="date"
				value={state.from}
				max={state.to || undefined}
			/>
		</div>

		<div class="field">
			<label for="archive-to">Connected to</label>
			<input
				id="archive-to"
				name={ARCHIVE_SEARCH_PARAM.to}
				type="date"
				value={state.to}
				min={state.from || undefined}
			/>
		</div>

		<p class="status meta" role="status" aria-live="polite">{status}</p>
	</div>

	{#each orphanedChannelSlugs as slug (slug)}
		<input type="hidden" name={ARCHIVE_SEARCH_PARAM.channel} value={slug} />
	{/each}
</form>

<style>
	.search-form {
		display: flex;
		flex-direction: column;
		gap: var(--spacing);
	}

	.query {
		block-size: var(--control-lg);
		padding-inline: calc(var(--spacing) * 3);
		appearance: none;
	}

	.query::-webkit-search-cancel-button {
		appearance: none;
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing) calc(var(--spacing) * 3);
		align-items: center;
	}

	.field {
		display: flex;
		flex-wrap: wrap;
		gap: calc(var(--spacing) * 1) calc(var(--spacing) * 2);
		align-items: center;
		min-inline-size: 0;
	}

	.label {
		white-space: nowrap;
	}

	.field > label:not(.checkbox),
	.label,
	summary {
		color: var(--color-text-secondary);
	}

	.field select,
	.field input[type='date'] {
		block-size: var(--control-sm);
		padding-inline: calc(var(--spacing) * 3);
	}

	.field select {
		padding-inline-end: calc(var(--spacing) * 8);
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none' stroke='%236a6a6a' stroke-width='1.25'%3E%3Cpath d='m1 1 4 4 4-4'/%3E%3C/svg%3E");
		background-position: right calc(var(--spacing) * 3) center;
		background-repeat: no-repeat;
		appearance: none;
	}

	.checkbox {
		display: flex;
		gap: calc(var(--spacing) * 1.5);
		align-items: center;
		color: var(--color-text-secondary);
	}

	.checkbox input {
		flex: none;
		inline-size: calc(var(--spacing) * 4);
		block-size: calc(var(--spacing) * 4);
		min-block-size: 0;
		background-position: center;
		background-repeat: no-repeat;
		appearance: none;
	}

	.checkbox input:checked {
		background-color: var(--color-accent);
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='8' fill='none' stroke='%23fff' stroke-width='1.5'%3E%3Cpath d='m1 4 3 3 5-6'/%3E%3C/svg%3E");
		border-color: var(--color-accent);
	}

	.checkbox input:checked:hover {
		background-color: var(--color-accent-strong);
	}

	.channel-control {
		position: relative;
		display: block;
		align-self: stretch;
	}

	summary {
		display: flex;
		gap: calc(var(--spacing) * 2);
		align-items: center;
		block-size: var(--control-sm);
		cursor: pointer;
		list-style: none;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	.count {
		color: var(--color-text);
	}

	.channels {
		position: absolute;
		z-index: 1;
		inset-block-start: 100%;
		inset-inline-start: 0;
		display: flex;
		flex-direction: column;
		gap: calc(var(--spacing) * 2);
		inline-size: max-content;
		max-inline-size: min(20rem, 80vw);
		max-block-size: 16rem;
		padding: calc(var(--spacing) * 3);
		overflow-y: auto;
		background: var(--color-surface);
		border: var(--border-width) solid var(--color-border);
	}

	.status {
		margin: 0;
		margin-inline-start: auto;
	}
</style>
