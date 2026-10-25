import { beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { SPECIES, type TreeSpecies } from "../src/actions/grove-core";
import { soilSvg, treeSvg } from "../src/actions/tree-render";

/**
 * Not a test — a preview tool. Generates an HTML contact sheet of every species
 * across growth stages and seeds so tree aesthetics can be judged in a browser.
 * Skipped during normal test runs; opt in with PREVIEW_TREES=1:
 *
 *   PREVIEW_TREES=1 npx vitest run test/tree-preview.test.ts
 */
describe.skipIf(process.env.PREVIEW_TREES === undefined)("tree contact sheet", () => {
	const outPath = join(process.cwd(), "tree-preview.html");

	beforeAll(() => {
		const growthTokens = [0, 0.02, 0.15, 0.4, 0.7, 1];
		const seeds = [1, 42, 777, 9182];
		const speciesList = Object.values(SPECIES) as TreeSpecies[];
		const cell = (svg: string) => `<div class="cell">${svg.replace('width="144" height="144"', 'width="216" height="216"')}</div>`;

		const sections = speciesList.map((species) => {
			const rows = seeds
				.map((seed) => {
					const cells = growthTokens
						.map((fraction) => treeSvg(species, seed, Math.round(species.costTokens * fraction)))
						.map(cell)
						.join("");
					return `<div class="row"><div class="label">seed ${seed}</div>${cells}</div>`;
				})
				.join("");
			const soil = `<div class="row"><div class="label">empty</div>${cell(soilSvg(species)).repeat(growthTokens.length)}</div>`;
			return `<section><h2>${species.name} — ${species.costTokens.toLocaleString()} tokens</h2>${rows}${soil}</section>`;
		}).join("");

		const html = `<!doctype html><html><head><title>Tree preview</title><style>
			body { background: #0d0d0d; color: #ddd; font-family: monospace; }
			section { margin-bottom: 32px; }
			.row { display: flex; align-items: center; gap: 4px; }
			.cell { width: 216px; height: 216px; flex: none; }
			.cell svg { width: 216px; height: 216px; display: block; }
			.label { width: 90px; color: #888; font-size: 12px; }
			h2 { font-size: 14px; color: #9a9a9a; }
		</style></head><body>${sections}</body></html>`;
		mkdirSync(process.cwd(), { recursive: true });
		writeFileSync(outPath, html);
	});

	it("writes the contact sheet", () => {
		expect(outPath).toContain("tree-preview.html");
	});
});