import { describe, expect, it } from "vitest";
import { mulberry32 } from "../src/actions/seeded-rng";
import {
	applyTokenBatch,
	claudeTokensDelta,
	growthFraction,
	groveFromGlobalSettings,
	pickRecipient,
	resetTree,
	syncKeyTree,
	customPalette,
	plantTree,
	removeTree,
	resolveSpecies,
	SPECIES,
	type GroveState,
} from "../src/actions/grove-core";

const now = 1_761_000_000_000;

function stateWith(...entries: Array<[string, { species: GroveState["trees"][string]["species"]; tokens: number }]>): GroveState {
	const trees: GroveState["trees"] = {};
	for (const [id, tree] of entries) {
		trees[id] = { species: tree.species, seed: 1, tokens: tree.tokens, plantedAt: now };
	}
	return { trees };
}

describe("SPECIES catalog", () => {
	it("has week-scale costs — a session burns ~250k, a Pro week allows ~24M", () => {
		expect(SPECIES.bonsai.costTokens).toBe(1_000_000);
		expect(SPECIES.cherry.costTokens).toBe(5_000_000);
		expect(SPECIES.birch.costTokens).toBe(10_000_000);
		expect(SPECIES.oak.costTokens).toBe(20_000_000);
		expect(SPECIES.redwood.costTokens).toBe(25_000_000);
	});

	it("has a custom profile with a sensible default cost", () => {
		expect(SPECIES.custom.costTokens).toBe(200_000);
	});
});

describe("growthFraction", () => {
	it("is 0 for a fresh seed and clamps at 1 when full grown", () => {
		expect(growthFraction({ species: "bonsai", seed: 1, tokens: 0, plantedAt: now })).toBe(0);
		expect(growthFraction({ species: "bonsai", seed: 1, tokens: 500_000, plantedAt: now })).toBe(0.5);
		expect(growthFraction({ species: "bonsai", seed: 1, tokens: 1_000_000, plantedAt: now })).toBe(1);
		expect(growthFraction({ species: "bonsai", seed: 1, tokens: 2_000_000, plantedAt: now })).toBe(1);
	});

	it("uses the custom palette's cost", () => {
		const tree = { species: "custom" as const, seed: 1, tokens: 5_000, plantedAt: now, custom: { trunk: "#4a3728", canopy: "#5a9e4f", costTokens: 10_000 } };
		expect(growthFraction(tree)).toBe(0.5);
	});
});

describe("claudeTokensDelta", () => {
	it("returns zero delta with no baseline on the first poll", () => {
		const result = claudeTokensDelta(undefined, 10_000, new Date(2026, 9, 25, 14, 0));
		expect(result.delta).toBe(0);
		expect(result.feed).toEqual({ date: "2026-10-25", tokens: 10_000 });
	});

	it("counts growth since the last poll on the same day", () => {
		const first = claudeTokensDelta(undefined, 10_000, new Date(2026, 9, 25, 14, 0));
		const second = claudeTokensDelta(first.feed, 15_000, new Date(2026, 9, 25, 15, 0));
		expect(second.delta).toBe(5_000);
	});

	it("counts all of today's tokens after local midnight rollover", () => {
		const yesterday = claudeTokensDelta(undefined, 90_000, new Date(2026, 9, 24, 23, 55));
		const morning = claudeTokensDelta(yesterday.feed, 2_000, new Date(2026, 9, 25, 0, 5));
		expect(morning.delta).toBe(2_000);
	});

	it("clamps a shrinking today-total to zero", () => {
		const first = claudeTokensDelta(undefined, 10_000, new Date(2026, 9, 25, 14, 0));
		expect(claudeTokensDelta(first.feed, 8_000, new Date(2026, 9, 25, 15, 0)).delta).toBe(0);
	});
});

