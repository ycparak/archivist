<script lang="ts">
	import './layout.css';
	import faviconIco from '$lib/assets/favicon.ico';
	import faviconSvg from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<!-- The .ico is declared first as the fallback: a browser that understands `image/svg+xml`
	     takes the SVG, and one that does not is left with a real icon rather than none. -->
	<link rel="icon" href={faviconIco} sizes="32x32" />
	<link rel="icon" href={faviconSvg} type="image/svg+xml" />
</svelte:head>

{@render children()}
