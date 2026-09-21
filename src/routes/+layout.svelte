<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { resolve } from '$app/paths';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div
	class="grid grid-cols-[minmax(0,1fr)] md:min-h-dvh md:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]"
>
	<aside class="bg-background-sunken py-4 pr-4 pl-3 md:sticky md:top-0 md:h-dvh md:self-start">
		<div class="flex gap-6 rule md:flex-col md:gap-12">
			<a
				class="block text-text no-underline trim-text"
				href={resolve('/')}
				target="_blank"
				rel="noopener noreferrer">Archivist</a
			>
		</div>
	</aside>
	<div class="min-w-0 p-6 pt-4">
		{@render children()}
	</div>
</div>
