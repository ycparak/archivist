import type { ArchiveBlockType } from '$lib/domain/archive';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatArchiveDate(value: string | null): string | null {
	if (!value) return null;
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return null;
	return `${parsed.getUTCDate()} ${MONTHS[parsed.getUTCMonth()]} ${parsed.getUTCFullYear()}`;
}

const UNTITLED_LABELS: Record<ArchiveBlockType, string> = {
	Image: 'Untitled image',
	Link: 'Untitled link',
	Text: 'Untitled text',
	Attachment: 'Untitled attachment',
	Embed: 'Untitled embed'
};

export function blockDisplayTitle(title: string | null, blockType: string): string {
	if (title) return title;
	return UNTITLED_LABELS[blockType as ArchiveBlockType] ?? 'Untitled block';
}
