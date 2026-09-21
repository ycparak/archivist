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
		onnavigate
	}: {
		state: ArchiveSearchState;
		channels: ChannelManifestEntry[];
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

	function handleSubmit(event: SubmitEvent & { currentTarget: HTMLFormElement }) {
		const entries = [...new FormData(event.currentTarget)].filter(
			(entry): entry is [string, string] => typeof entry[1] === 'string'
		);
		event.preventDefault();
		onnavigate(toArchiveSearchHref(readArchiveSearchStateFromEntries(entries)));
	}
</script>

<form class="search-form" method="GET" action="/" role="search" onsubmit={handleSubmit}>
	<div class="search-row">
		<label class="visually-hidden" for="archive-query">Search the archive</label>
		<input
			id="archive-query"
			name={ARCHIVE_SEARCH_PARAM.query}
			type="search"
			value={state.query}
			placeholder="Search materials, ideas, images…"
			autocomplete="off"
		/>
		<button type="submit">Search</button>
	</div>

	{#if channels.length}
		<fieldset class="control channel-control">
			<legend>Channel</legend>
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
		</fieldset>
	{/if}

	<div class="controls">
		<div class="control">
			<label for="archive-mode">Ranking</label>
			<select id="archive-mode" name={ARCHIVE_SEARCH_PARAM.mode} value={selectedMode}>
				{#each rankingModes as option (option.value)}
					<option value={option.value}>{option.label}</option>
				{/each}
			</select>
		</div>

		<fieldset class="control">
			<legend>Block type</legend>
			<div class="types">
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
		</fieldset>

		<div class="control">
			<label for="archive-from">Connected from</label>
			<input
				id="archive-from"
				name={ARCHIVE_SEARCH_PARAM.from}
				type="date"
				value={state.from}
				max={state.to || undefined}
			/>
		</div>

		<div class="control">
			<label for="archive-to">Connected to</label>
			<input
				id="archive-to"
				name={ARCHIVE_SEARCH_PARAM.to}
				type="date"
				value={state.to}
				min={state.from || undefined}
			/>
		</div>
	</div>

	{#each orphanedChannelSlugs as slug (slug)}
		<input type="hidden" name={ARCHIVE_SEARCH_PARAM.channel} value={slug} />
	{/each}
</form>

<style>
	.search-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
	}

	.search-row {
		display: flex;
		gap: var(--space-4);
	}

	.search-row input {
		flex: 1;
		min-inline-size: 0;
		block-size: var(--control-lg);
		padding-inline: var(--space-6);
		font-size: var(--text-md);
	}

	.search-row button {
		block-size: var(--control-lg);
		padding-inline: var(--space-12);
		color: var(--color-text-inverse);
		background: var(--color-accent);
		font-size: var(--text-sm);
	}

	.search-row button:hover {
		background: var(--color-accent-hover);
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-6) var(--space-12);
		align-items: end;
	}

	.control {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-inline-size: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}

	.control label,
	.control legend {
		padding: 0;
		color: var(--color-text-secondary);
		font-size: var(--text-sm);
		line-height: var(--leading-interface);
	}

	.control select,
	.control input[type='date'] {
		block-size: var(--control-md);
		padding-inline: var(--space-4);
		font-size: var(--text-sm);
	}

	.types {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-8);
		align-items: center;
		margin-block-start: var(--space-1);
	}

	.channel-control {
		max-inline-size: 16rem;
	}

	.channels {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		max-block-size: 9rem;
		margin-block-start: var(--space-1);
		padding-inline-end: var(--space-4);
		overflow-y: auto;
	}

	.checkbox {
		display: flex;
		gap: var(--space-3);
		align-items: center;
		color: var(--color-text-secondary);
		font-size: var(--text-sm);
	}

	.checkbox input {
		min-block-size: 0;
		accent-color: var(--color-accent);
	}

	@media (max-width: 30rem) {
		.search-row {
			flex-direction: column;
		}
	}
</style>
