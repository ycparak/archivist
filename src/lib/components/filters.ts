import {
	ARCHIVE_BLOCK_TYPES,
	ARCHIVE_COLOURS,
	ARCHIVE_MAX_COLOURS,
	toArchiveSearchHref,
	type ArchiveColour,
	type ArchiveSearchHref,
	type ArchiveSearchState,
	type ArchiveSort,
	type ChannelManifestEntry
} from '$lib/domain/search';

export function toggled<T>(values: readonly T[], value: T): T[] {
	return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

export function hrefWith(
	state: ArchiveSearchState,
	patch: Partial<ArchiveSearchState>
): ArchiveSearchHref {
	return toArchiveSearchHref({ ...state, ...patch });
}

export function canAddColour(state: ArchiveSearchState, colour: ArchiveColour): boolean {
	return state.colours.includes(colour) || state.colours.length < ARCHIVE_MAX_COLOURS;
}

/** The oldest connection in the archive as of October 2026; the date slider starts here. */
export const CONNECTED_AT_FIRST_MONTH = { year: 2024, month: 6 } as const;

export type Month = { year: number; month: number };

export function monthsBetween(first: Month, last: Month): number {
	return Math.max(1, (last.year - first.year) * 12 + (last.month - first.month) + 1);
}

export function monthAt(first: Month, index: number): Month {
	const zeroBased = first.month - 1 + index;
	return { year: first.year + Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

function pad(value: number): string {
	return String(value).padStart(2, '0');
}

function lastDay({ year, month }: Month): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthIndexOf(date: string, first: Month, count: number, fallback: number): number {
	const match = /^(\d{4})-(\d{2})/.exec(date);
	if (!match) return fallback;
	const index = (Number(match[1]) - first.year) * 12 + (Number(match[2]) - first.month);
	return Math.min(count - 1, Math.max(0, index));
}

/** The slider positions for a `from`/`to` pair; a missing bound sits at its end of the range. */
export function datesToMonthRange(
	from: string,
	to: string,
	first: Month,
	count: number
): [number, number] {
	return [monthIndexOf(from, first, count, 0), monthIndexOf(to, first, count, count - 1)];
}

/** Whole months as inclusive dates; a thumb resting at its end of the range sets no bound. */
export function monthRangeToDates(
	start: number,
	end: number,
	first: Month,
	count: number
): { from: string; to: string } {
	const low = Math.min(start, end);
	const high = Math.max(start, end);
	const startMonth = monthAt(first, low);
	const endMonth = monthAt(first, high);
	return {
		from: low <= 0 ? '' : `${startMonth.year}-${pad(startMonth.month)}-01`,
		to: high >= count - 1 ? '' : `${endMonth.year}-${pad(endMonth.month)}-${pad(lastDay(endMonth))}`
	};
}

const monthLabel = new Intl.DateTimeFormat('en-GB', {
	month: 'short',
	year: 'numeric',
	timeZone: 'UTC'
});

export function formatMonth({ year, month }: Month): string {
	return monthLabel.format(new Date(Date.UTC(year, month - 1, 1)));
}

export type FilterOption = {
	key: string;
	label: string;
	/** Absent when the option cannot apply to the current search. */
	href?: ArchiveSearchHref;
	active: boolean;
};

const RANKINGS = [
	{ mode: 'hybrid', label: 'Best match' },
	{ mode: 'lexical', label: 'Exact words' },
	{ mode: 'semantic', label: 'Related ideas' }
] as const;

/** Ranking only means something with a query; browse has its own order. */
export function searchTypeOptions(state: ArchiveSearchState): FilterOption[] {
	const querying = Boolean(state.query.trim());
	return RANKINGS.map(({ mode, label }) => ({
		key: mode,
		label,
		href: querying ? hrefWith(state, { mode }) : undefined,
		active: querying && state.mode === mode
	}));
}

const SORTS: { sort: ArchiveSort; label: string }[] = [
	{ sort: 'connections', label: 'Most connected' },
	{ sort: 'newest', label: 'Newest' },
	{ sort: 'oldest', label: 'Oldest' }
];

/** Order only applies to browse; a query ranks by relevance. */
export function sortOptions(state: ArchiveSearchState): FilterOption[] {
	const browsing = !state.query.trim() || state.mode === 'browse';
	return SORTS.map(({ sort, label }) => ({
		key: sort,
		label,
		href: browsing ? hrefWith(state, { sort }) : undefined,
		active: browsing && state.sort === sort
	}));
}

export function blockTypeOptions(state: ArchiveSearchState): FilterOption[] {
	return ARCHIVE_BLOCK_TYPES.map((type) => ({
		key: type,
		label: type,
		href: hrefWith(state, { blockTypes: toggled(state.blockTypes, type) }),
		active: state.blockTypes.includes(type)
	}));
}

export function channelOption(
	state: ArchiveSearchState,
	channel: ChannelManifestEntry
): FilterOption {
	return {
		key: channel.slug,
		label: channel.title,
		href: hrefWith(state, { channelSlugs: toggled(state.channelSlugs, channel.slug) }),
		active: state.channelSlugs.includes(channel.slug)
	};
}

const COLOUR_LABELS: Record<ArchiveColour, string> = {
	red: 'Red',
	orange: 'Orange',
	yellow: 'Yellow',
	green: 'Green',
	blue: 'Blue',
	purple: 'Purple',
	pink: 'Pink',
	brown: 'Brown',
	grey: 'Grey',
	black: 'Black',
	white: 'White',
	mono: 'Black & white'
};

/** Black and white are left off the swatches; a URL may still ask for them, and then they show so they can be removed. */
const HIDDEN_COLOURS: readonly ArchiveColour[] = ['black', 'white'];

export function colourOptions(state: ArchiveSearchState): FilterOption[] {
	const offered = ARCHIVE_COLOURS.filter(
		(colour) => !HIDDEN_COLOURS.includes(colour) || state.colours.includes(colour)
	);
	return offered.map((colour) => ({
		key: colour,
		label: COLOUR_LABELS[colour],
		href: canAddColour(state, colour)
			? hrefWith(state, { colours: toggled(state.colours, colour) })
			: undefined,
		active: state.colours.includes(colour)
	}));
}