describe("pickRecipient", () => {
	it("prefers the active tree when it is not maxed", () => {
		const state = { ...stateWith(["a", { species: "bonsai", tokens: 0 }], ["b", { species: "oak", tokens: 0 }]), activeTreeId: "b" };
		expect(pickRecipient(state, mulberry32(1))).toBe("b");
	});

	it("falls through to a random non-maxed tree when the active one is full", () => {
		const state = { ...stateWith(["a", { species: "bonsai", tokens: 1_000_000 }], ["b", { species: "oak", tokens: 0 }]), activeTreeId: "a" };
		expect(pickRecipient(state, mulberry32(1))).toBe("b");
	});

	it("returns undefined when every tree is maxed", () => {
		const state = stateWith(["a", { species: "bonsai", tokens: 1_000_000 }]);
		expect(pickRecipient(state, mulberry32(1))).toBeUndefined();
	});

	it("returns undefined for an empty grove", () => {
		expect(pickRecipient({ trees: {} }, mulberry32(1))).toBeUndefined();
	});
});

describe("applyTokenBatch", () => {
	it("routes the whole batch to the active tree", () => {
		const state = { ...stateWith(["a", { species: "bonsai", tokens: 0 }], ["b", { species: "oak", tokens: 0 }]), activeTreeId: "a" };
		const result = applyTokenBatch(state, 1_000, mulberry32(1));
		expect(result.state.trees["a"]?.tokens).toBe(1_000);
		expect(result.state.trees["b"]?.tokens).toBe(0);
		expect(result.changedTreeIds).toEqual(["a"]);
	});

	it("routes to a random non-maxed tree when no tree is active", () => {
		const state = stateWith(["a", { species: "bonsai", tokens: 0 }], ["b", { species: "oak", tokens: 0 }]);
		const result = applyTokenBatch(state, 1_000, mulberry32(1));
		const fed = result.changedTreeIds[0];
		expect(result.state.trees[fed]?.tokens).toBe(1_000);
		expect(result.changedTreeIds).toHaveLength(1);
	});

	it("clamps a tree at its species cost and discards the excess", () => {
		const state = stateWith(["a", { species: "bonsai", tokens: 999_500 }]);
		const result = applyTokenBatch(state, 10_000, mulberry32(1));
		expect(result.state.trees["a"]?.tokens).toBe(1_000_000);
	});

	it("discards the batch when every tree is maxed", () => {
		const state = stateWith(["a", { species: "bonsai", tokens: 1_000_000 }]);
		const result = applyTokenBatch(state, 10_000, mulberry32(1));
		expect(result.state).toEqual(state);
		expect(result.changedTreeIds).toEqual([]);
	});

	it("ignores zero and negative batches", () => {
		const state = stateWith(["a", { species: "bonsai", tokens: 100 }]);
		expect(applyTokenBatch(state, 0, mulberry32(1)).state).toEqual(state);
	});
});

describe("plantTree / removeTree", () => {
	it("plants a tree with a fresh seed and zero tokens", () => {
		const state = plantTree({ trees: {} }, "a", "oak", now, mulberry32(42));
		const tree = state.trees["a"];
		expect(tree).toMatchObject({ species: "oak", tokens: 0, plantedAt: now });
		expect(tree?.seed).toBeGreaterThan(0);
		expect(tree?.seed).toBeLessThanOrEqual(0xffffffff);
	});

	it("is deterministic for the same rng seed", () => {
		expect(plantTree({ trees: {} }, "a", "oak", now, mulberry32(7)).trees["a"]?.seed)
			.toBe(plantTree({ trees: {} }, "a", "oak", now, mulberry32(7)).trees["a"]?.seed);
	});

	it("replants (fresh seed, tokens reset) when a tree exists", () => {
		let state = plantTree({ trees: {} }, "a", "oak", now, mulberry32(1));
		state = { ...state, trees: { ...state.trees, a: { ...state.trees["a"]!, tokens: 123_456 } } };
		state = plantTree(state, "a", "cherry", now, mulberry32(2));
		expect(state.trees["a"]).toMatchObject({ species: "cherry", tokens: 0 });
	});

	it("carries a custom palette when planting a custom tree", () => {
		const custom = { trunk: "#4a3728", canopy: "#5a9e4f", accent: "#ff8fb1", costTokens: 250_000 };
		const state = plantTree({ trees: {} }, "a", "custom", now, mulberry32(1), custom);
		expect(state.trees["a"]?.custom).toEqual(custom);
	});

	it("removes a tree and clears a dangling activeTreeId", () => {
		let state = plantTree({ trees: {} }, "a", "oak", now, mulberry32(1));
		state = { ...state, activeTreeId: "a" };
		state = removeTree(state, "a");
		expect(state.trees).toEqual({});
		expect(state.activeTreeId).toBeUndefined();
	});
});

