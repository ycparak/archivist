import { describe, expect, it } from 'vitest';
import { isLowQualityTitle, lowQualityTitleReason } from './titles';

/**
 * Every string below is a real title from the archive. False positives destroy metadata the
 * maintainer wrote, so the negative cases matter more than the positive ones.
 */

describe('lowQualityTitleReason — filenames', () => {
	it.each([
		'cleanshot-2025-02-28-at-17.36.56.png',
		'4f90d83c9caf154cc04566.webp',
		'tumblr_n99eocobrf1qiz04po1_1280.jpg',
		'2.jpeg',
		'image.png',
		'browser.gif',
		'ortto_shapes.png',
		'gkjzlakwaaabkhy?format=jpg-name=large',
		'242390046_387046312940068_3275324371673131774_n.jpg?_nc_ht=instagram.f',
		'original-0280b5e43cfe8440ab66b40e1ec7162d.png?compress=1-resize=1905x1',
		'HFLtWh1XkAEy1X3 (1800×1800)',
		'G3AldfRbwAA80YA (1024×683)'
	])('flags %s', (title) => {
		expect(lowQualityTitleReason(title)).toBe('filename');
	});
});

describe('lowQualityTitleReason — opaque tokens', () => {
	it.each([
		'eyjidwnrzxqioijhcmvuyv9pbwfnzxmilcjrzxkioii1odc2odkvb3jpz2luywxfndy1zdk4mwnknjhkmzm5mdu0',
		'ad_4nxdtsh1feugudmrpqjskixa-znal3lb4zxdyow-v23vguyh_st8vowxvofpjerbehb1mx2fn5owg6mavcvcu',
		'digitalassets.tesla.com/tesla-contents/video/upload/f_auto,q_auto:best/powerwall-store-u',
		'15zhd47sylinmalqaws0b1p5svgm',
		'de3c0a438bc519c280d0b7e48dab453c'
	])('flags %s', (title) => {
		expect(lowQualityTitleReason(title)).toBe('opaque');
	});
});

describe('lowQualityTitleReason — platform boilerplate', () => {
	it.each([
		'Seth Thompson on X: "Searching my library is now fast enough" / X',
		'alexey on X (formerly Twitter): "hey, designers, what do you call this"',
		'(1) Tobias Renström on X: "Folders"',
		'Some Talk - YouTube'
	])('flags %s', (title) => {
		expect(lowQualityTitleReason(title)).toBe('boilerplate');
	});
});

describe('lowQualityTitleReason — restating the description', () => {
	const description =
		'Searching my library is now fast enough for live searches as I type! Querying 100k paragraphs and 20k figures takes ~10-30ms.';

	it('flags a long title that repeats the description it sits above', () => {
		const title = `Some Person: "${description}" and then some more trailing text to push it well past the length floor`;
		expect(lowQualityTitleReason(title, description)).toBe('restates-description');
	});

	it('does not flag a long title that says something the description does not', () => {
		const title =
			'Screen As Room: An Architectural Perspective on User Interfaces — Christoph Labacher · Interface Essays';
		expect(lowQualityTitleReason(title, description)).toBeNull();
	});

	it('does not flag a short title even when it matches the description exactly', () => {
		expect(
			lowQualityTitleReason('Live search', 'Live search is now fast enough for me')
		).toBeNull();
	});

	it('needs a description to compare against', () => {
		const title = `Some Person: "${description}" and then some more trailing text to push it well past the length floor`;
		expect(lowQualityTitleReason(title, null)).toBeNull();
		expect(lowQualityTitleReason(title, 'short')).toBeNull();
	});
});

describe('lowQualityTitleReason — titles that must survive', () => {
	it.each([
		'George Bellows',
		'by @henrikruscon',
		// A bare ` / X` suffix is not enough on its own; this stays.
		'Home / X',
		'UI Density',
		'LLM Visualization',
		'Lightfield — AI-native CRM',
		'Pulse (Tandem) - Silver – BREDA',
		'Brand New: New Name, Logo, and Identity for Ortto by Christopher Doyle & Co.',
		"Vincent van Gogh | L'Arlésienne: Madame Joseph-Michel Ginoux (Marie Julien, 1848-1911)",
		'Screen As Room: An Architectural Perspective on User Interfaces — Christoph Labacher',
		'Subway performer stuns crowd with Fleetwood Mac\'s "Landslide" - Chicago, Il',
		"Biograph, the world's most advanced preventive health and diagnostics clinic, launches",
		'SS24 april:capsule Gustavo styles our football-focused capsule collection for spring',
		'From the typography community on Reddit: Hey guys! Let me present you Sahara'
	])('keeps %s', (title) => {
		expect(isLowQualityTitle(title)).toBe(false);
	});
});

describe('lowQualityTitleReason — absent titles', () => {
	it('reports nothing for a block with no title, which is a separate case', () => {
		expect(lowQualityTitleReason(null)).toBeNull();
		expect(lowQualityTitleReason('')).toBeNull();
		expect(lowQualityTitleReason('   ')).toBeNull();
	});
});
