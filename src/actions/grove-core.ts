import { randomPick } from "./seeded-rng";

/** Species ids; the five predefined trees plus the user-defined one. */
export type SpeciesId = "bonsai" | "cherry" | "birch" | "oak" | "redwood" | "custom";

/** User-supplied palette for a custom tree, straight from the Property Inspector. */
export type CustomPalette = {
	/** Trunk color, hex. */
	trunk: string;
	/** Canopy color, hex. */
	canopy: string;
	/** Optional accent (blossoms/fruit), hex. */
	accent?: string;
	/** Tokens to full growth for this custom tree. */
	costTokens: number;
};

/** Colors used by the renderer. */
export type TreePalette = {
	trunk: string;
	canopy: string[];
	accent?: string;
};

/** One species profile: growth cost plus the render parameters the generator consumes. */
export type TreeSpecies = {
	id: SpeciesId;
	name: string;
	/** Tokens to full growth. */
	costTokens: number;
	/** Fraction of the key height the mature tree spans. */
	heightRatio: number;
	/** Child branches per branch, per depth level. */
	branchFactor: number[];
	/** Maximum branch recursion depth. */
	maxDepth: number;
	/** How far children fan out from the parent, in degrees. */
	angleSpread: number;
	/** Child length relative to its parent. */
	lengthRatio: number;
	/** Per-depth fixed angle bias, for twisted trunks (bonsai). */
	curvature: number[];
	/** Extra trunk girth, for hunched old trunks (bonsai). */
	trunkScale?: number;
	/** Canopy style. */
	canopyStyle: "cluster" | "blossom" | "pad" | "weeper" | "conifer" | "broadleaf";
	palette: TreePalette;
};

/** The fixed catalog. Costs are epic scale: a Redwood is a genuine achievement. */
export const SPECIES: Readonly<Record<SpeciesId, TreeSpecies>> = {
	bonsai: {
		id: "bonsai",
		name: "Bonsai",
		costTokens: 50_000,
		heightRatio: 0.45,
		branchFactor: [2, 3, 2, 2],
		maxDepth: 4,
		angleSpread: 58,
		lengthRatio: 0.62,
		curvature: [12, 14, 10, 6, 8],
		trunkScale: 1.5,
		canopyStyle: "pad",
		palette: { trunk: "#6b4a2f", canopy: ["#3c662c", "#4a7c39"], accent: "#e08e3c" },
	},
	cherry: {
		id: "cherry",
		name: "Cherry",
		costTokens: 200_000,
		heightRatio: 0.72,
		branchFactor: [2, 3, 3, 2],
		maxDepth: 4,
		angleSpread: 34,
		lengthRatio: 0.68,
		curvature: [4, 3, 2, 1, 0],
		canopyStyle: "blossom",
		palette: { trunk: "#5a3d2b", canopy: ["#e58fb1", "#f2b8cd"], accent: "#ffd9e8" },
	},
	birch: {
		id: "birch",
		name: "Birch",
		costTokens: 1_000_000,
		heightRatio: 0.78,
		branchFactor: [2, 2, 3, 2],
		maxDepth: 4,
		angleSpread: 13,
		lengthRatio: 0.72,
		curvature: [1, 0, 0, 0, 0],
		canopyStyle: "weeper",
		palette: { trunk: "#d9d2c4", canopy: ["#5c8f42", "#6ba64f"] },
	},
	oak: {
		id: "oak",
		name: "Oak",
		costTokens: 5_000_000,
		heightRatio: 0.78,
		branchFactor: [2, 3, 3, 2],
		maxDepth: 4,
		angleSpread: 50,
		lengthRatio: 0.68,
		curvature: [6, 4, -3, 2, 0],
		canopyStyle: "broadleaf",
		palette: { trunk: "#4d3a29", canopy: ["#2e5223", "#3b662c", "#4a7c34"] },
	},
	redwood: {
		id: "redwood",
		name: "Redwood",
		costTokens: 20_000_000,
		heightRatio: 0.82,
		branchFactor: [2, 2, 2, 3],
		maxDepth: 5,
		angleSpread: 16,
		lengthRatio: 0.6,
		curvature: [2, 1, 0, 0, 0, 0],
		trunkScale: 1.3,
		canopyStyle: "conifer",
		palette: { trunk: "#7a3020", canopy: ["#24462c", "#2f5738"] },
	},
	// Base profile for user-defined trees; the custom palette and cost are merged over it.
	custom: {
		id: "custom",
		name: "Custom",
		costTokens: 200_000,
		heightRatio: 0.75,
		branchFactor: [2, 3, 2, 2],
		maxDepth: 4,
		angleSpread: 34,
		lengthRatio: 0.68,
		curvature: [5, 3, -2, 2, 0],
		canopyStyle: "cluster",
		palette: { trunk: "#6b4a2f", canopy: ["#4a8540"] },
	},
};

