import type { Paint } from './format';

/**
 * Escape codes are written directly rather than pulled in as a dependency: a redraw loop and five
 * colours are less code than the wrapper would be, and AGENTS.md asks a dependency to remove
 * meaningful production code before it earns a place.
 */

export const CURSOR_HIDE = '\x1b[?25l';
export const CURSOR_SHOW = '\x1b[?25h';
export const CLEAR_TO_END = '\x1b[0J';
const RESET = '\x1b[0m';

export function cursorUp(lines: number): string {
	return lines > 0 ? `\x1b[${lines}A` : '';
}

const CODES = {
	dim: '\x1b[2m',
	head: '\x1b[36m',
	ok: '\x1b[32m',
	warn: '\x1b[33m',
	bad: '\x1b[31m'
} as const;

function wrap(code: string): (text: string) => string {
	return (text) => `${code}${text}${RESET}`;
}

export const COLOUR_PAINT: Paint = {
	dim: wrap(CODES.dim),
	head: wrap(CODES.head),
	ok: wrap(CODES.ok),
	warn: wrap(CODES.warn),
	bad: wrap(CODES.bad)
};

/** `NO_COLOR` wins over everything, including a terminal that would otherwise take colour. */
export function supportsColour(
	env: Record<string, string | undefined>,
	isTTY: boolean | undefined
): boolean {
	if (env.NO_COLOR) return false;
	if (env.FORCE_COLOR) return true;
	if (env.TERM === 'dumb') return false;
	return Boolean(isTTY);
}

// eslint-disable-next-line no-control-regex -- matching escape sequences is the point.
const ANSI_PATTERN = /\x1b\[[0-9;?]*[a-zA-Z]/g;

export function visibleLength(text: string): number {
	return text.replace(ANSI_PATTERN, '').length;
}

/**
 * Cuts a line to a visible width without counting escape codes, because a line that wraps breaks
 * the redraw: the region would then occupy more rows than the renderer moves the cursor back over,
 * and every repaint would leave a stripe of debris behind it.
 */
export function clampWidth(text: string, max: number): string {
	if (max <= 0) return '';
	if (visibleLength(text) <= max) return text;

	let visible = 0;
	let out = '';
	for (let index = 0; index < text.length;) {
		ANSI_PATTERN.lastIndex = index;
		const match = ANSI_PATTERN.exec(text);
		if (match && match.index === index) {
			out += match[0];
			index += match[0].length;
			continue;
		}
		if (visible >= max) break;
		out += text[index];
		visible += 1;
		index += 1;
	}

	return `${out}${RESET}`;
}
