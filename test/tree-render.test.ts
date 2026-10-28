import { describe, expect, it } from "vitest";

import { SPECIES, type TreeSpecies } from "../src/actions/grove-core";
import { mixHex, soilSvg, tokenBadgeFrames, treeSvg } from "../src/actions/tree-render";

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

/** Foliar extent: bounding box of crown circles only (lines excluded — twigs droop past the mass). */
function crownExtent(svg: string): { x0: number; x1: number; y0: number; y1: number } {
	const ms = [...svg.matchAll(/<circle [^>]*cx="(-?[\d.]+)"[^>]*cy="(-?[\d.]+)"[^>]*r="([\d.]+)"/g)];
	const lefts = ms.map((m) => Number(m[1]) - Number(m[3]));
	const rights = ms.map((m) => Number(m[1]) + Number(m[3]));
	const tops = ms.map((m) => Number(m[2]) - Number(m[3]));
	const bottoms = ms.map((m) => Number(m[2]) + Number(m[3]));
	return { x0: Math.min(...lefts), x1: Math.max(...rights), y0: Math.min(...tops), y1: Math.max(...bottoms) };
}

describe("treeSvg per-species crowns", () => {
	// The five predefined species over seeds 1..12: every crown assertion below
	// consumes this one shared matrix of full-grown renders.
	const crowns = new Map<string, { svg: string; extent: ReturnType<typeof crownExtent> }>();
	const crown = (species: TreeSpecies, seed: number) => {
		const key = `${species.id}/${seed}`;
		if (!crowns.has(key)) {
			const svg = full(species, seed);
			crowns.set(key, { svg, extent: crownExtent(svg) });
		}
		return crowns.get(key) as { svg: string; extent: ReturnType<typeof crownExtent> };
	};
	for (const species of [SPECIES.bonsai, SPECIES.cherry, SPECIES.birch, SPECIES.oak, SPECIES.redwood]) {
		it(`fits a full-grown ${species.id} in the frame across seeds 1-12`, () => {
			for (let seed = 1; seed <= 12; seed++) {
				const { svg } = crown(species, seed);
				expect(topmostY(svg), `${species.id} seed ${seed} pokes above y=9`).toBeGreaterThanOrEqual(8.9);
				const reach = xReach(svg);
				expect(reach.min, `${species.id} seed ${seed} pokes left`).toBeGreaterThanOrEqual(4.9);
				expect(reach.max, `${species.id} seed ${seed} pokes right`).toBeLessThanOrEqual(139.1);
				const bottoms = [...svg.matchAll(/<circle [^>]*cy="(-?[\d.]+)"[^>]*r="([\d.]+)"/g)].map((m) => Number(m[1]) + Number(m[2]));
				expect(Math.max(...bottoms), `${species.id} seed ${seed} crown stops above the midline`).toBeGreaterThanOrEqual(70);
			}
		});

		it(`shapes the ${species.id} crown to its character`, () => {
			const floors: Record<string, { width: number; aspect: "wide" | "tall" | "any" }> = {
				bonsai: { width: 62, aspect: "wide" },
				oak: { width: 88, aspect: "wide" },
				cherry: { width: 55, aspect: "any" },
				birch: { width: 44, aspect: "tall" },
				redwood: { width: 55, aspect: "tall" },
			};
			const { width, aspect } = floors[species.id];
			let tested = 0;
			for (const seed of [1, 7, 42, 777]) {
				const { extent } = crown(species, seed);
				const w = extent.x1 - extent.x0;
				const h = extent.y1 - extent.y0;
				expect(w, `${species.id} seed ${seed} crown too narrow`).toBeGreaterThanOrEqual(width);
				if (aspect === "wide") {
					expect(w, `${species.id} seed ${seed} crown should be wider than tall`).toBeGreaterThan(h);
				}
				if (aspect === "tall") {
					expect(h, `${species.id} seed ${seed} crown should be taller than wide`).toBeGreaterThan(w);
				}
				if (species.id === "cherry") {
					const fills = new Set([...crown(species, seed).svg.matchAll(/<circle [^>]*fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]));
					expect(fills.size, `seed ${seed} mass + shade + light + accent should use distinct tones`).toBeGreaterThanOrEqual(3);
				}
				tested++;
			}
			expect(tested).toBe(4);
		});
	}

	it("grows the birch with hanging twigs below the crown", () => {
		const svg = crown(SPECIES.birch, 7).svg;
		const tags = [...svg.matchAll(/<line [^>]+>/g)].map((m) => m[0]);
		const twigs = tags.filter((tag) => {
			const y1 = Number(tag.match(/y1="(-?[\d.]+)"/)?.[1] ?? 0);
			const y2 = Number(tag.match(/y2="(-?[\d.]+)"/)?.[1] ?? 0);
			const width = Number(tag.match(/stroke-width="([\d.]+)"/)?.[1] ?? 99);
			return y2 > y1 && width <= 1.4;
		});
		expect(twigs.length, "expected drooping twig strokes").toBeGreaterThanOrEqual(3);
	});

	it("still uses most of the key height — fitting is not shrinking to a bonsai pot", () => {
		expect(topmostY(full(SPECIES.redwood, 5))).toBeLessThan(40);
	});
});

describe("mixHex", () => {
	it("stays at the endpoints when t is 0 or 1", () => {
		expect(mixHex("#ffffff", "#000000", 0)).toBe("#ffffff");
		expect(mixHex("#ffffff", "#000000", 1)).toBe("#000000");
	});

	it("blends midpoint channels", () => {
		expect(mixHex("#ffffff", "#000000", 0.5)).toBe("#808080");
		expect(mixHex("#e58fb1", "#000000", 0.35)).toMatch(/^#[0-9a-f]{6}$/);
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

	it("prints the token total in white over the dark pill", () => {
		expect(tokenBadgeFrames(SPECIES.bonsai, 42, 12_345)[0]).toContain('fill="#ffffff"');
	});
});