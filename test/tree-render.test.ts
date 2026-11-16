import { describe, expect, it } from "vitest";

import { SPECIES, type TreeSpecies } from "../src/actions/grove-core";
import { leafBlowForce, mixHex, soilSvg, swayPx, tokenBadgeFrames, treeSvg, windPhaseFor, windPhase, windSteps } from "../src/actions/tree-render";

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
		const young = lines(treeSvg(SPECIES.oak, 42, 1_000_000));
		const mature = lines(treeSvg(SPECIES.oak, 42, 100_000_000));
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

describe("treeSvg wind", () => {
	it("is byte-identical when the wind is still", () => {
		const still = treeSvg(SPECIES.oak, 42, SPECIES.oak.costTokens);
		expect(treeSvg(SPECIES.oak, 42, SPECIES.oak.costTokens, { wind: { force: 0, phase: 2.2 } })).toEqual(still);
	});

	it("renders the same bytes for the same phase twice", () => {
		const left = treeSvg(SPECIES.oak, 42, SPECIES.oak.costTokens, { wind: { force: 0.8, phase: 1.1 } });
		expect(treeSvg(SPECIES.oak, 42, SPECIES.oak.costTokens, { wind: { force: 0.8, phase: 1.1 } })).toEqual(left);
	});

	it("sways downwind on both sides across phases", () => {
		const still = crownExtent(full(SPECIES.oak, 42));
		const right = crownExtent(treeSvg(SPECIES.oak, 42, SPECIES.oak.costTokens, { wind: { force: 1, phase: 1.57 } }));
		const left = crownExtent(treeSvg(SPECIES.oak, 42, SPECIES.oak.costTokens, { wind: { force: 1, phase: 4.71 } }));
		expect(right.x1, "right gust pushes the crown past its still reach").toBeGreaterThan(still.x1);
		expect(left.x0, "left gust pulls the crown past its still reach").toBeLessThan(still.x0);
	});

	it("keeps the trunk base planted at full force", () => {
		const base = (svg: string) => svg.match(/x1="72\.00" y1="138\.00"/)?.[0];
		const still = base(full(SPECIES.oak, 42));
		expect(base(treeSvg(SPECIES.oak, 42, SPECIES.oak.costTokens, { wind: { force: 1, phase: 1.57 } }))).toEqual(still);
		expect(still).toBeDefined();
	});

	it("scales the lean with force", () => {
		const at = (force: number) => crownExtent(treeSvg(SPECIES.oak, 42, SPECIES.oak.costTokens, { wind: { force, phase: 1.57 } }));
		const soft = at(0.25);
		const strong = at(1);
		const still = at(0);
		expect(Math.abs(strong.x1 - still.x1)).toBeGreaterThan(Math.abs(soft.x1 - still.x1));
		expect(soft.x1).toBeGreaterThan(still.x1);
	});

	it("never clips the frame at full force, any species, any seed", () => {
		for (const species of [SPECIES.bonsai, SPECIES.cherry, SPECIES.birch, SPECIES.oak, SPECIES.redwood]) {
			for (let seed = 1; seed <= 12; seed++) {
				const svg = treeSvg(species, seed, species.costTokens, { wind: { force: 1, phase: 1.57 } });
				const reach = xReach(svg);
				expect(reach.max, `${species.id} seed ${seed} blown out the right`).toBeLessThanOrEqual(144);
				expect(reach.min, `${species.id} seed ${seed} blown out the left`).toBeGreaterThanOrEqual(0);
			}
		}
	});

	it("sways the sprout too", () => {
		const still = treeSvg(SPECIES.oak, 42, 0);
		const gusty = treeSvg(SPECIES.oak, 42, 0, { wind: { force: 1, phase: 1.57 } });
		expect(gusty).not.toEqual(still);
		// The stem's base always stays planted; only its top leans.
		expect(still).toMatch(/<line x1="72" y1="138"/);
		expect(gusty).toMatch(/<line x1="72" y1="138"/);
		expect(gusty).not.toMatch(/<line x1="72" y1="138" x2="72"/);
	});
});

