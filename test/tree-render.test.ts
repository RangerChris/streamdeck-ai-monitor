import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";

import { SPECIES, type TreeSpecies } from "../src/actions/grove-core";
import { soilSvg, tokenBadgeFrames, treeSvg } from "../src/actions/tree-render";

/** Renders with all branches out, the easiest regime to assert against. */
const full = (species: TreeSpecies, seed: number) => treeSvg(species, seed, species.costTokens);

/** Smallest y any element can reach at full growth: lines by tip, circles by blob edge. */
function topmostY(svg: string): number {
	const ys = [...svg.matchAll(/<line [^>]*y2="(-?[\d.]+)"/g)].map((m) => Number(m[1]));
	const cy = [...svg.matchAll(/<circle [^>]*cy="(-?[\d.]+)"[^>]*r="([\d.]+)"/g)].map((m) => Number(m[1]) - Number(m[2]));
	return Math.min(...ys, ...cy);
}

/** Smallest and largest x reach, same shapes. */
function xReach(svg: string): { min: number; max: number } {
	const xs = [...svg.matchAll(/<line [^>]*x2="(-?[\d.]+)"/g)].map((m) => Number(m[1]));
	const circles = [...svg.matchAll(/<circle [^>]*cx="(-?[\d.]+)"[^>]*r="([\d.]+)"/g)].map((m) => [Number(m[1]) - Number(m[2]), Number(m[1]) + Number(m[2])]);
	return { min: Math.min(...xs, ...circles.map((c) => Math.min(...c))), max: Math.max(...xs, ...circles.map((c) => Math.max(...c))) };
}

describe("treeSvg fit to key", () => {
	// Tall species plus unlucky seeds used to push crowns past the frame edge.
	const talls = [SPECIES.redwood, SPECIES.birch, SPECIES.oak, SPECIES.cherry, SPECIES.bonsai];
	for (const species of talls) {
		it(`keeps a full-grown ${species.id} inside the frame across seeds`, () => {
			for (let seed = 1; seed <= 12; seed++) {
				const svg = full(species, seed);
				expect(topmostY(svg), `${species.id} seed ${seed} pokes above y=9`).toBeGreaterThanOrEqual(8.9);
				const reach = xReach(svg);
				expect(reach.min, `${species.id} seed ${seed} pokes left`).toBeGreaterThanOrEqual(4.9);
				expect(reach.max, `${species.id} seed ${seed} pokes right`).toBeLessThanOrEqual(139.1);
			}
		});
	}

	it("still uses most of the key height — fitting is not shrinking to a bonsai pot", () => {
		expect(topmostY(full(SPECIES.redwood, 5))).toBeLessThan(40);
	});

	it("crown reaches below the key midline at full growth — top half belongs to the crown", () => {
		for (const species of [SPECIES.bonsai, SPECIES.cherry, SPECIES.birch, SPECIES.oak, SPECIES.redwood]) {
			const svg = full(species, 7);
			const bottoms = [...svg.matchAll(/<circle [^>]*cy="(-?[\d.]+)"[^>]*r="([\d.]+)"/g)].map((m) => Number(m[1]) + Number(m[2]));
			expect(Math.max(...bottoms), `${species.id} crown stops above the midline`).toBeGreaterThanOrEqual(70);
		}
	});

	it("crown spans widths that fit each species' character", () => {
		// Oaks and bonsai famously go wide; the rest still need real foliage.
		const minCrownWidth: Record<string, number> = { bonsai: 84, oak: 88, cherry: 55, birch: 55, redwood: 55 };
		for (const species of [SPECIES.bonsai, SPECIES.cherry, SPECIES.birch, SPECIES.oak, SPECIES.redwood]) {
			const svg = full(species, 7);
			const lefts = [...svg.matchAll(/<circle [^>]*cx="(-?[\d.]+)"[^>]*r="([\d.]+)"/g)].map((m) => Number(m[1]) - Number(m[2]));
			const rights = [...svg.matchAll(/<circle [^>]*cx="(-?[\d.]+)"[^>]*r="([\d.]+)"/g)].map((m) => Number(m[1]) + Number(m[2]));
			const width = Math.max(...rights) - Math.min(...lefts);
			expect(width, `${species.id} crown too narrow`).toBeGreaterThanOrEqual(minCrownWidth[species.id]);
		}
	});
});

describe("treeSvg shell", () => {
	it("is a full 144x144 frame with the key background", () => {
		const svg = full(SPECIES.oak, 1);
		expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
		expect(svg).toContain('width="144"');
		expect(svg).toContain('viewBox="0 0 144 144"');
		expect(svg).toContain('fill="#141414"');
		expect(svg).toMatch(/<\/svg>$/);
	});
});

