/**
 * mulberry32 — a tiny 32-bit seeded PRNG. No dependencies so every tree's
 * shape stays reproducible from its seed alone.
 * @param seed The 32-bit seed.
 * @returns A function producing deterministic floats in [0, 1).
 */
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Uniform random pick from a list.
 * @param rng Seeded RNG to keep choices testable.
 * @param items Items to pick from.
 * @returns One of the items, or undefined when the list is empty.
 */
export function randomPick<T>(rng: () => number, items: readonly T[]): T | undefined {
	if (items.length === 0) {
		return undefined;
	}
	return items[Math.floor(rng() * items.length)];
}