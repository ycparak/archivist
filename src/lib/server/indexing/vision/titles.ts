/**
 * Which Are.na titles carry no information and are worth replacing with a generated one.
 *
 * Block type is deliberately not part of this decision. An earlier rule exempted every Link on the
 * grounds that Link titles are real scraped page metadata — true of most, and false of the 93 that
 * are platform chrome wrapped around a copy of the description. See the ADR amendment.
 *
 * Counts below are over the 2,577 titled blocks in the live archive at the time of writing. False
 * negatives are acceptable here; false positives destroy metadata the maintainer wrote.
 */

/** Upload filenames and CDN query junk: `cleanshot-2025-02-28.png`, `G3AldfRbwAA80YA (1024×683)`. */
const FILENAME =
	/\.(jpe?g|png|gif|gifv|webp|avif|tiff?|pdf|mp4|mov|webm)(\?|$)|\?format=|\?_nc_|\?stp=|\?compress=|\(\d+×\d+\)$/i;

/**
 * Platform chrome: `… on X: "…"`, `… on X (formerly Twitter): "…"`, `(1) …`, `… - YouTube`,
 * Instagram. A bare ` / X` suffix is deliberately not a trigger on its own — it would flag short
 * real titles like `Home / X`, and every scraped post title carries ` on X` anyway.
 */
const BOILERPLATE =
	/ on X(\s*\(formerly Twitter\))?: |^\(\d+\)\s|- YouTube$|on Instagram: |• Instagram/i;

const VERBOSE_MIN_CHARS = 80;
const REDUNDANT_PREFIX_CHARS = 25;

/**
 * Hashes, base64 blobs and bare URLs pressed into service as titles — one or two unbroken tokens
 * with a digit in them: `eyjidwnrzxqioijhcmvuyv9pbwfnzxmi…`,
 * `digitalassets.tesla.com/tesla-contents/video/upload/f_auto…`.
 */
function isOpaqueToken(title: string): boolean {
	if (title.split(/\s+/).length > 2 || title.length < 20) return false;
	if (!/^[\w\-.,:/~%]+$/.test(title)) return false;
	// A digit is the usual tell for a hash or a generated name; a bare URL qualifies without one.
	return /\d/.test(title) || /^[\w.-]+\.[a-z]{2,}\//i.test(title);
}

/**
 * Long, and just restating the description it sits above. This is the X/Twitter case: 112 titles are
 * X-shaped and 111 embed the opening of their own description — very nearly the same set.
 */
function isVerboseRestatement(title: string, description: string | null | undefined): boolean {
	const normalized = description?.replace(/\s+/g, ' ').trim() ?? '';
	if (title.length <= VERBOSE_MIN_CHARS || normalized.length <= REDUNDANT_PREFIX_CHARS)
		return false;
	return title.toLowerCase().includes(normalized.slice(0, REDUNDANT_PREFIX_CHARS).toLowerCase());
}

export type LowQualityTitleReason = 'filename' | 'opaque' | 'boilerplate' | 'restates-description';

/**
 * Why this title should be replaced, or `null` to leave it alone. Length on its own is never a
 * reason: a long title that is informative and does not restate its description is kept.
 */
export function lowQualityTitleReason(
	title: string | null | undefined,
	description?: string | null
): LowQualityTitleReason | null {
	const trimmed = title?.trim() ?? '';
	if (!trimmed) return null;

	if (FILENAME.test(trimmed)) return 'filename';
	if (isOpaqueToken(trimmed)) return 'opaque';
	if (BOILERPLATE.test(trimmed)) return 'boilerplate';
	if (isVerboseRestatement(trimmed, description)) return 'restates-description';
	return null;
}

export function isLowQualityTitle(
	title: string | null | undefined,
	description?: string | null
): boolean {
	return lowQualityTitleReason(title, description) !== null;
}

export function hasTitle(title: string | null | undefined): boolean {
	return Boolean(title?.trim());
}
