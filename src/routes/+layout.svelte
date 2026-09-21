<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { resolve } from '$app/paths';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="shell">
	<aside class="sidebar">
		<div class="sidebar-inner rule">
			<a class="name" href={resolve('/')}>Archivist</a>
			<a class="about meta" href={resolve('/about')}>About</a>
		</div>
	</aside>
	<div class="pane">
		{@render children()}
	</div>
</div>

<style>
	.shell {
		display: grid;
		grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
		min-block-size: 100dvh;
	}

	.sidebar {
		position: sticky;
		inset-block-start: 0;
		block-size: 100dvh;
		padding: var(--gutter);
		padding-inline-end: calc(var(--spacing) * 4);
		background: var(--color-background-sunken);
	}

	.sidebar-inner {
		display: flex;
		flex-direction: column;
		gap: calc(var(--spacing) * 12);
	}

	.name {
		color: var(--color-text);
		text-decoration: none;
	}

	.about {
		text-decoration: none;
	}

	.about:hover {
		color: var(--color-text);
	}

	.pane {
		min-inline-size: 0;
		padding: var(--gutter);
	}

	@media (max-width: 44.999rem) {
		.shell {
			grid-template-columns: minmax(0, 1fr);
			min-block-size: 0;
		}

		.sidebar {
			position: static;
			block-size: auto;
			padding-block-end: calc(var(--spacing) * 4);
		}

		.sidebar-inner {
			flex-direction: row;
			gap: calc(var(--spacing) * 6);
		}
	}
</style>