/** One planted tree, keyed by its button's action id. */
export type GroveTree = {
	species: SpeciesId;
	seed: number;
	tokens: number;
	plantedAt: number;
	/** Palette + cost override when species is "custom". */
	custom?: CustomPalette;
};

/** The inspector's custom-tree fields in raw Stream Deck form. */
export type CustomTreeSettings = {
	customTrunk?: string;
	customCanopy?: string;
	customAccent?: string;
	/** Max tokens to full growth; textfields hand over strings. */
	customCost?: string | number;
};

/**
 * Builds the custom palette from inspector settings, falling back per-field so
 * a half-filled palette still renders. Costs below 100 are fine — a 50-token
 * sprout tree is a perfectly respectable custom tree.
 * @param settings The key's settings, raw from the inspector.
 */
export function customPalette(settings: CustomTreeSettings): CustomPalette {
	const hex = (value: string | undefined, fallback: string): string => (/^#[0-9a-f]{6}$/i.test(value ?? "") ? (value as string) : fallback);
	// Textfields hand us strings even for numbers, so parse before trusting.
	const cost = Number(settings.customCost ?? NaN);
	return {
		trunk: hex(settings.customTrunk, SPECIES.custom.palette.trunk),
		canopy: hex(settings.customCanopy, SPECIES.custom.palette.canopy[0]),
		accent: hex(settings.customAccent, "") || undefined,
		costTokens: Number.isFinite(cost) && cost >= 1 ? Math.floor(cost) : SPECIES.custom.costTokens,
	};
}

/** Claude feed baseline: today's local date and the last-seen tokensToday. */
export type ClaudeFeedState = { date: string; tokens: number };

/** Ollama feed baseline: last-seen token counts per usage bucket. */
export type OllamaFeedState = { buckets: Record<string, number> };

/** The whole grove: trees by action id, the selected tree, and feed baselines. */
export type GroveState = {
	trees: Record<string, GroveTree>;
	activeTreeId?: string;
	claudeFeed?: ClaudeFeedState;
	ollamaFeed?: OllamaFeedState;
};

/**
 * Growth 0..1 toward full growth, clamped at 1.
 * @param tree The tree to measure.
 */
export function growthFraction(tree: GroveTree): number {
	return Math.min(1, tree.tokens / resolveSpecies(tree).costTokens);
}

/** Is the tree fully grown? */
function isMaxed(tree: GroveTree): boolean {
	return tree.tokens >= resolveSpecies(tree).costTokens;
}

/**
 * Resolves a tree's render/growth profile — predefined, or the custom profile
 * with the tree's palette and cost merged over it.
 * @param tree The tree to resolve.
 */
export function resolveSpecies(tree: GroveTree): TreeSpecies {
	if (tree.species !== "custom" || tree.custom === undefined) {
		return SPECIES[tree.species];
	}
	return {
		...SPECIES.custom,
		name: "Custom",
		costTokens: tree.custom.costTokens,
		palette: {
			trunk: tree.custom.trunk,
			canopy: [tree.custom.canopy],
			accent: tree.custom.accent,
		},
	};
}

/** Local date as "YYYY-MM-DD", for Claude feed rollover detection. */
function localDate(date: Date): string {
	const year = date.getFullYear();
	const month = `${date.getMonth() + 1}`.padStart(2, "0");
	const day = `${date.getDate()}`.padStart(2, "0");
	return `${year}-${month}-${day}`;
}

/**
 * Claude token delta since the last poll, keyed by local date so the midnight
 * rollover of "tokens today" is not read as negative growth.
 * @param feed Last-seen baseline, or undefined on the first poll (delta 0).
 * @param tokensToday The freshly scanned today-total.
 * @param now The current time.
 * @returns The delta and the new baseline.
 */
export function claudeTokensDelta(feed: ClaudeFeedState | undefined, tokensToday: number, now: Date): { delta: number; feed: ClaudeFeedState } {
	const date = localDate(now);
	// First poll is a baseline (nothing flows); a date rollover means all of today's tokens are new.
	const delta = feed === undefined ? 0 : feed.date === date ? Math.max(0, tokensToday - feed.tokens) : tokensToday;
	return { delta, feed: { date, tokens: tokensToday } };
}

/**
 * Which tree receives the next batch: the active one unless it is full grown,
 * else a random non-maxed tree, else nobody.
 * @param state Current grove.
 * @param rng Seeded RNG keeps the random pick testable.
 */
export function pickRecipient(state: GroveState, rng: () => number): string | undefined {
	const active = state.activeTreeId !== undefined ? state.trees[state.activeTreeId] : undefined;
	if (active !== undefined && !isMaxed(active)) {
		return state.activeTreeId;
	}
	return randomPick(
		rng,
		Object.keys(state.trees).filter((id) => !isMaxed(state.trees[id])),
	);
}

/**
 * Routes one atomic token batch per the distribution rules. A tree that maxes
 * out mid-batch keeps the excess — no spilling into the next tree.
 * @param state Current grove.
 * @param delta Tokens in this batch; non-positive batches change nothing.
 * @param rng Seeded RNG for the random fallback.
 * @returns The new grove and which action keys need a redraw.
 */
export function applyTokenBatch(state: GroveState, delta: number, rng: () => number): { state: GroveState; changedTreeIds: string[] } {
	if (delta <= 0) {
		return { state, changedTreeIds: [] };
	}

	const recipient = pickRecipient(state, rng);
	if (recipient === undefined) {
		return { state, changedTreeIds: [] }; // All trees full grown — the batch is spent on the wind.
	}

	const tree = state.trees[recipient];
	const cost = resolveSpecies(tree).costTokens;
	const tokens = Math.min(tree.tokens + delta, cost);
	return {
		state: {
			...state,
			trees: { ...state.trees, [recipient]: { ...tree, tokens } },
		},
		changedTreeIds: [recipient],
	};
}

/**
 * Plants a tree on a button, replacing any existing one (replant: fresh seed, tokens reset).
 * @param state Current grove.
 * @param actionId The button to plant on.
 * @param species The species to plant.
 * @param now Planting time, epoch ms.
 * @param rng Source of the tree's shape seed.
 * @param custom Palette + cost, required only for the "custom" species.
 */
export function plantTree(
	state: GroveState,
	actionId: string,
	species: SpeciesId,
	now: number,
	rng: () => number,
	custom?: CustomPalette,
): GroveState {
	const tree: GroveTree = { species, seed: Math.floor(rng() * 0xffffffff) + 1, tokens: 0, plantedAt: now };
	if (species === "custom" && custom !== undefined) {
		tree.custom = custom;
	}
	return { ...state, trees: { ...state.trees, [actionId]: tree } };
}

/**
 * Removes a tree from a button, clearing the selection if it pointed at it.
 * @param state Current grove.
 * @param actionId The button to clear.
 */
export function removeTree(state: GroveState, actionId: string): GroveState {
	const trees = { ...state.trees };
	delete trees[actionId];
	const activeTreeId = state.activeTreeId === actionId ? undefined : state.activeTreeId;
	return { ...state, trees, activeTreeId };
}

/** What the inspector's reset selector can do to a planted tree. */
export type ResetMode = "regrow" | "replant";

/**
 * Resets a planted tree's growth: "regrow" keeps the same shape at zero tokens,
 * "replant" starts over with a fresh shape. Custom palettes and costs survive.
 * @param state Current grove.
 * @param actionId The button whose tree to reset.
 * @param mode Which reset the inspector asked for.
 * @param now Reset time, epoch ms, recorded as the (re)planting time.
 * @param rng Source of the shape seed for a replant.
 * @returns The new grove and whether the button needs a redraw.
 */
export function resetTree(state: GroveState, actionId: string, mode: ResetMode, now: number, rng: () => number): { state: GroveState; changed: boolean } {
	const tree = state.trees[actionId];
	if (tree === undefined) {
		return { state, changed: false };
	}
	if (mode === "replant") {
		return { state: plantTree(state, actionId, tree.species, now, rng, tree.custom), changed: true };
	}
	return { state: { ...state, trees: { ...state.trees, [actionId]: { ...tree, tokens: 0 } } }, changed: true };
}

/**
 * Aligns the tree on a button with the species the inspector has selected:
 * an empty or unknown species removes the tree, a species change replants it
 * (fresh seed, tokens reset), and a planted custom tree just adopts palette
 * and cost edits in place.
 * @param state Current grove.
 * @param actionId The button to sync.
 * @param species The inspector's species selection, if any.
 * @param now Planting time, epoch ms, for fresh plants.
 * @param rng Source of the shape seed for fresh plants.
 * @param custom Palette + cost, used only for the "custom" species.
 * @returns The new grove and whether the button needs a redraw.
 */
export function syncKeyTree(
	state: GroveState,
	actionId: string,
	species: string | undefined,
	now: number,
	rng: () => number,
	custom?: CustomPalette,
): { state: GroveState; changed: boolean } {
	const existing = state.trees[actionId];
	if (species === undefined || !(species in SPECIES)) {
		return { state: removeTree(state, actionId), changed: existing !== undefined };
	}
	if (existing !== undefined && existing.species === species) {
		if (species !== "custom" || custom === undefined) {
			return { state, changed: false };
		}
		return { state: { ...state, trees: { ...state.trees, [actionId]: { ...existing, custom } } }, changed: true };
	}
	return { state: plantTree(state, actionId, species as SpeciesId, now, rng, custom), changed: true };
}

/** A tree is valid when it names a known species with sane-looking numbers. */
function isValidTree(value: unknown): value is GroveTree {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const tree = value as Record<string, unknown>;
	return (
		typeof tree.species === "string" &&
		tree.species in SPECIES &&
		typeof tree.seed === "number" &&
		typeof tree.tokens === "number" &&
		typeof tree.plantedAt === "number"
	);
}

/**
 * Tolerantly loads the grove from Stream Deck global settings, dropping garbage
 * instead of throwing so a corrupted entry cannot take the whole forest down.
 * @param settings The plugin's global settings object.
 */
export function groveFromGlobalSettings(settings: Record<string, unknown> | undefined): GroveState {
	const grove = settings?.grove;
	if (typeof grove !== "object" || grove === null) {
		return { trees: {} };
	}

	const trees: Record<string, GroveTree> = {};
	const rawTrees = (grove as Record<string, unknown>).trees;
	if (typeof rawTrees === "object" && rawTrees !== null) {
		for (const [id, tree] of Object.entries(rawTrees)) {
			if (isValidTree(tree)) {
				trees[id] = tree;
			}
		}
	}

	const activeTreeId = typeof (grove as Record<string, unknown>).activeTreeId === "string" ? (grove as Record<string, string>).activeTreeId : undefined;
	const claudeFeed = (grove as Record<string, unknown>).claudeFeed as ClaudeFeedState | undefined;
	const ollamaFeed = (grove as Record<string, unknown>).ollamaFeed as OllamaFeedState | undefined;
	return { trees, activeTreeId, claudeFeed, ollamaFeed };
}