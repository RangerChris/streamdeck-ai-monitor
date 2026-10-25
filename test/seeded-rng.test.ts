import { describe, expect, it } from "vitest";
import { mulberry32, randomPick } from "../src/actions/seeded-rng";

describe("mulberry32", () => {
	it("is deterministic for the same seed", () => {
		const a = mulberry32(12345);
		const b = mulberry32(12345);
		const seqA = Array.from({ length: 10 }, () => a());
		const seqB = Array.from({ length: 10 }, () => b());
		expect(seqA).toEqual(seqB);
	});

	it("produces different sequences for different seeds", () => {
		const a = Array.from({ length: 10 }, () => mulberry32(1)());
		const b = Array.from({ length: 10 }, () => mulberry32(2)());
		expect(a).not.toEqual(b);
	});

	it("stays within [0, 1) across many draws", () => {
		const rng = mulberry32(999);
		for (let i = 0; i < 10_000; i++) {
			const value = rng();
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThan(1);
		}
	});

	it("does not collapse to one side of the range", () => {
		const rng = mulberry32(7);
		let low = 0;
		const n = 10_000;
		for (let i = 0; i < n; i++) {
			if (rng() < 0.5) low++;
		}
		expect(low / n).toBeGreaterThan(0.45);
		expect(low / n).toBeLessThan(0.55);
	});
});

describe("randomPick", () => {
	it("returns undefined for an empty list", () => {
		expect(randomPick(mulberry32(1), [])).toBeUndefined();
	});

	it("picks only from the given items", () => {
		const items = ["a", "b", "c"] as const;
		const rng = mulberry32(42);
		for (let i = 0; i < 100; i++) {
			expect(items).toContain(randomPick(rng, items));
		}
	});

	it("is deterministic for the same seed", () => {
		expect(randomPick(mulberry32(5), ["x", "y", "z"])).toEqual(randomPick(mulberry32(5), ["x", "y", "z"]));
	});
});