describe("treeSvg determinism", () => {
	it("is byte-identical for the same species, seed and tokens", () => {
		expect(treeSvg(SPECIES.birch, 777, 123_456)).toEqual(treeSvg(SPECIES.birch, 777, 123_456));
	});

	it("differs across seeds — same tree, different silhouette", () => {
		const trees = Array.from({ length: 6 }, (_, i) => full(SPECIES.oak, i + 1));
		expect(new Set(trees).size).toBe(6);
	});

	it("differs across species", () => {
		expect(full(SPECIES.oak, 5)).not.toEqual(full(SPECIES.redwood, 5));
	});
});

describe("treeSvg growth", () => {
	it("draws more branches the closer the tree is to full growth", () => {
		const lines = (svg: string) => (svg.match(/<line/g) ?? []).length;
		const young = lines(treeSvg(SPECIES.oak, 42, 100_000));
		const mature = lines(treeSvg(SPECIES.oak, 42, 3_000_000));
		const fullGrown = lines(full(SPECIES.oak, 42));
		expect(mature).toBeGreaterThan(young);
		expect(fullGrown).toBeGreaterThan(mature);
	});

	it("draws a sprout for a freshly planted seed", () => {
		const svg = treeSvg(SPECIES.oak, 42, 0);
		expect(svg).toMatch(/<circle/); // seed or leaf dot — definitely not an empty frame
		expect((svg.match(/<line/g) ?? []).length).toBeLessThanOrEqual(2);
	});

	it("clamps tokens above the species cost", () => {
		expect(treeSvg(SPECIES.bonsai, 42, 999_999_999)).toEqual(full(SPECIES.bonsai, 42));
	});
});

describe("treeSvg species styling", () => {
	it("uses the species trunk color", () => {
		expect(full(SPECIES.redwood, 3)).toContain(SPECIES.redwood.palette.trunk);
		expect(full(SPECIES.birch, 3)).toContain(SPECIES.birch.palette.trunk);
	});

	it("gives cherry its blossom accent", () => {
		expect(full(SPECIES.cherry, 3)).toContain(SPECIES.cherry.palette.accent ?? "");
	});

	it("renders the active glow only when requested", () => {
		expect(full(SPECIES.oak, 3)).not.toContain("glow");
		expect(treeSvg(SPECIES.oak, 3, SPECIES.oak.costTokens, { active: true })).toContain("glow");
	});

	it("renders a custom palette's colors", () => {
		const custom: TreeSpecies = {
			...SPECIES.custom,
			costTokens: 10_000,
			palette: { trunk: "#123456", canopy: ["#654321"], accent: "#abcdef" },
		};
		const svg = full(custom, 9);
		expect(svg).toContain("#123456");
		expect(svg).toContain("#654321");
	});
});

describe("soilSvg", () => {
	it("is distinct from a planted tree at zero tokens", () => {
		expect(soilSvg()).not.toEqual(treeSvg(SPECIES.oak, 42, 0));
	});

	it("keeps the standard frame shell", () => {
		const svg = soilSvg();
		expect(svg).toContain('width="144"');
		expect(svg).toContain('fill="#141414"');
	});
});

describe("tokenBadgeFrames", () => {
	it("builds a fading sequence that starts badged and ends plain", () => {
		const frames = tokenBadgeFrames(SPECIES.bonsai, 42, 12_345);
		expect(frames).toHaveLength(9);
		expect(frames[0]).toContain("12k");
		expect(frames[8]).not.toContain("12k");
		// Every frame is a full image on its own.
		for (const frame of frames) {
			expect(frame).toMatch(/^<svg/);
			expect(frame).toMatch(/<\/svg>$/);
		}
	});

	it("paints the badge after the background so the dark rect does not cover it", () => {
		const badgeAt = tokenBadgeFrames(SPECIES.bonsai, 42, 12_345)[0].indexOf("12k");
		const backgroundAt = tokenBadgeFrames(SPECIES.bonsai, 42, 12_345)[0].indexOf("#141414");
		expect(badgeAt).toBeGreaterThan(backgroundAt);
	});

	it("centers the text in the pill by explicit baseline, not font metrics", () => {
		const frame = tokenBadgeFrames(SPECIES.bonsai, 42, 12_345)[0];
		expect(frame).toContain('dominant-baseline="central"');
		expect(frame).toMatch(/y="20" font-family/);
	});

	it("is deterministic for the same inputs", () => {
		expect(tokenBadgeFrames(SPECIES.bonsai, 42, 12_345)).toEqual(tokenBadgeFrames(SPECIES.bonsai, 42, 12_345));
	});
});