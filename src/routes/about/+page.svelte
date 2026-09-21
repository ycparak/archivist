<svelte:head>
	<title>About — Archivist</title>
	<meta name="description" content="How Archivist searches an Are.na archive." />
</svelte:head>

<main>
	<header class="rule">
		<h1>About</h1>
	</header>

	<div class="prose">
		<p class="reading-width">
			Archivist is a search and gallery surface for one maintainer's Are.na archive. It exists so a
			visual reference, idea, or phrase can find its original block again — not to summarize, tag,
			or reinterpret the archive.
		</p>

		<section class="stack reading-width" data-gap="md">
			<h2>Where the archive comes from</h2>
			<p>
				Are.na stays the source of truth. A maintainer-only command reads every channel the
				maintainer's own account owns with a read-only token and copies each block's existing
				metadata — title, description, text content, source, type, and channel membership — into
				search. Nothing is generated: no captions, tags, OCR, or crawled links. Sync is manual and
				occasional; a visitor's search never calls Are.na.
			</p>
		</section>

		<div class="divider" role="presentation"></div>

		<section class="stack reading-width" data-gap="md">
			<h2>How search works</h2>
			<p>
				Every synced block is indexed once as plain text and as a native embedding in Turbopuffer,
				the only search datastore. <strong>Best match</strong>, the default, runs exact-word and
				related-idea ranking together and fuses them with reciprocal-rank fusion.
				<strong>Exact words</strong>
				ranks by text alone; <strong>related ideas</strong> ranks by embedding similarity alone, so
				a query can surface a block whose wording differs from it. <strong>Browse</strong> skips ranking
				and lists the newest connected blocks. Channel, block-type, and connected-date filters narrow
				all four, and the current search always lives in the URL.
			</p>
		</section>

		<div class="divider" role="presentation"></div>

		<section class="stack reading-width" data-gap="md">
			<h2>How it's built</h2>
			<p>
				The app is SvelteKit on Cloudflare Workers: server rendering, routing, and the search
				endpoint in one TypeScript codebase, deployed at the edge. Turbopuffer holds both the
				full-text index and the vector index behind one query, so ranking never has to reconcile two
				separate scores in application code.
			</p>
		</section>
	</div>
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		gap: calc(var(--spacing) * 12);
		margin-block-end: calc(var(--spacing) * 16);
	}

	.prose {
		display: flex;
		flex-direction: column;
		gap: calc(var(--spacing) * 8);
		font-size: var(--text-article);
		line-height: var(--text-article--line-height);
	}

	.prose p {
		margin: 0;
	}

	section p {
		color: var(--color-text-secondary);
	}
</style>