describe("resolveSpecies", () => {
	it("returns the predefined profile", () => {
		expect(resolveSpecies({ species: "oak", seed: 1, tokens: 0, plantedAt: now })).toBe(SPECIES.oak);
	});

	it("merges the custom palette over the custom profile", () => {
		const tree = { species: "custom" as const, seed: 1, tokens: 0, plantedAt: now, custom: { trunk: "#4a3728", canopy: "#5a9e4f", costTokens: 777_000 } };
		const resolved = resolveSpecies(tree);
		expect(resolved.costTokens).toBe(777_000);
		expect(resolved.palette.trunk).toBe("#4a3728");
	});
});

describe("syncKeyTree", () => {
	it("plants a tree when the button has none", () => {
		const result = syncKeyTree({ trees: {} }, "a", "oak", now, mulberry32(1));
		expect(result.changed).toBe(true);
		expect(result.state.trees["a"]).toMatchObject({ species: "oak", tokens: 0 });
	});

	it("leaves the tree alone when the species already matches", () => {
		const state = stateWith(["a", { species: "oak", tokens: 123_456 }]);
		const result = syncKeyTree(state, "a", "oak", now, mulberry32(1));
		expect(result.changed).toBe(false);
		expect(result.state.trees["a"]?.tokens).toBe(123_456);
	});

	it("replants (fresh seed, tokens reset) when the species changes", () => {
		const state = stateWith(["a", { species: "oak", tokens: 123_456 }]);
		const result = syncKeyTree(state, "a", "bonsai", now, mulberry32(2));
		expect(result.changed).toBe(true);
		expect(result.state.trees["a"]).toMatchObject({ species: "bonsai", tokens: 0 });
	});

	it("removes the tree when the selection clears", () => {
		const state = stateWith(["a", { species: "oak", tokens: 123_456 }]);
		const cleared = syncKeyTree(state, "a", undefined, now, mulberry32(1));
		expect(cleared.changed).toBe(true);
		expect(cleared.state.trees).toEqual({});
		// Nothing planted, nothing to do.
		const idle = syncKeyTree({ trees: {} }, "a", undefined, now, mulberry32(1));
		expect(idle.changed).toBe(false);
	});

	it("removes the tree when the species name is garbage", () => {
		const state = stateWith(["a", { species: "oak", tokens: 123_456 }]);
		const result = syncKeyTree(state, "a", "palm", now, mulberry32(1));
		expect(result.changed).toBe(true);
		expect(result.state.trees).toEqual({});
	});

	it("replants a custom tree with the inspector palette and cost", () => {
		const custom = { trunk: "#4a3728", canopy: "#5a9e4f", costTokens: 250_000 };
		const result = syncKeyTree({ trees: {} }, "a", "custom", now, mulberry32(1), custom);
		expect(result.changed).toBe(true);
		expect(result.state.trees["a"]?.custom).toEqual(custom);
	});

	it("updates palette and cost of a planted custom tree without resetting tokens", () => {
		let state = plantTree(stateWith(["b", { species: "oak", tokens: 0 }]), "a", "custom", now, mulberry32(1), {
			trunk: "#4a3728",
			canopy: "#5a9e4f",
			costTokens: 250_000,
		});
		state = { ...state, trees: { ...state.trees, a: { ...state.trees["a"]!, tokens: 50_000 } } };
		const result = syncKeyTree(state, "a", "custom", now, mulberry32(1), { trunk: "#8b5a2b", canopy: "#c9a227", costTokens: 100_000 });
		expect(result.changed).toBe(true);
		expect(result.state.trees["a"]).toMatchObject({ tokens: 50_000 });
		expect(result.state.trees["a"]?.custom).toEqual({ trunk: "#8b5a2b", canopy: "#c9a227", costTokens: 100_000 });
	});
});

