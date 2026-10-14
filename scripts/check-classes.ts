/**
 * Fails when a Tailwind class has a canonical spelling it is not written in: the same rule as the
 * Tailwind IntelliSense `suggestCanonicalClasses` lint (`[container-type:size]` → `@container-size`),
 * run over every source file by `bun run lint` so it holds outside the editor too.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { __unstable__loadDesignSystem } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';

const root = path.resolve(import.meta.dirname, '..');
const stylesheet = path.join(root, 'src/styles/globals.css');
/** IntelliSense's default `rootFontSize`, so this flags exactly what the editor flags. */
const ROOT_FONT_SIZE = 16;

const designSystem = await __unstable__loadDesignSystem(await readFile(stylesheet, 'utf8'), {
	base: path.dirname(stylesheet)
});

const scanner = new Scanner({
	sources: [{ base: path.join(root, 'src'), pattern: '**/*.{svelte,ts}', negated: false }]
});
scanner.scan();

const findings: string[] = [];
for (const file of scanner.files.filter((name) => !name.endsWith('.spec.ts')).sort()) {
	const content = await readFile(file, 'utf8');
	const extension = path.extname(file).slice(1);
	for (const { candidate, position } of scanner.getCandidatesWithPositions({
		content,
		extension
	})) {
		if (designSystem.candidatesToCss([candidate])[0] === null) continue;
		const [canonical] = designSystem.canonicalizeCandidates([candidate], {
			rem: ROOT_FONT_SIZE
		});
		if (canonical === candidate) continue;
		const line = content.slice(0, position).split('\n').length;
		findings.push(`${path.relative(root, file)}:${line}  ${candidate}  →  ${canonical}`);
	}
}

if (findings.length) {
	console.error(`Tailwind classes with a canonical spelling:\n\n${findings.join('\n')}\n`);
	process.exit(1);
}
console.log('Every Tailwind class is written in its canonical form.');