describe("treeSvg blown leaves", () => {
	const leaves = (progress: number, gust = 0) => ({ progress, gust });
	const withLeaves = (species: TreeSpecies, seed: number, progress: number, force = 1, gust = 0) =>
		treeSvg(species, seed, species.costTokens, { wind: { force, phase: 1.57 }, leaves: leaves(progress, gust) });
	/** Count of in-flight leaf circles. */
	const flyingCount = (svg: string): number => (svg.match(/fill-opacity="/g) ?? []).length;

	it(`only sheds leaves at ${leafBlowForce} force (slider 50 of 100)`, () => {
		const below = withLeaves(SPECIES.oak, 42, 0.3, leafBlowForce - 0.05);
		const at = withLeaves(SPECIES.oak, 42, 0.3, leafBlowForce);
		const plain = treeSvg(SPECIES.oak, 42, SPECIES.oak.costTokens, { wind: { force: leafBlowForce - 0.05, phase: 1.57 } });
		expect(below).toEqual(plain);
		expect(at).not.toEqual(below);
	});

	/** Positions of the in-flight leaf circles: cx, cy, r, opacity. */
	const flying = (svg: string): { x: number; y: number; r: number; o: number }[] =>
		[...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" fill="#[^"]+" fill-opacity="([\d.]+)"/g)]
			.map((m) => ({ x: Number(m[1]), y: Number(m[2]), r: Number(m[3]), o: Number(m[4]) }));

	it("adds fading leaves in flight, up to four", () => {
		const plain = treeSvg(SPECIES.oak, 42, SPECIES.oak.costTokens, { wind: { force: 1, phase: 1.57 } });
		const blowy = withLeaves(SPECIES.oak, 42, 0.25);
		expect(blowy).not.toEqual(plain);
		const extras = (blowy.match(/fill-opacity="[\d.]+"/g) ?? []).length;
		expect(extras).toBeGreaterThanOrEqual(1);
		expect(extras).toBeLessThanOrEqual(4);
	});

	it("drives the leaves downwind and toward the ground as progress grows", () => {
		const early = flying(withLeaves(SPECIES.oak, 42, 0.15));
		const late = flying(withLeaves(SPECIES.oak, 42, 0.85));
		expect(Math.max(...late.map((l) => l.x))).toBeGreaterThan(Math.max(...early.map((l) => l.x)));
		expect(Math.max(...late.map((l) => l.y))).toBeGreaterThan(Math.max(...early.map((l) => l.y)));
	});

	it("sheds a different number of leaves from gust to gust", () => {
		// Mid-cycle every shed leaf is in flight, so the frame count is the gust count.
		const counts = [0, 1, 2, 3, 4, 5].map((gust) => flyingCount(withLeaves(SPECIES.oak, 42, 0.5, 1, gust)));
		expect(counts.every((c) => c >= 1 && c <= 4)).toBe(true);
		expect(new Set(counts).size).toBeGreaterThan(1);
	});

	it("keeps blown leaves chunky and unfaded the whole trip", () => {
		const flyingLeaves = flying(withLeaves(SPECIES.oak, 42, 0.3, 1));
		expect(flyingLeaves.length).toBeGreaterThanOrEqual(1);
		for (const leaf of flyingLeaves) {
			expect(leaf.r, "leaf dot too small to see").toBeGreaterThanOrEqual(4);
			expect(leaf.o, "leaf faded mid-flight — the edge should do the vanishing").toBe(1);
		}
	});

	it("carries every leaf out of the frame by the last tick of the cycle", () => {
		// Ticks land on n/24; the worst case is the most staggered leaf on the
		// final tick. Its travel must already be past the frame edge.
		const lastTick = 23 / 24;
		expect(Math.min(...flying(withLeaves(SPECIES.oak, 42, lastTick, 1)).map((l) => l.x))).toBeGreaterThan(144);
	});

	it("hard wind throws them sideways, light wind lets them drop", () => {
		const soft = Math.max(...flying(withLeaves(SPECIES.oak, 42, 0.5, 1)).map((l) => l.x - l.y));
		const hard = Math.max(...flying(withLeaves(SPECIES.oak, 42, 0.5, 2)).map((l) => l.x - l.y));
		expect(hard).toBeGreaterThan(soft);
	});

	it("sheds the same leaves for the same progress", () => {
		expect(withLeaves(SPECIES.oak, 42, 0.25)).toEqual(withLeaves(SPECIES.oak, 42, 0.25));
	});

	it("spares the sprout — nothing to blow off", () => {
		const gustySprout = treeSvg(SPECIES.oak, 42, 0, { wind: { force: 2, phase: 1.57 }, leaves: leaves(0.25) });
		expect(gustySprout).toEqual(treeSvg(SPECIES.oak, 42, 0, { wind: { force: 2, phase: 1.57 } }));
	});

	it("lets still air keep the leaves on the tree", () => {
		const still = treeSvg(SPECIES.oak, 42, SPECIES.oak.costTokens);
		expect(treeSvg(SPECIES.oak, 42, SPECIES.oak.costTokens, { wind: { force: 0, phase: 1 }, leaves: leaves(0.25) })).toEqual(still);
	});
});

describe("swayPx", () => {
	const wind = { force: 1, phase: 1.57 };

	it("returns zero in still air and at the ground line", () => {
		expect(swayPx(60, { force: 0, phase: 1.57 })).toBe(0);
		expect(swayPx(138, wind)).toBe(0);
	});

	it("is bounded by force * windMaxLean and grows with height", () => {
		expect(Math.abs(swayPx(20, wind))).toBeLessThanOrEqual(5);
		expect(Math.abs(swayPx(20, wind))).toBeGreaterThan(Math.abs(swayPx(90, wind)));
		expect(swayPx(20, wind)).toBeGreaterThan(0);
	});

	it("leans twice as far at gale force 2", () => {
		expect(Math.abs(swayPx(20, { force: 2, phase: 1.57 }))).toBeGreaterThan(Math.abs(swayPx(20, { force: 1, phase: 1.57 })));
	});

	it("cycles through windSteps discrete phases", () => {
		expect(windSteps).toBe(24);
		expect(windPhase(0)).toBe(0);
		expect(windPhase(windSteps)).toBe(0);
		expect(windPhase(6)).toBeCloseTo(Math.PI / 2, 5);
	});
});

describe("windPhaseFor", () => {
	it("offsets each tree by its seed", () => {
		expect(windPhaseFor(1, 5)).toBe(windPhase(6));
		expect(windPhaseFor(31, 0)).toBe(windPhase(31 % windSteps));
	});

	it("puts different trees in different spots of the cycle", () => {
		const spots = new Set([3, 7, 11, 17, 23].map((seed) => windPhaseFor(seed, 0)));
		expect(spots.size).toBe(5);
		// And one tree holds its own spot forever.
		expect(windPhaseFor(7, 0)).toBe(windPhaseFor(7, windSteps));
	});
});

describe("treeSvg structure memo", () => {
	it("gives two same-seed customs with different palettes their own colors", () => {
		const a: TreeSpecies = { ...SPECIES.custom, costTokens: 10_000, palette: { trunk: "#123456", canopy: ["#654321"] } };
		const b: TreeSpecies = { ...SPECIES.custom, costTokens: 10_000, palette: { trunk: "#f0e0d0", canopy: ["#654321"] } };
		const svgA = full(a, 9); // warms the memo with a's palette
		const svgB = full(b, 9);
		expect(svgA).toContain("#123456");
		expect(svgB).toContain("#f0e0d0");
		expect(svgB).not.toContain("#123456");
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

	it("paints the badge over the background, in white on the dark pill", () => {
		const frame = tokenBadgeFrames(SPECIES.bonsai, 42, 12_345)[0];
		expect(frame.indexOf("12k")).toBeGreaterThan(frame.indexOf("#141414"));
		expect(frame).toContain('fill="#ffffff"');
	});

	it("centers the text in the pill by explicit baseline, not font metrics", () => {
		const frame = tokenBadgeFrames(SPECIES.bonsai, 42, 12_345)[0];
		expect(frame).toContain('dominant-baseline="central"');
		// Pill y=7, height=27 → its center is 20.5.
		expect(frame).toMatch(/y="20\.5" font-family/);
	});

	it("is deterministic for the same inputs", () => {
		expect(tokenBadgeFrames(SPECIES.bonsai, 42, 12_345)).toEqual(tokenBadgeFrames(SPECIES.bonsai, 42, 12_345));
	});
});