describe("resetTree", () => {
	it("regrow keeps the tree's shape and zeroes the tokens", () => {
		const state = { ...stateWith(["a", { species: "oak", tokens: 3_000_000 }]), activeTreeId: "a" };
		const result = resetTree(state, "a", "regrow", now, mulberry32(9));
		expect(result.changed).toBe(true);
		const tree = result.state.trees["a"];
		expect(tree.tokens).toBe(0);
		expect(tree.seed).toBe(1); // same shape
		expect(tree.plantedAt).toBe(now);
		expect(result.state.activeTreeId).toBe("a");
	});

	it("replant starts a new shape from zero", () => {
		const state = stateWith(["a", { species: "oak", tokens: 3_000_000 }]);
		const result = resetTree(state, "a", "replant", now + 5, mulberry32(2));
		const tree = result.state.trees["a"];
		expect(tree.tokens).toBe(0);
		expect(tree.seed).not.toBe(1);
		expect(tree.plantedAt).toBe(now + 5);
	});

	it("replant keeps a custom tree's palette and cost", () => {
		const custom = { trunk: "#8b5a2b", canopy: "#c9a227", costTokens: 100_000 };
		const state = { trees: { a: { species: "custom" as const, seed: 1, tokens: 50_000, plantedAt: now, custom } } };
		const result = resetTree(state, "a", "replant", now, mulberry32(2));
		expect(result.state.trees["a"].custom).toEqual(custom);
	});

	it("does nothing on an unplanted key", () => {
		const state = stateWith(["b", { species: "oak", tokens: 100 }]);
		const result = resetTree(state, "a", "regrow", now, mulberry32(1));
		expect(result.changed).toBe(false);
		expect(result.state).toEqual(state);
	});
});

describe("customPalette", () => {
	it("accepts small custom costs — a 50-token tree is a valid custom tree", () => {
		const custom = customPalette({ customTrunk: "#8b5a2b", customCanopy: "#c9a227", customCost: "50" });
		expect(custom.costTokens).toBe(50);
	});

	it("falls back to the custom default cost for tiny or garbage values", () => {
		expect(customPalette({ customCost: "0" }).costTokens).toBe(200_000);
		expect(customPalette({ customCost: "banana" }).costTokens).toBe(200_000);
	});

	it("keeps the accent only when it is a real hex color", () => {
		expect(customPalette({ customAccent: "#ffd9e8" }).accent).toBe("#ffd9e8");
		expect(customPalette({ customAccent: "pink?" }).accent).toBeUndefined();
	});
});

describe("groveFromGlobalSettings", () => {
	it("accepts an empty or missing grove key", () => {
		expect(groveFromGlobalSettings(undefined)).toEqual({ trees: {} });
		expect(groveFromGlobalSettings({})).toEqual({ trees: {} });
		expect(groveFromGlobalSettings({ grove: {} })).toEqual({ trees: {} });
	});

	it("loads trees and active tree id", () => {
		const settings = {
			grove: {
				trees: { a: { species: "oak", seed: 5, tokens: 100, plantedAt: now } },
				activeTreeId: "a",
			},
		};
		const state = groveFromGlobalSettings(settings);
		expect(state.activeTreeId).toBe("a");
		expect(state.trees["a"]?.tokens).toBe(100);
	});

	it("drops garbage entries instead of throwing", () => {
		const state = groveFromGlobalSettings({ grove: { trees: { a: { nonsense: true } }, activeTreeId: "zzz" } });
		expect(state.trees).toEqual({});
	});
});