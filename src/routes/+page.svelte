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
