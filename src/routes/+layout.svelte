<script lang="ts">
	import './layout.css';
	import faviconIco from '$lib/assets/favicon.ico';
	import faviconSvg from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={faviconIco} sizes="32x32" />
	<link rel="icon" href={faviconSvg} type="image/svg+xml" />
</svelte:head>

{@render children()}
