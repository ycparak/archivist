<svelte:head>
	<title>Archivist</title>
	<meta name="description" content="A visual search and browsing surface for an Are.na archive." />
</svelte:head>

<main>
	<p class="eyebrow">Are.na visual archive</p>
	<h1>Archivist</h1>
	<p class="intro">A gallery and hybrid search surface for original Are.na blocks.</p>
	<form aria-label="Search archive">
		<label for="archive-search">Search the archive</label>
		<div class="search-row">
			<input
				id="archive-search"
				name="q"
				type="search"
				placeholder="Materials, images, ideas…"
				disabled
			/>
			<button type="submit" disabled>Search</button>
		</div>
	</form>
	<p class="status">The search surface will activate after the first manual archive sync.</p>
</main>

<style>
	main {
		box-sizing: border-box;
		display: grid;
		align-content: center;
		min-height: 100dvh;
		max-width: 52rem;
		margin: auto;
		padding: clamp(1.5rem, 7vw, 5rem);
	}

	.eyebrow {
		margin: 0 0 1rem;
		color: #d7a46b;
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	h1 {
		margin: 0;
		font-family: Georgia, serif;
		font-size: clamp(4rem, 12vw, 8rem);
		font-weight: 400;
		letter-spacing: -0.06em;
		line-height: 0.9;
	}

	.intro {
		max-width: 36rem;
		margin: 1.75rem 0 3rem;
		color: #c5bab0;
		font-size: 1.125rem;
		line-height: 1.6;
	}

	form {
		max-width: 42rem;
	}

	label {
		display: block;
		margin-bottom: 0.6rem;
		font-size: 0.875rem;
		font-weight: 600;
	}

	.search-row {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.75rem;
	}

	input,
	button {
		border: 1px solid #6f6154;
		border-radius: 0.5rem;
		font: inherit;
	}

	input {
		min-width: 0;
		padding: 0.9rem 1rem;
		color: inherit;
		background: #211b17;
	}

	button {
		padding: 0.9rem 1.2rem;
		color: #8f847b;
		background: #30271f;
	}

	.status {
		margin: 1rem 0 0;
		color: #a99d93;
		font-size: 0.875rem;
	}

	@media (max-width: 30rem) {
		.search-row {
			grid-template-columns: 1fr;
		}
	}
</style>
